// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Pure reference-guidance profile (ADVISORY ONLY).
//
// This is a teaching aid: given a flight state it returns the sink rate,
// throttle and attitude a competent pilot would be holding. It is NOT the
// AGC, it is NOT Luminary's P63/P64, and nothing in the kernel or the Worker
// applies its output automatically. Closed-loop AGC control remains
// prohibited; this function never reads or writes AGC state.

import type { LunarFlightState } from "./types";
import type { LunarFlightParameters } from "./LunarMissionConstants";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "./LunarMissionConstants";
import { computeOrbitalValues, snapDescentThrottle, totalMassKg } from "./physics";

export interface LunarGuidanceCue {
  /** Target sink rate (negative = descending), m/s. */
  readonly targetRadialSpeedMps: number;
  /** Current minus target radial speed, m/s. Positive = too fast upward. */
  readonly radialSpeedErrorMps: number;
  /** Advisory throttle after descent-band snapping, [0, 1]. */
  readonly recommendedThrottle: number;
  /** Advisory body angle from local vertical, radians. */
  readonly recommendedAttitudeRad: number;
  /** Current minus recommended attitude, radians. */
  readonly attitudeErrorRad: number;
  readonly altitudeM: number;
  readonly horizontalSpeedMps: number;
  readonly advisory: string;
}

/** Time constants for the advisory controller, seconds. */
const VERTICAL_TAU_S = 4;
const HORIZONTAL_TAU_S = 12;
const MAX_ADVISORY_TILT_RAD = 1.05; // ~60 degrees

/**
 * Target sink-rate schedule: gentle near the surface, faster up high.
 * v_target = -min(45, 0.7 * sqrt(altitude)), floored at -0.6 m/s so the
 * vehicle keeps settling instead of hovering forever.
 */
export function targetSinkRate(altitudeM: number): number {
  if (altitudeM <= 0) return 0;
  const magnitude = Math.min(45, Math.max(0.6, 0.7 * Math.sqrt(altitudeM)));
  return -magnitude;
}

export function computeReferenceGuidance(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarGuidanceCue {
  const orbit = computeOrbitalValues(state, parameters);
  const mass = totalMassKg(state);
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const localG = mu / (orbit.radiusM * orbit.radiusM);

  const targetRadial = targetSinkRate(orbit.altitudeM);
  const radialError = orbit.radialSpeedMps - targetRadial;

  // Radial acceleration needed: cancel gravity, then drive the rate error out.
  const aRadial = localG + (targetRadial - orbit.radialSpeedMps) / VERTICAL_TAU_S;
  // Horizontal acceleration needed: null the tangential velocity.
  const aHorizontal = -orbit.tangentialSpeedMps / HORIZONTAL_TAU_S;

  let attitude = Math.atan2(aHorizontal, Math.max(aRadial, 1e-6));
  if (attitude > MAX_ADVISORY_TILT_RAD) attitude = MAX_ADVISORY_TILT_RAD;
  if (attitude < -MAX_ADVISORY_TILT_RAD) attitude = -MAX_ADVISORY_TILT_RAD;

  const requiredAccel = Math.hypot(aRadial, aHorizontal);
  const maxThrust =
    state.configuration === "ascent-stage"
      ? parameters.ascentEngine.thrustN.value
      : parameters.descentEngine.maxThrustN.value;
  const rawThrottle = maxThrust > 0 ? (requiredAccel * mass) / maxThrust : 0;
  const recommendedThrottle =
    state.configuration === "ascent-stage"
      ? rawThrottle > 0
        ? 1
        : 0
      : snapDescentThrottle(Math.min(1, Math.max(0, rawThrottle)), parameters);

  let advisory: string;
  if (state.terminalState !== null) {
    advisory = "Terminal state reached — guidance inactive.";
  } else if (orbit.altitudeM > 1_000) {
    advisory = "Braking phase: hold attitude against the velocity vector.";
  } else if (Math.abs(orbit.tangentialSpeedMps) > 2) {
    advisory = "Null horizontal velocity before committing to touchdown.";
  } else if (radialError < -1.5) {
    advisory = "Sink rate high — increase throttle.";
  } else if (radialError > 1.5) {
    advisory = "Sink rate low — reduce throttle and save propellant.";
  } else {
    advisory = "On profile.";
  }

  return {
    targetRadialSpeedMps: targetRadial,
    radialSpeedErrorMps: radialError,
    recommendedThrottle,
    recommendedAttitudeRad: attitude,
    attitudeErrorRad: state.attitudeRad - attitude,
    altitudeM: orbit.altitudeM,
    horizontalSpeedMps: orbit.tangentialSpeedMps,
    advisory,
  };
}
