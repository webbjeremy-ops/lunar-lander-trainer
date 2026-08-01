// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Pure DSKY procedure state machine.
//
// Deterministic reducer: (state, event) -> state. No timers, no AGC access,
// no side effects. The host forwards real keypad events here AFTER they have
// been sent to the AGC, so the AGC always sees exactly what the player keyed,
// including mistakes.

import { AGC_KEY } from "@/lessons/keyCodes";
import type { DskyProcedureScript, DskyProcedureStep, ProcedureKey } from "./procedures";
import { describeKey } from "./procedures";

export type ProcedureKeyInput = number | "PRO";

/**
 * Cockpit state the reducer may consult when a step declares a hardware
 * pre-condition (e.g. Aldrin's ENG ARM switch before PROCEED). Purely an
 * input: the reducer never mutates the cockpit.
 */
export interface ProcedureGates {
  readonly engineArmed?: boolean;
  /** True once the vehicle has been rolled windows-up (M4.8). */
  readonly windowsUp?: boolean;
  /** True while a program alarm lamp is lit (M4.8). */
  readonly alarmActive?: boolean;
  /** Microseconds since ignition on the descent-sequence clock. */
  readonly sinceIgnitionUs?: number;
  /** True only when the shared P63→P64 time-and-geometry gate is ready. */
  readonly highGateReady?: boolean;
}

export type ProcedureEvent =
  | {
      readonly kind: "key";
      readonly code: ProcedureKeyInput;
      readonly missionTimeUs: number;
      readonly gates?: ProcedureGates;
    }
  | { readonly kind: "hint"; readonly missionTimeUs: number }
  | { readonly kind: "reset-entry"; readonly missionTimeUs: number };

export interface ProcedureLogEntry {
  readonly missionTimeUs: number;
  readonly stepId: string;
  readonly outcome: "correct" | "incorrect" | "step-complete" | "hint" | "cleared";
  readonly message: string;
}

export interface ProcedureState {
  readonly scriptId: string;
  readonly scriptVersion: number;
  readonly stepIndex: number;
  /** Keys accepted toward the current step. */
  readonly buffer: readonly ProcedureKey[];
  /** True after a wrong key: the entry must be cleared (CLR) before retrying. */
  readonly entryError: boolean;
  readonly lastMessage: string;
  readonly incorrectEntries: number;
  readonly hintsUsed: number;
  readonly completedStepIds: readonly string[];
  readonly flightLockReleased: boolean;
  readonly manualControlUnlocked: boolean;
  readonly status: "in-progress" | "complete";
  /** Sum of prompt→completion times, µs, for completed steps. */
  readonly totalResponseUs: number;
  readonly stepStartedUs: number;
  readonly log: readonly ProcedureLogEntry[];
}

const MAX_LOG = 40;

export function normalizeKey(code: ProcedureKeyInput): ProcedureKey {
  return code === "PRO" ? AGC_KEY.PRO : code;
}

export function createProcedureState(
  script: DskyProcedureScript,
  missionTimeUs = 0,
): ProcedureState {
  return {
    scriptId: script.id,
    scriptVersion: script.version,
    stepIndex: 0,
    buffer: [],
    entryError: false,
    lastMessage:
      script.steps.length === 0
        ? "No DSKY procedure for this mode — flight controls are live."
        : "Awaiting first keystroke.",
    incorrectEntries: 0,
    hintsUsed: 0,
    completedStepIds: [],
    flightLockReleased: script.steps.length === 0,
    manualControlUnlocked: script.steps.length === 0,
    status: script.steps.length === 0 ? "complete" : "in-progress",
    totalResponseUs: 0,
    stepStartedUs: missionTimeUs,
    log: [],
  };
}

export function currentStep(
  script: DskyProcedureScript,
  state: ProcedureState,
): DskyProcedureStep | null {
  return script.steps[state.stepIndex] ?? null;
}

function push(
  log: readonly ProcedureLogEntry[],
  entry: ProcedureLogEntry,
): readonly ProcedureLogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
}

export function reduceProcedure(
  script: DskyProcedureScript,
  state: ProcedureState,
  event: ProcedureEvent,
): ProcedureState {
  const step = currentStep(script, state);
  if (state.status === "complete" || step === null) return state;

  if (event.kind === "hint") {
    return {
      ...state,
      hintsUsed: state.hintsUsed + 1,
      lastMessage: step.hint,
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "hint",
        message: step.hint,
      }),
    };
  }

  if (event.kind === "reset-entry") {
    return {
      ...state,
      buffer: [],
      entryError: false,
      lastMessage: "Entry cleared — key the step again.",
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "cleared",
        message: "Entry cleared.",
      }),
    };
  }

  const code = normalizeKey(event.code);

  // CLR always clears a pending entry (the AGC gets the keystroke either way).
  if (code === AGC_KEY.CLR) {
    return reduceProcedure(script, state, {
      kind: "reset-entry",
      missionTimeUs: event.missionTimeUs,
    });
  }

  // Hardware pre-condition: PROCEED is refused while the descent engine is
  // unarmed, exactly as the real ENG ARM switch gated ignition. The AGC still
  // received the keystroke; only the procedure refuses to advance.
  if (step.requiresEngineArm === true && event.gates?.engineArmed !== true) {
    return {
      ...state,
      lastMessage:
        "ENG ARM is OFF — arm the descent engine before PROCEED. " +
        "(Aldrin threw ENG ARM to DESCENT before Armstrong keyed PRO.)",
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: "PROCEED refused — ENG ARM off",
      }),
    };
  }

  // M4.8 — the landing radar cannot see the surface while the vehicle is
  // face-down, so the radar steps stay locked until the crew rolls windows-up.
  if (step.requiresWindowsUp === true && event.gates?.windowsUp !== true) {
    return {
      ...state,
      lastMessage:
        "Still windows-down — the landing radar cannot see the surface. " +
        "Hold the ROLL control until the indicator reads WINDOWS UP.",
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: "Step refused — vehicle is not windows-up",
      }),
    };
  }

  // The scripted descent steps are keyed to the 13-minute timeline: the crew
  // callout comes first, the keystroke second. Keying early is refused.
  if (
    step.notBeforeSinceIgnitionSec !== undefined &&
    (event.gates?.sinceIgnitionUs ?? 0) < step.notBeforeSinceIgnitionSec * 1_000_000
  ) {
    return {
      ...state,
      lastMessage:
        "Too early — stand by. This step is flown at " +
        `T+${String(Math.floor(step.notBeforeSinceIgnitionSec / 60)).padStart(2, "0")}:` +
        `${String(step.notBeforeSinceIgnitionSec % 60).padStart(2, "0")} on the descent timeline.`,
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: "Step keyed before its point in the descent timeline",
      }),
    };
  }

  if (step.requiresHighGate === true && event.gates?.highGateReady !== true) {
    return {
      ...state,
      lastMessage:
        "P64 gate not available — remain in P63 until high-gate time and geometry agree. " +
        "If the landing zone is already behind you, follow Houston's correction or abort call.",
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: "P64 refused — high-gate geometry not satisfied",
      }),
    };
  }

  // M4.8 — the alarm response only means anything while an alarm is lit.
  if (step.requiresAlarm === true && event.gates?.alarmActive !== true) {
    return {
      ...state,
      lastMessage:
        "No program alarm is lit — wait for the PROG lamp before reading the code.",
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: "Alarm response keyed with no alarm lit",
      }),
    };
  }



  // After a wrong key the player must clear before the machine re-arms. The
  // mistake is never silently corrected.
  if (state.entryError) {
    return {
      ...state,
      lastMessage: `Entry error latched — press CLR, then key ${step.keystrokes}.`,
    };
  }

  const expected = step.expected[state.buffer.length];
  if (expected === undefined) return state;

  if (code !== expected) {
    return {
      ...state,
      entryError: true,
      incorrectEntries: state.incorrectEntries + 1,
      lastMessage: `Unexpected ${describeKey(code)} — expected ${describeKey(expected)}. Press CLR to retry.`,
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "incorrect",
        message: `${describeKey(code)} instead of ${describeKey(expected)}`,
      }),
    };
  }

  const buffer = [...state.buffer, code];
  if (buffer.length < step.expected.length) {
    return {
      ...state,
      buffer,
      lastMessage: `${describeKey(code)} accepted (${buffer.length}/${step.expected.length}).`,
      log: push(state.log, {
        missionTimeUs: event.missionTimeUs,
        stepId: step.id,
        outcome: "correct",
        message: describeKey(code),
      }),
    };
  }

  // Step complete.
  const stepIndex = state.stepIndex + 1;
  const done = stepIndex >= script.steps.length;
  const responseUs = Math.max(0, event.missionTimeUs - state.stepStartedUs);
  return {
    ...state,
    stepIndex,
    buffer: [],
    entryError: false,
    completedStepIds: [...state.completedStepIds, step.id],
    flightLockReleased: state.flightLockReleased || step.releasesFlightLock === true,
    manualControlUnlocked:
      state.manualControlUnlocked || step.unlocksManualControl === true,
    status: done ? "complete" : "in-progress",
    totalResponseUs: state.totalResponseUs + responseUs,
    stepStartedUs: event.missionTimeUs,
    lastMessage: done
      ? "Procedure complete."
      : `${step.title} complete — next: ${script.steps[stepIndex]!.title}.`,
    log: push(state.log, {
      missionTimeUs: event.missionTimeUs,
      stepId: step.id,
      outcome: "step-complete",
      message: `${step.keystrokes} complete`,
    }),
  };
}

/** Mean seconds per completed step (0 when nothing was completed). */
export function meanResponseSeconds(state: ProcedureState): number {
  const n = state.completedStepIds.length;
  return n === 0 ? 0 : state.totalResponseUs / n / 1_000_000;
}

/** Human-readable progress, e.g. "2 / 5". */
export function procedureProgress(
  script: DskyProcedureScript,
  state: ProcedureState,
): string {
  return `${state.completedStepIds.length} / ${script.steps.length}`;
}
