// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — Guidance TARGETS: the only currency the guidance adapter accepts.
//
// The AGC never physically pushed the engine or the gimbals. It produced
// guidance intent, which the LM control and propulsion electronics turned into
// actuation. This module defines that intent as an explicit, provenance-tagged
// record so that:
//
//   * authentic Luminary output and the frozen reference guidance can be
//     compared side by side in SHADOW MODE, and
//   * the control adapter has one bounded input type regardless of origin.
//
// Nothing here reads AGC memory. Extraction of authentic targets from observed
// rope output is a separate, later step; until it exists the only producer is
// the reference profile, and its records say so.

import type { LunarFlightState } from "@/simulation/lunar2d/types";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";

/** Where a target record came from. Never inferred, always stated. */
export type GuidanceTargetOrigin =
  /** Decoded from the running Luminary 099 rope. */
  | "authentic-luminary"
  /** The frozen M4.0 advisory profile (historically grounded, not the rope). */
  | "reference-profile";

export type GuidanceProgramPhase = "p63" | "p64" | "p66" | "unknown";

export interface AgcGuidanceTargetsV1 {
  readonly version: 1;
  readonly origin: GuidanceTargetOrigin;
  readonly missionTimeUs: number;
  readonly programPhase: GuidanceProgramPhase;
  /** Commanded body angle from local vertical, radians. */
  readonly commandedAttitudeRad: number;
  /** Commanded attitude rate, rad/s. Zero when only an angle is commanded. */
  readonly attitudeRateTargetRadPerSec: number;
  /** Commanded radial rate (negative = descending), m/s. */
  readonly targetRadialSpeedMps: number;
  /** Throttle tendency in [0, 1]; the adapter decides the actual command. */
  readonly throttleTendency: number;
  /** Landing-point redesignation offset along track, meters. 0 when unused. */
  readonly landingPointOffsetM: number;
  /** Confidence in the record, [0, 1]. Reference records are advisory only. */
  readonly confidence: number;
  readonly label: string;
}

export const REFERENCE_TARGET_LABEL =
  "REFERENCE PROFILE TARGETS — ADVISORY, NOT ROPE OUTPUT";

export const AUTHENTIC_TARGET_LABEL =
  "AUTHENTIC LUMINARY GUIDANCE TARGETS";

function phaseForAltitude(altitudeM: number): GuidanceProgramPhase {
  if (altitudeM > 2_200) return "p63";
  if (altitudeM > 150) return "p64";
  return "p66";
}

/**
 * Build target records from the frozen advisory profile. This is the SHADOW
 * baseline: it is what the game already flies, expressed in target currency.
 */
export function referenceGuidanceTargets(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): AgcGuidanceTargetsV1 {
  const cue = computeReferenceGuidance(state, parameters);
  return {
    version: 1,
    origin: "reference-profile",
    missionTimeUs: state.missionTimeUs,
    programPhase: phaseForAltitude(cue.altitudeM),
    commandedAttitudeRad: cue.recommendedAttitudeRad,
    attitudeRateTargetRadPerSec: 0,
    targetRadialSpeedMps: cue.targetRadialSpeedMps,
    throttleTendency: cue.recommendedThrottle,
    landingPointOffsetM: 0,
    confidence: 0.5,
    label: REFERENCE_TARGET_LABEL,
  };
}

/** Structural validation. Rejects records the adapter must not act on. */
export function validateGuidanceTargets(
  t: AgcGuidanceTargetsV1,
): readonly string[] {
  const errors: string[] = [];
  const finite = (n: number) => Number.isFinite(n);
  if (t.version !== 1) errors.push("unsupported-version");
  if (!finite(t.commandedAttitudeRad)) errors.push("attitude-not-finite");
  if (!finite(t.attitudeRateTargetRadPerSec)) errors.push("rate-not-finite");
  if (!finite(t.targetRadialSpeedMps)) errors.push("radial-rate-not-finite");
  if (!(t.throttleTendency >= 0 && t.throttleTendency <= 1)) {
    errors.push("throttle-tendency-out-of-range");
  }
  if (!(t.confidence >= 0 && t.confidence <= 1)) errors.push("confidence-out-of-range");
  if (!Number.isInteger(t.missionTimeUs) || t.missionTimeUs < 0) {
    errors.push("mission-time-invalid");
  }
  if (t.label.length === 0) errors.push("missing-label");
  return errors;
}
