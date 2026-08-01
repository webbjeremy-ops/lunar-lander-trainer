// SPDX-License-Identifier: GPL-3.0-or-later
// M4.31 — easy program acceptance (LB).

import { describe, expect, it } from "vitest";
import { AGC_KEY } from "@/lessons/keyCodes";
import {
  ACCEPTANCE_KEY_INTERVAL_MS,
  resolveProgramAcceptance,
} from "../programAcceptance";
import {
  APOLLO11_DESCENT_SCRIPT,
  EMPTY_SCRIPT,
  majorModeKeys,
  type DskyProcedureScript,
} from "../procedures";
import {
  createProcedureState,
  currentStep,
  reduceProcedure,
  type ProcedureGates,
  type ProcedureState,
} from "../procedureEngine";

const SCRIPT: DskyProcedureScript = APOLLO11_DESCENT_SCRIPT;

const OPEN_GATES: ProcedureGates = {
  engineArmed: true,
  windowsUp: true,
  alarmActive: true,
  sinceIgnitionUs: 3_600_000_000,
  highGateReady: true,
};

function fresh(): ProcedureState {
  return createProcedureState(SCRIPT);
}

function key(s: ProcedureState, code: number): ProcedureState {
  return reduceProcedure(SCRIPT, s, {
    kind: "key",
    code,
    missionTimeUs: 0,
    gates: OPEN_GATES,
  });
}

describe("resolveProgramAcceptance", () => {
  it("returns the full keystroke list for an untouched step", () => {
    const plan = resolveProgramAcceptance(SCRIPT, fresh(), OPEN_GATES);
    expect(plan.kind).toBe("keys");
    if (plan.kind !== "keys") return;
    expect(plan.stepId).toBe(currentStep(SCRIPT, fresh())!.id);
    expect(plan.keys).toEqual(majorModeKeys(63));
  });

  it("resumes from the keys the player already entered", () => {
    let s = fresh();
    s = key(s, AGC_KEY.VERB);
    s = key(s, 3);
    const plan = resolveProgramAcceptance(SCRIPT, s, OPEN_GATES);
    expect(plan.kind).toBe("keys");
    if (plan.kind !== "keys") return;
    expect(plan.keys).toEqual(majorModeKeys(63).slice(2));
  });

  it("clears a latched entry error before re-keying the whole step", () => {
    let s = fresh();
    s = key(s, AGC_KEY.NOUN); // wrong first key
    expect(s.entryError).toBe(true);
    const plan = resolveProgramAcceptance(SCRIPT, s, OPEN_GATES);
    expect(plan.kind).toBe("keys");
    if (plan.kind !== "keys") return;
    expect(plan.keys[0]).toBe(AGC_KEY.CLR);
    expect(plan.keys.slice(1)).toEqual(majorModeKeys(63));
  });

  it("emits PROCEED as the held PRO key, not a raw code", () => {
    // Walk to the ignition step, which expects PRO.
    let s = fresh();
    for (let i = 0; i < SCRIPT.steps.length; i += 1) {
      const step = currentStep(SCRIPT, s);
      if (step === null) break;
      if (step.expected[0] === AGC_KEY.PRO) break;
      for (const code of step.expected) s = key(s, code);
    }
    const step = currentStep(SCRIPT, s);
    expect(step?.expected[0]).toBe(AGC_KEY.PRO);
    const plan = resolveProgramAcceptance(SCRIPT, s, OPEN_GATES);
    expect(plan.kind).toBe("keys");
    if (plan.kind !== "keys") return;
    expect(plan.keys).toEqual(["PRO"]);
  });

  it("refuses a step whose hardware gate is not satisfied", () => {
    let s = fresh();
    for (const code of majorModeKeys(63)) s = key(s, code);
    // Advance until a gated step is pending, then close every gate.
    const closed: ProcedureGates = {
      engineArmed: false,
      windowsUp: false,
      alarmActive: false,
      sinceIgnitionUs: 0,
      highGateReady: false,
    };
    let guard = 0;
    while (guard < SCRIPT.steps.length) {
      const plan = resolveProgramAcceptance(SCRIPT, s, closed);
      if (plan.kind === "blocked") {
        expect(plan.reason.length).toBeGreaterThan(0);
        return;
      }
      const step = currentStep(SCRIPT, s);
      if (step === null) break;
      for (const code of step.expected) s = key(s, code);
      guard += 1;
    }
    throw new Error("expected at least one gated step to block the assist");
  });

  it("is idle with no script and once the procedure is complete", () => {
    expect(
      resolveProgramAcceptance(EMPTY_SCRIPT, createProcedureState(EMPTY_SCRIPT), OPEN_GATES).kind,
    ).toBe("idle");
    const complete: ProcedureState = { ...fresh(), status: "complete" };
    expect(resolveProgramAcceptance(SCRIPT, complete, OPEN_GATES).kind).toBe("idle");
  });

  it("keys on a human cadence, not instantaneously", () => {
    expect(ACCEPTANCE_KEY_INTERVAL_MS).toBeGreaterThanOrEqual(40);
  });
});
