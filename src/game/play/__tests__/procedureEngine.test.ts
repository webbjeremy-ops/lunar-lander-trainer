// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Pure procedure state-machine tests.

import { describe, expect, it } from "vitest";
import { AGC_KEY } from "@/lessons/keyCodes";
import {
  createProcedureState,
  currentStep,
  majorModeKeys,
  meanResponseSeconds,
  POWERED_DESCENT_SCRIPT,
  procedureProgress,
  reduceProcedure,
  scriptFor,
  verbNounKeys,
  type ProcedureState,
} from "@/game/play";

const S = POWERED_DESCENT_SCRIPT;

function keys(state: ProcedureState, codes: readonly (number | "PRO")[], t = 0): ProcedureState {
  let s = state;
  for (const c of codes) s = reduceProcedure(S, s, { kind: "key", code: c, missionTimeUs: t });
  return s;
}

describe("keystroke builders", () => {
  it("V37E 63E is the P63 major-mode change", () => {
    expect(majorModeKeys(63)).toEqual([
      AGC_KEY.VERB, AGC_KEY.DIGIT_3, AGC_KEY.DIGIT_7, AGC_KEY.ENTR,
      AGC_KEY.DIGIT_6, AGC_KEY.DIGIT_3, AGC_KEY.ENTR,
    ]);
  });

  it("V16 N62 E uses the zero key code 0o20 for leading zeros", () => {
    expect(verbNounKeys(6, 64)).toEqual([
      AGC_KEY.VERB, AGC_KEY.DIGIT_0, AGC_KEY.DIGIT_6,
      AGC_KEY.NOUN, AGC_KEY.DIGIT_6, AGC_KEY.DIGIT_4, AGC_KEY.ENTR,
    ]);
  });
});

describe("procedure reducer", () => {
  it("starts locked: no flight and no manual control", () => {
    const s = createProcedureState(S);
    expect(s.flightLockReleased).toBe(false);
    expect(s.manualControlUnlocked).toBe(false);
    expect(currentStep(S, s)?.id).toBe("p63-select");
    expect(procedureProgress(S, s)).toBe(`0 / ${S.steps.length}`);
  });

  it("advances only on the exact expected keystroke order", () => {
    let s = createProcedureState(S);
    s = keys(s, majorModeKeys(63));
    expect(s.completedStepIds).toEqual(["p63-select"]);
    expect(currentStep(S, s)?.id).toBe("p63-monitor");
  });

  it("latches an error on a wrong key and never auto-corrects", () => {
    let s = createProcedureState(S);
    s = keys(s, [AGC_KEY.VERB, AGC_KEY.DIGIT_9]);
    expect(s.entryError).toBe(true);
    expect(s.incorrectEntries).toBe(1);
    // Further keys are refused until CLR.
    s = keys(s, [AGC_KEY.DIGIT_7, AGC_KEY.ENTR]);
    expect(s.buffer.length).toBe(1);
    expect(s.completedStepIds).toEqual([]);
    // CLR re-arms the step.
    s = keys(s, [AGC_KEY.CLR]);
    expect(s.entryError).toBe(false);
    expect(s.buffer).toEqual([]);
    s = keys(s, majorModeKeys(63));
    expect(s.completedStepIds).toEqual(["p63-select"]);
  });

  it("PRO releases the flight lock at the ignition step", () => {
    let s = createProcedureState(S);
    s = keys(s, majorModeKeys(63));
    s = keys(s, verbNounKeys(16, 62));
    expect(s.flightLockReleased).toBe(false);
    s = keys(s, ["PRO"]);
    expect(s.flightLockReleased).toBe(true);
    expect(s.manualControlUnlocked).toBe(false);
  });

  it("V37E 66E unlocks manual control and completes the script", () => {
    let s = createProcedureState(S);
    s = keys(s, majorModeKeys(63));
    s = keys(s, verbNounKeys(16, 62));
    s = keys(s, ["PRO"]);
    s = keys(s, verbNounKeys(6, 64));
    expect(s.manualControlUnlocked).toBe(false);
    s = keys(s, majorModeKeys(66));
    expect(s.manualControlUnlocked).toBe(true);
    expect(s.status).toBe("complete");
    expect(s.completedStepIds).toHaveLength(S.steps.length);
  });

  it("is deterministic: the same event stream yields the same state", () => {
    const stream = [...majorModeKeys(63), ...verbNounKeys(16, 62)] as const;
    const a = keys(createProcedureState(S), stream, 1_000_000);
    const b = keys(createProcedureState(S), stream, 1_000_000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("records hints and response times", () => {
    let s = createProcedureState(S, 0);
    s = reduceProcedure(S, s, { kind: "hint", missionTimeUs: 0 });
    expect(s.hintsUsed).toBe(1);
    s = keys(s, majorModeKeys(63), 4_000_000);
    expect(meanResponseSeconds(s)).toBeCloseTo(4, 6);
  });

  it("quick-manual has no procedure and starts fully unlocked", () => {
    const script = scriptFor("apollo11-powered-descent", "quick-manual");
    const s = createProcedureState(script);
    expect(script.steps).toHaveLength(0);
    expect(s.flightLockReleased).toBe(true);
    expect(s.manualControlUnlocked).toBe(true);
    expect(s.status).toBe("complete");
  });

  it("bridged steps are labelled, unbridged ones are not", () => {
    const byId = Object.fromEntries(S.steps.map((st) => [st.id, st]));
    expect(byId["p63-select"]!.bridged).toBe(false);
    expect(byId["pdi-proceed"]!.bridged).toBe(true);
    expect(byId["p66-takeover"]!.bridged).toBe(true);
    for (const st of S.steps) expect(st.citation.label.length).toBeGreaterThan(0);
  });
});
