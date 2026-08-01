// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.8 — Pure windows-up roll state machine.
//
// Apollo 11 flew the early braking phase face-down (windows toward space) so
// the descent engine pointed retrograde with the landing radar looking away
// from the surface. A few minutes after PDI the crew rolled the vehicle 180°
// to windows-up, which put the landing-radar antenna face-down toward the
// surface and gave the crew their first look at the ground. Radar acquisition,
// the Delta-H comparison and the V57 radar acceptance all follow that roll.
//
// MODELLING NOTE — NO NEW PHYSICS
// -------------------------------
// The deterministic flight kernel (src/simulation/lunar2d) is planar and
// carries a single pitch angle. Roll is therefore modelled here as a COCKPIT
// ORIENTATION STATE, not as a degree of freedom of the vehicle dynamics.
// Nothing in this module is read by the kernel, and the kernel's golden
// touchdown fixture is unaffected. What the roll does affect is the crew
// procedure: while the vehicle is still windows-down the landing radar cannot
// acquire, so the radar steps stay locked.
//
// Deterministic reducer: (state, event) -> state. No timers, no AGC access,
// no side effects.

import { milestoneSec } from "./descentTimeline";

const S = 1_000_000;

export type RollPhase = "windows-down" | "rolling" | "windows-up";

export interface DescentRollState {
  /** Roll angle about the vehicle X axis, degrees. 180 = windows-down, 0 = windows-up. */
  readonly rollDeg: number;
  readonly phase: RollPhase;
  /** True while the player holds the roll control. */
  readonly commanded: boolean;
  /** True once the crew cue to roll windows-up has been given. */
  readonly cueGiven: boolean;
  /** Microseconds since ignition at which windows-up was reached; null until then. */
  readonly completedSinceIgnitionUs: number | null;
  readonly lastMessage: string;
}

export type DescentRollEvent =
  | { readonly kind: "tick"; readonly dtUs: number; readonly sinceIgnitionUs: number }
  | { readonly kind: "roll"; readonly active: boolean };

// --- Constants ---------------------------------------------------------------

/** Vehicle attitude at PDI: windows-down, radar looking away from the surface. */
export const INITIAL_ROLL_DEG = 180;

/**
 * Roll rate flown by the player, deg/s. The LM's RCS roll authority in the
 * loaded descent configuration was of this order; a 180° roll therefore takes
 * about 18 s of continuous command, comparable with the real maneuver.
 */
export const ROLL_RATE_DEG_PER_SEC = 10;

/** Within this many degrees of 0° the vehicle counts as windows-up. */
export const WINDOWS_UP_TOLERANCE_DEG = 5;

/**
 * The crew cue to roll windows-up is given at the canonical yaw-around
 * milestone (T+200 s), the SAME timebase entry the Aldrin transcript call and
 * the procedure step use, so the cockpit cue can never precede the callout.
 */
export const ROLL_CUE_SINCE_IGNITION_US = milestoneSec("yaw-around") * S;

export const ROLL_CITATION = {
  label: "Apollo 11 Flight Plan / LM Timeline Book / Apollo 11 Mission Report",
  detail:
    "Eagle flew the early braking phase windows-down and rolled to windows-up " +
    "a few minutes after PDI, after which the landing radar acquired the " +
    "surface and the crew could see landmarks. The roll is modelled as a " +
    "cockpit orientation state; the planar flight kernel is unchanged.",
} as const;

export interface RollCallout {
  readonly speaker: "Armstrong" | "Aldrin" | "Duke (CAPCOM)" | "Vehicle";
  readonly text: string;
}

export const ROLL_CUE_CALLOUT: RollCallout = {
  speaker: "Aldrin",
  text: "Coming up on the roll — windows up, let's get the radar looking down.",
};

export const ROLL_COMPLETE_CALLOUT: RollCallout = {
  speaker: "Armstrong",
  text: "Rolling — windows up. There's the ground.",
};

// --- Reducer -----------------------------------------------------------------

export function createDescentRollState(): DescentRollState {
  return {
    rollDeg: INITIAL_ROLL_DEG,
    phase: "windows-down",
    commanded: false,
    cueGiven: false,
    completedSinceIgnitionUs: null,
    lastMessage: "Windows-down — landing radar is looking away from the surface.",
  };
}

function phaseFor(rollDeg: number): RollPhase {
  if (rollDeg <= WINDOWS_UP_TOLERANCE_DEG) return "windows-up";
  if (rollDeg >= INITIAL_ROLL_DEG - WINDOWS_UP_TOLERANCE_DEG) return "windows-down";
  return "rolling";
}

export function reduceDescentRoll(
  state: DescentRollState,
  event: DescentRollEvent,
): DescentRollState {
  switch (event.kind) {
    case "roll": {
      if (state.commanded === event.active) return state;
      if (state.phase === "windows-up") {
        return { ...state, commanded: false };
      }
      return {
        ...state,
        commanded: event.active,
        lastMessage: event.active
          ? "Rolling right — hold until the roll indicator reads windows-up."
          : "Roll stopped.",
      };
    }

    case "tick": {
      if (event.dtUs <= 0) return state;

      let next = state;

      if (!next.cueGiven && event.sinceIgnitionUs >= ROLL_CUE_SINCE_IGNITION_US) {
        next = {
          ...next,
          cueGiven: true,
          lastMessage:
            "Crew cue — roll windows-up so the landing radar can see the surface.",
        };
      }

      if (!next.commanded || next.phase === "windows-up") return next;

      const rollDeg = Math.max(0, next.rollDeg - ROLL_RATE_DEG_PER_SEC * (event.dtUs / S));
      const phase = phaseFor(rollDeg);
      // The guard above returned early when we were already windows-up, so
      // reaching it now is always the completing transition.
      const justCompleted = phase === "windows-up";
      return {
        ...next,
        rollDeg,
        phase,
        commanded: justCompleted ? false : next.commanded,
        completedSinceIgnitionUs: justCompleted
          ? event.sinceIgnitionUs
          : next.completedSinceIgnitionUs,
        lastMessage: justCompleted
          ? "Windows up — landing radar has a look at the surface."
          : next.lastMessage,
      };
    }
  }
}

// --- Derived helpers ---------------------------------------------------------

/**
 * The landing radar can only acquire once the antenna faces the surface, which
 * happens when the vehicle is windows-up.
 */
export function radarAvailable(state: DescentRollState): boolean {
  return state.phase === "windows-up";
}

/** Fraction of the 180° maneuver completed, 0..1. */
export function rollProgress(state: DescentRollState): number {
  const done = (INITIAL_ROLL_DEG - state.rollDeg) / INITIAL_ROLL_DEG;
  return done < 0 ? 0 : done > 1 ? 1 : done;
}

/** "180° · WINDOWS DOWN" style label for the cockpit indicator. */
export function describeRoll(state: DescentRollState): string {
  const label =
    state.phase === "windows-up"
      ? "WINDOWS UP"
      : state.phase === "windows-down"
        ? "WINDOWS DOWN"
        : "ROLLING";
  return `${state.rollDeg.toFixed(0)}° · ${label}`;
}
