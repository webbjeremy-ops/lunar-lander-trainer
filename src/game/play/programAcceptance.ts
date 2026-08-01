// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.31 — Easy program acceptance (LB).
//
// The crew flew the DSKY one key at a time, and the procedure engine still
// demands exactly that. On a controller the twelve-keystroke V37E 63E ritual
// is unflyable, so the left bumper offers an ASSIST: it works out the keys the
// pending step is still waiting for and hands them to the DSKY, which passes
// every one of them to the real AGC in order. Nothing is bypassed —
//
//   * the same gates apply (ENG ARM, windows-up, timeline, high gate, alarm):
//     if the step is refused for the player it is refused for the bumper;
//   * the AGC receives the authentic keystroke stream, not a state poke;
//   * a latched entry error must still be cleared, so the assist emits CLR
//     first rather than pretending the mistake never happened;
//   * the acceptance is recorded, so scoring can tell assisted entries from
//     hand-keyed ones.
//
// This module is pure: it decides WHAT to key, never keys it.

import { AGC_KEY } from "@/lessons/keyCodes";
import { currentStep, type ProcedureState, type ProcedureGates } from "./procedureEngine";
import type { DskyProcedureScript, ProcedureKey } from "./procedures";

/** A key as the DSKY component accepts it — PROCEED is a held key, not a code. */
export type InjectableKey = number | "PRO";

export type ProgramAcceptance =
  | {
      readonly kind: "keys";
      readonly stepId: string;
      /** Human-readable line, e.g. "V37 E 6 3 E". */
      readonly keystrokes: string;
      /** Keys still outstanding, in order, ready to hand to the DSKY. */
      readonly keys: readonly InjectableKey[];
    }
  | { readonly kind: "blocked"; readonly stepId: string; readonly reason: string }
  | { readonly kind: "idle"; readonly reason: string };

/** Millisecond spacing between injected keystrokes (a brisk but human hand). */
export const ACCEPTANCE_KEY_INTERVAL_MS = 70;

export function toInjectableKey(code: ProcedureKey): InjectableKey {
  return code === AGC_KEY.PRO ? "PRO" : code;
}

/**
 * How many keys of the pending step the player has already entered correctly.
 * The assist resumes from there instead of re-keying the verb.
 */
function acceptedPrefix(
  buffer: readonly ProcedureKey[],
  expected: readonly ProcedureKey[],
): number {
  let i = 0;
  while (i < buffer.length && i < expected.length && buffer[i] === expected[i]) i += 1;
  return i;
}

/**
 * Gate check, mirroring `reduceProcedure` so the assist never keys a step the
 * procedure engine is about to refuse — that would spray keystrokes at the AGC
 * and log an incorrect entry for the player.
 */
function gateReason(
  step: NonNullable<ReturnType<typeof currentStep>>,
  gates: ProcedureGates | undefined,
): string | null {
  if (step.requiresEngineArm === true && gates?.engineArmed !== true) {
    return "ENG ARM is OFF — arm the descent engine first.";
  }
  if (step.requiresWindowsUp === true && gates?.windowsUp !== true) {
    return "Vehicle is windows-down — roll before the radar steps.";
  }
  if (
    step.notBeforeSinceIgnitionSec !== undefined &&
    (gates?.sinceIgnitionUs ?? 0) < step.notBeforeSinceIgnitionSec * 1_000_000
  ) {
    const t = step.notBeforeSinceIgnitionSec;
    return (
      "Too early — this step is flown at " +
      `T+${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}.`
    );
  }
  if (step.requiresHighGate === true && gates?.highGateReady !== true) {
    return "P64 gate not available — high-gate time and geometry do not agree yet.";
  }
  if (step.requiresAlarm === true && gates?.alarmActive !== true) {
    return "No program alarm is lit.";
  }
  return null;
}

/**
 * Resolve the keystrokes the left bumper should send for the pending step.
 */
export function resolveProgramAcceptance(
  script: DskyProcedureScript,
  state: ProcedureState,
  gates?: ProcedureGates,
): ProgramAcceptance {
  if (state.status === "complete") {
    return { kind: "idle", reason: "Procedure complete — nothing to accept." };
  }
  const step = currentStep(script, state);
  if (step === null) {
    return { kind: "idle", reason: "No DSKY step is pending." };
  }
  const blocked = gateReason(step, gates);
  if (blocked !== null) {
    return { kind: "blocked", stepId: step.id, reason: blocked };
  }

  // A latched entry error is cleared first, then the whole step is re-keyed:
  // after CLR the procedure engine drops the buffer.
  const prefix = state.entryError ? 0 : acceptedPrefix(state.buffer, step.expected);
  const remaining = step.expected.slice(prefix).map(toInjectableKey);
  const keys = state.entryError ? [AGC_KEY.CLR as InjectableKey, ...remaining] : remaining;

  if (keys.length === 0) {
    return { kind: "idle", reason: "Step already keyed." };
  }
  return { kind: "keys", stepId: step.id, keystrokes: step.keystrokes, keys };
}
