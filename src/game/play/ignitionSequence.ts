// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.7 — Pure PDI ignition-sequence state machine.
//
// Deterministic reducer: (state, event) -> state. No timers, no AGC access,
// no side effects. It models the crew ritual that precedes descent-engine
// ignition:
//
//   T-60 s  countdown running, ENG ARM still OFF
//   T-35 s  computer asks permission to ignite (flashing V99 N62)
//   ...     Aldrin sets ENG ARM to DESCENT; PROCEED is refused until he does
//   PRO     crew answers the request
//   T-7.5 s RCS +X ullage settles the propellant
//   T-0     ignition at the 10 % fixed-throttle point
//   T+26 s  throttle up to maximum
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// Our Luminary 099 runs authentically but is not flying the vehicle, so the
// rope never raises the real flashing V99. This module produces that request
// itself and every consumer must label it as a bridged overlay. The player's
// keystrokes still go to the real computer; nothing here is injected into the
// AGC and nothing here reads AGC state.

import { milestoneSec } from "./descentTimeline";

export type IgnitionPhase =
  | "standby"
  | "countdown"
  | "ignition-request"
  | "ullage"
  | "burning"
  | "aborted";

export interface CrewCallout {
  /** Seconds relative to TIG; negative is before ignition. */
  readonly atTigSeconds: number;
  readonly speaker: "Armstrong" | "Aldrin" | "Duke (CAPCOM)" | "Vehicle";
  readonly text: string;
  /** True when the wording is popularly attributed rather than transcript-exact. */
  readonly attributed: boolean;
}

export interface IgnitionSequenceState {
  readonly phase: IgnitionPhase;
  /** Microseconds until TIG; negative after ignition. */
  readonly tigOffsetUs: number;
  readonly engineArmed: boolean;
  readonly masterArm: boolean;
  readonly proAccepted: boolean;
  /** True while the bridged V99 N62 request is displayed and flashing. */
  readonly requestFlashing: boolean;
  /** Microseconds since ignition; 0 before TIG. */
  readonly sinceIgnitionUs: number;
  /** Callouts already spoken, oldest first. */
  readonly spoken: readonly CrewCallout[];
  readonly lastMessage: string;
  /** Set when PRO was pressed with ENG ARM off. */
  readonly armFault: boolean;
}

export type IgnitionEvent =
  | { readonly kind: "start" }
  | { readonly kind: "tick"; readonly dtUs: number }
  | { readonly kind: "arm"; readonly on: boolean }
  | { readonly kind: "proceed" }
  | { readonly kind: "abort" };

// --- Timing constants --------------------------------------------------------

const S = 1_000_000;

/** Countdown length presented to the player before TIG. */
export const COUNTDOWN_LENGTH_US = 60 * S;
/** The computer asks permission to ignite at TIG-35 s. */
export const IGNITION_REQUEST_US = 35 * S;
/** RCS +X ullage begins at TIG-7.5 s. */
export const ULLAGE_START_US = 7.5 * S;
/** DPS holds the 10 % fixed-throttle point for 26 s after ignition. */
export const FIXED_THROTTLE_DURATION_US = 26 * S;
/** Descent-engine fixed-throttle-point fraction. */
export const FIXED_THROTTLE_FRACTION = 0.1;
/** Ramp from FTP to guidance throttle, seconds. */
const THROTTLE_UP_RAMP_US = 2 * S;


export const IGNITION_CITATION = {
  label: "Apollo 11 Flight Plan / LM Timeline Book / Apollo 11 air-to-ground transcript",
  detail:
    "PDI ritual order (ENG ARM to DESCENT, flashing V99 ignition request at " +
    "TIG-35 s answered with PROCEED, +X ullage at TIG-7.5 s, ignition at the " +
    "10 % fixed-throttle point, throttle-up at TIG+26 s) follows the published " +
    "timeline. Crew wording is transcript-derived except where marked attributed.",
} as const;

export const CREW_CALLOUTS: readonly CrewCallout[] = [
  {
    atTigSeconds: -60,
    speaker: "Aldrin",
    text: "Coming up on the PDI point. Standing by.",
    attributed: true,
  },
  {
    atTigSeconds: -40,
    speaker: "Duke (CAPCOM)",
    text: "Eagle, Houston. You are GO for powered descent.",
    attributed: false,
  },
  {
    atTigSeconds: -35,
    speaker: "Aldrin",
    text: "Flashing 99 — the computer wants permission to ignite.",
    attributed: true,
  },
  {
    atTigSeconds: -20,
    speaker: "Armstrong",
    text: "PROCEED.",
    attributed: false,
  },
  {
    atTigSeconds: -7.5,
    speaker: "Vehicle",
    text: "Ullage — RCS +X settling the descent propellant.",
    attributed: true,
  },
  {
    atTigSeconds: 0,
    speaker: "Aldrin",
    text: "Ignition. Burn, baby, burn.",
    attributed: true,
  },
  {
    atTigSeconds: 5,
    speaker: "Aldrin",
    text: "Ten percent — holding the fixed-throttle point.",
    attributed: true,
  },
  {
    atTigSeconds: 26,
    speaker: "Aldrin",
    text: "Throttle up. Looks good.",
    attributed: false,
  },
];

// --- Reducer -----------------------------------------------------------------

export function createIgnitionState(): IgnitionSequenceState {
  return {
    phase: "standby",
    tigOffsetUs: COUNTDOWN_LENGTH_US,
    engineArmed: false,
    masterArm: false,
    proAccepted: false,
    requestFlashing: false,
    sinceIgnitionUs: 0,
    spoken: [],
    lastMessage: "Pre-ignition sequence on standby.",
    armFault: false,
  };
}

function withCallouts(state: IgnitionSequenceState): IgnitionSequenceState {
  const tigS = state.tigOffsetUs / S;
  const due = CREW_CALLOUTS.filter((c) => -tigS >= c.atTigSeconds);
  if (due.length === state.spoken.length) return state;
  return { ...state, spoken: due };
}

export function reduceIgnition(
  state: IgnitionSequenceState,
  event: IgnitionEvent,
): IgnitionSequenceState {
  if (state.phase === "aborted") return state;

  switch (event.kind) {
    case "start":
      return state.phase === "standby"
        ? {
            ...state,
            phase: "countdown",
            lastMessage: "PDI countdown running. Arm the descent engine.",
          }
        : state;

    case "abort":
      return { ...state, phase: "aborted", lastMessage: "Ignition sequence aborted." };

    case "arm":
      if (state.phase === "standby") return state;
      return {
        ...state,
        engineArmed: event.on,
        masterArm: event.on,
        armFault: event.on ? false : state.armFault,
        lastMessage: event.on
          ? "ENG ARM — DESCENT. Descent engine armed."
          : "ENG ARM — OFF. Descent engine safed.",
      };

    case "proceed": {
      if (state.phase !== "ignition-request" && state.phase !== "countdown") return state;
      if (!state.engineArmed) {
        return {
          ...state,
          armFault: true,
          lastMessage: "PROCEED refused — ENG ARM is OFF. Arm the descent engine first.",
        };
      }
      if (state.phase !== "ignition-request") {
        return {
          ...state,
          lastMessage: "The computer has not asked yet — stand by for the flashing 99.",
        };
      }
      return {
        ...state,
        proAccepted: true,
        requestFlashing: false,
        phase: "countdown",
        lastMessage: "PROCEED accepted — engine ignition enabled.",
      };
    }

    case "tick": {
      if (state.phase === "standby" || event.dtUs <= 0) return state;

      const tigOffsetUs = state.tigOffsetUs - event.dtUs;
      const ignited = tigOffsetUs <= 0;
      const sinceIgnitionUs = ignited ? -tigOffsetUs : 0;

      let phase: IgnitionPhase = state.phase;
      let requestFlashing = state.requestFlashing;
      let lastMessage = state.lastMessage;

      if (ignited) {
        phase = "burning";
      } else if (!state.proAccepted && tigOffsetUs <= IGNITION_REQUEST_US) {
        phase = "ignition-request";
        if (!requestFlashing) {
          requestFlashing = true;
          lastMessage = "Flashing V99 N62 — the computer requests engine ignition. Press PRO.";
        }
      } else if (state.proAccepted && tigOffsetUs <= ULLAGE_START_US) {
        phase = "ullage";
      } else {
        phase = "countdown";
      }

      // The engine cannot light without both the crew's PROCEED and ENG ARM.
      if (ignited && (!state.proAccepted || !state.engineArmed)) {
        return withCallouts({
          ...state,
          phase: "aborted",
          tigOffsetUs,
          sinceIgnitionUs,
          requestFlashing: false,
          lastMessage: state.proAccepted
            ? "TIG passed with ENG ARM off — no ignition. The descent is missed."
            : "TIG passed without PROCEED — no ignition. The descent is missed.",
        });
      }

      if (ignited && state.phase !== "burning") {
        lastMessage = "Ignition — descent engine at the 10 % fixed-throttle point.";
      }

      return withCallouts({
        ...state,
        phase,
        tigOffsetUs,
        sinceIgnitionUs,
        requestFlashing,
        lastMessage,
      });
    }
  }
}

// --- Derived helpers ---------------------------------------------------------

/** True once the descent engine is lit. */
export function isBurning(state: IgnitionSequenceState): boolean {
  return state.phase === "burning";
}

/**
 * Upper bound on descent-engine throttle imposed by the DPS start profile:
 * 10 % for the first 26 s, then a short ramp to full authority. Returns 0
 * before ignition and 1 once the profile is complete.
 */
export function throttleCeiling(state: IgnitionSequenceState): number {
  if (state.phase !== "burning") return 0;
  return throttleCeilingForSinceIgnition(state.sinceIgnitionUs);
}

/**
 * The DPS start profile as a pure function of ignition-relative time: 10 % for
 * the first 26 s while the engine settles, then a 2 s ramp to the fixed
 * throttle point. Used by any entry path into the burn, so the throttle always
 * matches the "ignition, ten percent" call.
 */
export function throttleCeilingForSinceIgnition(sinceIgnitionUs: number): number {
  return dpsThrottleEnvelope(sinceIgnitionUs).max;
}

/**
 * Thrust at the fixed throttle point. The DPS was flown at maximum rated
 * thrust for the braking phase, which Luminary commands as 92.5 %.
 */
export const FTP_FRACTION = 0.925;

/**
 * The descent engine could not be run continuously between about 65 % and the
 * fixed throttle point: sustained operation in that band eroded the nozzle.
 * Guidance therefore only modulates between 10 % and 60 %.
 */
export const MIN_VARIABLE_THROTTLE = 0.1;
export const MAX_VARIABLE_THROTTLE = 0.6;

/**
 * "Throttle recovery": guidance leaves the fixed throttle point and steps the
 * engine straight down into the variable range (about 57 %), at T+6:26.
 */
export const THROTTLE_RECOVERY_SINCE_IGNITION_US =
  milestoneSec("throttle-down") * S;

export interface DpsThrottleEnvelope {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

/**
 * The flown DPS throttle profile as a pure function of ignition-relative time:
 *
 *   T+00:00  10 % for 26 s while the engine settles and the gimbal trims
 *   T+00:26  ramp to the fixed throttle point, 92.5 %, and hold it
 *   T+06:26  throttle recovery — straight down to the 10-60 % variable range,
 *            skipping the erosion band, and modulated from there on
 */
export function dpsThrottleEnvelope(sinceIgnitionUs: number): DpsThrottleEnvelope {
  const t = sinceIgnitionUs;
  if (t < 0) return { min: 0, max: 0, label: "ENGINE OFF" };
  if (t < FIXED_THROTTLE_DURATION_US) {
    return {
      min: FIXED_THROTTLE_FRACTION,
      max: FIXED_THROTTLE_FRACTION,
      label: "10 % · GIMBAL TRIM",
    };
  }
  if (t >= THROTTLE_RECOVERY_SINCE_IGNITION_US) {
    return {
      min: MIN_VARIABLE_THROTTLE,
      max: MAX_VARIABLE_THROTTLE,
      label: "THROTTLE RECOVERY · 10-60 % VARIABLE",
    };
  }
  const ramp = (t - FIXED_THROTTLE_DURATION_US) / THROTTLE_UP_RAMP_US;
  const level =
    ramp >= 1
      ? FTP_FRACTION
      : FIXED_THROTTLE_FRACTION + (FTP_FRACTION - FIXED_THROTTLE_FRACTION) * ramp;
  return { min: level, max: level, label: "FTP · 92.5 %" };
}

/** "T-01:05" / "T+00:26" clock face for the countdown. */
export function formatTig(state: IgnitionSequenceState): string {
  const totalS = Math.abs(state.tigOffsetUs) / S;
  const sign = state.tigOffsetUs > 0 ? "-" : "+";
  const mm = Math.floor(totalS / 60);
  const ss = totalS - mm * 60;
  return `T${sign}${String(mm).padStart(2, "0")}:${ss.toFixed(1).padStart(4, "0")}`;
}

/** The bridged DSKY request this sequence is asking the panel to display. */
export interface BridgedDskyRequest {
  readonly verb: string;
  readonly noun: string;
  readonly flashing: boolean;
  readonly label: string;
}

export function bridgedRequestFor(
  state: IgnitionSequenceState,
): BridgedDskyRequest | null {
  if (!state.requestFlashing) return null;
  return {
    verb: "99",
    noun: "62",
    flashing: true,
    label: "PLEASE ENABLE ENGINE IGNITION",
  };
}
