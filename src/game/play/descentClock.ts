// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.13B — Pure descent-sequence clock.
//
// The roll cue, the crew/CAPCOM callouts and the 1201/1202 program alarms are
// all keyed to time-since-ignition. The player can reach the burn several ways
// (full PDI ritual, skipped ritual, aborted countdown, or an auto-guidance
// mode), and the historical script must never be silently skipped. This module
// is the single deterministic state machine that decides whether the descent
// clock is idle, holding at T-0, or running — and what it reads.
//
// Pure: (state, input) -> state. No timers, no AGC access, no side effects.

export type DescentClockMode = "idle" | "held" | "running";

export interface DescentClockState {
  readonly mode: DescentClockMode;
  /** Microseconds since ignition (or since the fallback start). */
  readonly sinceIgnitionUs: number;
  /** True when the clock is mirroring the PDI ritual's own ignition clock. */
  readonly ritual: boolean;
}

export interface DescentClockInput {
  /** Ignition-relative microseconds from the PDI ritual; 0 before TIG. */
  readonly ritualSinceIgnitionUs: number;
  /** True while the countdown/ritual is armed (phase !== "standby"). */
  readonly countdownArmed: boolean;
  /** True when the countdown was abandoned. */
  readonly countdownAborted: boolean;
  /** True once the descent engine is producing thrust. */
  readonly engineBurning: boolean;
  /** True once the procedure script has released the flight lock. */
  readonly flightLockReleased: boolean;
  /** Fixed integration step in microseconds. */
  readonly stepUs: number;
}

export function createDescentClockState(): DescentClockState {
  return { mode: "idle", sinceIgnitionUs: 0, ritual: false };
}

/**
 * Advance the clock by one fixed step.
 *
 * Rules:
 *  - The ritual wins: as soon as the PDI sequence reports time past TIG, the
 *    clock mirrors it exactly (single timebase with the crew callouts).
 *  - While the countdown is armed but pre-TIG the clock HOLDS at zero — the
 *    vehicle is still coasting toward ignition.
 *  - Otherwise the clock starts (and free-runs) as soon as the descent is under
 *    way: engine lit, countdown aborted, or the flight lock released without
 *    any ritual at all.
 *  - Once running it never returns to held/idle; time is monotonic.
 */
export function stepDescentClock(
  state: DescentClockState,
  input: DescentClockInput,
): DescentClockState {
  if (input.ritualSinceIgnitionUs > 0) {
    if (
      state.mode === "running" &&
      state.ritual &&
      state.sinceIgnitionUs === input.ritualSinceIgnitionUs
    ) {
      return state;
    }
    return {
      mode: "running",
      sinceIgnitionUs: input.ritualSinceIgnitionUs,
      ritual: true,
    };
  }

  if (state.mode === "running") {
    return {
      mode: "running",
      sinceIgnitionUs: state.sinceIgnitionUs + input.stepUs,
      ritual: state.ritual,
    };
  }

  // Pre-TIG hold: the ritual is counting down, ignition has not happened.
  const holding =
    input.countdownArmed && !input.countdownAborted && !input.engineBurning;
  if (holding) {
    return state.mode === "held"
      ? state
      : { mode: "held", sinceIgnitionUs: 0, ritual: false };
  }

  const started =
    input.engineBurning || input.countdownAborted || input.flightLockReleased;
  if (!started) {
    return state.mode === "idle" ? state : createDescentClockState();
  }

  return { mode: "running", sinceIgnitionUs: input.stepUs, ritual: false };
}

/** T+MM:SS caption for the cockpit header. */
export function formatDescentClock(state: DescentClockState): string {
  if (state.mode !== "running") return "T+00:00";
  const totalSeconds = Math.floor(state.sinceIgnitionUs / 1_000_000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `T+${mm}:${ss}`;
}

export function descentClockStatusLabel(state: DescentClockState): string {
  switch (state.mode) {
    case "running":
      return state.ritual ? "SEQUENCE RUNNING (PDI)" : "SEQUENCE RUNNING";
    case "held":
      return "SEQUENCE HOLD (PRE-TIG)";
    default:
      return "SEQUENCE IDLE";
  }
}
