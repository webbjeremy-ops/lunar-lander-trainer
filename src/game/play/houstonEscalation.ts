// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.21 — Houston escalation ladder (PURE).
//
// Houston never jumps straight to "abort". A real flight director watches a
// deviation, calls a correction, watches the crew respond, repeats the call
// harder, and only then directs an abort. This module is that ladder, as a
// deterministic reducer over the deviation list produced by
// `houstonAdvisory.ts`.
//
//   clear          nothing standing
//   correct        Houston has called the fix; the clock is running
//   final-warning  the fix has not taken; last call before the directive
//   abort          Houston directs ABORT STAGE — the scripted descent is over
//
// Once the abort directive is issued the flight is latched off-script:
// the remaining Apollo 11 transcript and the remaining procedure steps are
// NOT played, because they never happened on this flight.
//
// PURE MODULE: no timers, no side effects, no AGC access.

import type { HoustonCall } from "./houstonAdvisory";

const S = 1_000_000;

/** How long the crew has to correct a no-go deviation before Houston aborts. */
export const CORRECTION_WINDOW_US = 20 * S;
/** When the "last call" goes out inside that window. */
export const FINAL_WARNING_US = 12 * S;
/** A caution has to stand this long before it is treated as correctable-critical. */
export const CAUTION_GRACE_US = 40 * S;

export type EscalationStage = "clear" | "correct" | "final-warning" | "abort";

export interface HoustonEscalationState {
  /** Microseconds each deviation id has been continuously present. */
  readonly timers: Readonly<Record<string, number>>;
  readonly stage: EscalationStage;
  /** The deviation currently being escalated, if any. */
  readonly activeId: string | null;
  /** Microseconds the active deviation has been inside the correction window. */
  readonly elapsedUs: number;
  /** Latched once Houston directs the abort. */
  readonly abortDirected: boolean;
  /** Latched: the remaining transcript / procedure script is abandoned. */
  readonly scriptTerminated: boolean;
  /** Ids Houston has already called a correction on (for the flight log). */
  readonly correctedIds: readonly string[];
}

export function createHoustonEscalationState(): HoustonEscalationState {
  return {
    timers: {},
    stage: "clear",
    activeId: null,
    elapsedUs: 0,
    abortDirected: false,
    scriptTerminated: false,
    correctedIds: [],
  };
}

export interface HoustonEscalationInput {
  /** Deviations standing right now, worst first (`houstonDeviations`). */
  readonly deviations: readonly HoustonCall[];
  readonly stepUs: number;
  readonly terminal: boolean;
  /** True once the crew has already hit ABORT STAGE themselves. */
  readonly crewAborted: boolean;
  /**
   * M4.39 — True while the computer is flying (P63 braking, scripted roll).
   * Cautions do not escalate toward an abort while the crew has no authority
   * to correct them; only a hard no-go does.
   */
  readonly autoGuidanceActive?: boolean;
}

/**
 * Escalation-relative time for a deviation: no-go deviations start the clock
 * immediately, cautions only after they have been ignored for the grace period.
 */
function criticalElapsedUs(
  call: HoustonCall,
  heldUs: number,
  autoGuidanceActive: boolean,
): number {
  if (call.severity === "no-go") return heldUs;
  if (call.severity === "caution") {
    if (autoGuidanceActive) return -1;
    return heldUs - CAUTION_GRACE_US;
  }
  return -1;
}

export function reduceHoustonEscalation(
  state: HoustonEscalationState,
  input: HoustonEscalationInput,
): HoustonEscalationState {
  if (state.scriptTerminated) return state;
  if (input.terminal) {
    return { ...state, stage: "clear", activeId: null, elapsedUs: 0 };
  }
  if (input.crewAborted) {
    return {
      ...state,
      stage: "abort",
      activeId: state.activeId,
      abortDirected: false,
      scriptTerminated: true,
    };
  }

  // Advance the per-deviation hold timers; drop anything no longer standing.
  const timers: Record<string, number> = {};
  for (const call of input.deviations) {
    timers[call.id] = (state.timers[call.id] ?? 0) + input.stepUs;
  }

  // The worst, longest-standing correctable deviation drives the ladder.
  let active: HoustonCall | null = null;
  let elapsed = -1;
  for (const call of input.deviations) {
    const e = criticalElapsedUs(
      call,
      timers[call.id] ?? 0,
      input.autoGuidanceActive === true,
    );
    if (e < 0) continue;
    if (active === null || e > elapsed) {
      active = call;
      elapsed = e;
    }
  }

  if (active === null) {
    return { ...state, timers, stage: "clear", activeId: null, elapsedUs: 0 };
  }

  const stage: EscalationStage =
    elapsed >= CORRECTION_WINDOW_US
      ? "abort"
      : elapsed >= FINAL_WARNING_US
        ? "final-warning"
        : "correct";

  const correctedIds = state.correctedIds.includes(active.id)
    ? state.correctedIds
    : [...state.correctedIds, active.id];

  return {
    timers,
    stage,
    activeId: active.id,
    elapsedUs: Math.max(0, elapsed),
    abortDirected: stage === "abort",
    scriptTerminated: stage === "abort",
    correctedIds,
  };
}

/** Seconds left before Houston directs the abort (0 once directed). */
export function secondsToAbort(state: HoustonEscalationState): number {
  if (state.stage === "clear") return Number.POSITIVE_INFINITY;
  if (state.stage === "abort") return 0;
  return Math.max(0, (CORRECTION_WINDOW_US - state.elapsedUs) / S);
}

/** The call Houston makes when the correction has not taken. */
export function escalatedCall(
  state: HoustonEscalationState,
  base: HoustonCall | null,
): HoustonCall | null {
  if (base === null) return null;
  if (state.activeId !== base.id) return base;
  if (state.stage === "abort") {
    return {
      ...base,
      id: `${base.id}-abort-directive`,
      severity: "no-go",
      text:
        "Eagle, Houston. Negative on the correction — ABORT, ABORT STAGE. " +
        "Get off the descent stage and fly the ascent engine.",
      guidance: "Hit ABORT STAGE now. The landing is off.",
      teaching:
        "Mission rules gave the crew a bounded window to correct a departure " +
        "from the descent profile. Past it, the safe outcome is a staged abort " +
        "to orbit, not a landing attempt — and the rest of the flown timeline " +
        "simply does not happen.",
      blocksLanding: true,
    };
  }
  if (state.stage === "final-warning") {
    const secs = Math.round(secondsToAbort(state));
    return {
      ...base,
      id: `${base.id}-final`,
      severity: "no-go",
      text: `Eagle, Houston. Last call — ${base.text} You have about ${secs} seconds before we call an abort.`,
      guidance: base.guidance,
      teaching: base.teaching,
      blocksLanding: true,
    };
  }
  return base;
}
