// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Player-facing lunar-descent game types.
//
// Nothing in src/game/** reads AGC state, and nothing here is ever applied to
// the AGC. The AGC session remains observational: authentic Luminary099
// execution drives the DSKY displays and consumes the player's keystrokes,
// but its output never reaches `stepLunarFlight`.

import type { LunarFlightState } from "@/simulation/lunar2d/types";
import type { AlarmScoreInput } from "./programAlarms";

/** How much cueing the game provides. Cues are advisory only. */
export type AssistanceLevel = "instructor" | "pilot" | "commander";

/** How the descent is flown. */
export type ControlModeId = "quick-manual" | "agc-assisted" | "training";

export type MissionId =
  | "landing-fundamentals"
  | "full-descent"
  | "free-flight";

/** Coarse phase of the player experience (distinct from AGC major modes). */
export type PlayPhase =
  | "briefing"
  | "procedure"
  | "guided-flight"
  | "manual-flight"
  | "debrief";

export interface LandingLimits {
  readonly verticalSpeedMps: number;
  readonly horizontalSpeedMps: number;
  readonly tiltRad: number;
  /** Distance from the landing-zone centre that still counts as "on target". */
  readonly landingZoneRadiusM: number;
}

export interface Hazard {
  /** Central angle offset from the landing-zone centre, radians. */
  readonly angleOffsetRad: number;
  readonly radiusM: number;
  readonly kind: "crater" | "boulder-field";
  readonly label: string;
}

export interface MissionDefinition {
  readonly id: MissionId;
  readonly version: number;
  readonly title: string;
  readonly subtitle: string;
  readonly summary: string;
  readonly objective: string;
  /** Ordering hint for the recommended progression. */
  readonly order: number;
  /** Initial planar state (fed to `createLunarFlightState`). */
  readonly initial: {
    readonly altitudeM: number;
    readonly radialSpeedMps: number;
    readonly tangentialSpeedMps: number;
    readonly attitudeRad: number;
    readonly descentPropellantKg: number;
    /** Downrange distance from the landing zone at t0, metres. */
    readonly rangeToLandingZoneM: number;
  };
  readonly defaultControlMode: ControlModeId;
  readonly availableControlModes: readonly ControlModeId[];
  readonly defaultAssistance: AssistanceLevel;
  readonly hazards: readonly Hazard[];
  /** Historical framing shown in the briefing. Never claims exactness. */
  readonly historicalNote: string;
}

export interface FlightControlInputState {
  readonly throttle: number;
  readonly attitudeCommand: number;
  readonly engineOn: boolean;
}

/** Everything the debrief needs that the flight state does not carry. */
export interface TakeoverRecord {
  readonly missionTimeUs: number;
  readonly altitudeM: number;
  readonly horizontalSpeedMps: number;
  readonly verticalSpeedMps: number;
  readonly descentPropellantKg: number;
  readonly early: boolean;
}

export interface FlightSummary {
  readonly missionId: MissionId;
  readonly controlMode: ControlModeId;
  readonly assistance: AssistanceLevel;
  readonly finalState: LunarFlightState;
  /** Signed downrange miss distance from the landing-zone centre, metres. */
  readonly landingZoneErrorM: number;
  readonly descentPropellantRemainingKg: number;
  readonly descentPropellantInitialKg: number;
  /** Mean absolute control-rate metric; lower is smoother. */
  readonly controlRoughness: number;
  readonly takeover: TakeoverRecord | null;
  readonly procedure: ProcedureScoreInput;
  /** M4.8 — program-alarm handling, when the mission raises alarms. */
  readonly alarms?: AlarmScoreInput;
  /** M4.8 — true when the crew rolled windows-up before radar acquisition. */
  readonly rolledWindowsUp?: boolean;
  readonly limits: LandingLimits;
}

export interface ProcedureScoreInput {
  readonly required: number;
  readonly completed: number;
  readonly incorrectEntries: number;
  readonly hintsUsed: number;
  /** True when the player deliberately chose Quick Manual. */
  readonly skipped: boolean;
  /** Mean seconds between prompt and correct entry. */
  readonly meanResponseSeconds: number;
}
