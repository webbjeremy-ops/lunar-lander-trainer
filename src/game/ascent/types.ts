// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Player-facing lunar-ascent game types.
//
// PHYSICS FIREWALL: nothing in src/game/** reads AGC state and nothing here is
// ever applied to the AGC. The live Luminary099 session next to the ascent
// cockpit is display-and-keypad only; its output never reaches
// `stepLunarFlight`, and the vehicle never writes to the AGC.

import type { AssistanceLevel } from "@/game/play/types";
import type { LunarFlightState } from "@/simulation/lunar2d/types";

export type { AssistanceLevel };

export type AscentMissionId =
  | "liftoff-fundamentals"
  | "orbital-insertion-trainer"
  | "apollo11-ascent-challenge"
  | "orbit-sandbox";

/** Coarse phase of the ascent experience. Distinct from AGC major modes. */
export type AscentPhase =
  | "surface-preparation"
  | "vertical-rise"
  | "pitch-over"
  | "orbital-acceleration"
  | "coast"
  | "complete";

export type AscentOutcome =
  | "in-flight"
  | "orbit-achieved"
  | "insufficient-periapsis"
  | "surface-impact"
  | "propellant-depleted";

/** A target orbit expressed the way the flight plans did: peri x apo. */
export interface TargetOrbit {
  readonly id: string;
  readonly label: string;
  readonly periapsisAltitudeM: number;
  readonly apoapsisAltitudeM: number;
  readonly classification:
    | "source-derived"
    | "historically-grounded-estimate"
    | "gameplay-tuned";
  readonly sourceId: string | null;
  readonly rationale: string;
}

export interface AscentMissionDefinition {
  readonly id: AscentMissionId;
  readonly version: number;
  readonly title: string;
  readonly subtitle: string;
  readonly summary: string;
  readonly objective: string;
  readonly order: number;
  /** Target orbit id in ASCENT_TARGETS. */
  readonly targetOrbitId: string;
  /** Usable APS propellant loaded for this mission, kg. */
  readonly ascentPropellantKg: number;
  readonly rcsPropellantKg: number;
  /** Periapsis at or above which the orbit counts as safe, metres. */
  readonly safePeriapsisAltitudeM: number;
  /** Nominal vertical-rise duration before the pitch-over cue, seconds. */
  readonly verticalRiseSeconds: number;
  /** Guidance insertion altitude used by the advisory pitch program, metres. */
  readonly insertionAltitudeM: number;
  readonly defaultAssistance: AssistanceLevel;
  /**
   * Sandbox missions never latch a terminal orbit state and allow a second
   * (phasing) burn with the propellant that is left.
   */
  readonly sandbox: boolean;
  readonly historicalNote: string;
}

export interface AscentSummary {
  readonly missionId: AscentMissionId;
  readonly assistance: AssistanceLevel;
  readonly outcome: AscentOutcome;
  readonly finalState: LunarFlightState;
  readonly target: TargetOrbit;
  readonly periapsisAltitudeM: number;
  readonly apoapsisAltitudeM: number | null;
  readonly cutoffMissionTimeUs: number | null;
  readonly cutoffAltitudeM: number | null;
  readonly cutoffRadialSpeedMps: number | null;
  readonly staged: boolean;
  readonly stagingMissionTimeUs: number | null;
  readonly ascentPropellantRemainingKg: number;
  readonly ascentPropellantInitialKg: number;
  readonly rcsPropellantRemainingKg: number;
  readonly deltaVRemainingMps: number;
  /** Mean absolute control-rate metric; lower is smoother. */
  readonly controlRoughness: number;
  /** True when the demonstration autopilot flew any part of the ascent. */
  readonly demonstrationUsed: boolean;
}
