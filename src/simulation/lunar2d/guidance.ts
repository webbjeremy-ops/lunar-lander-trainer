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
 * Braking-phase attitude authority. The real LM flew the braking phase with
 * the thrust vector almost horizontal (pitch 80-88 degrees from local
 * vertical), which is the only way the downrange velocity is killed inside the
 * available range. The 60-degree cap above is a terminal-phase limit.
 */
const MAX_BRAKING_TILT_RAD = 1.48; // ~85 degrees
/** Vertical error is flown out on this time constant during braking, seconds. */
const BRAKING_ALTITUDE_TAU_S = 45;
/** Sink-rate authority during braking, m/s. */
const BRAKING_MAX_SINK_MPS = 45;
/**
 * Once the stopping law needs more than this deceleration the vehicle is late
 * braking, and it takes priority over the nominal speed profile, m/s².
 */
const BRAKING_STOP_OVERRIDE_MPS2 = 2.8;
/** Braking-phase downrange velocity loop time constant, seconds. */
const BRAKING_SPEED_TAU_S = 20;
/** Closing deceleration used to fly the last kilometres onto the site, m/s². */
const APPROACH_CLOSING_ACCEL = 0.6;
/** Time constant for the approach-phase downrange velocity loop, seconds. */
const APPROACH_TAU_S = 8;

/**
 * Range-aware braking target. When the caller knows how far the vehicle still
 * has to run to the landing zone, and what altitude the canonical descent
 * profile wants at that range, guidance flies the trajectory ONTO that
 * profile instead of merely nulling velocity where it happens to be — which
 * is what let the vehicle sail tens of kilometres past the site.
 */
export interface BrakingTarget {
  /** Range still to run to the landing zone along the surface, metres. */
  readonly rangeToLandingZoneM: number;
  /** Altitude the canonical profile wants at this range, metres. */
  readonly targetAltitudeM: number;
  /** Range at which the braking phase hands over to the approach phase. */
  readonly handoverRangeM: number;
  /**
   * Throttle the engine is pinned to by the DPS profile (the 92.5 % fixed
   * throttle point). When set, guidance cannot use thrust magnitude as a
   * control: it steers the FIXED thrust vector instead, choosing the pitch
   * whose vertical component meets the profile — exactly how the braking
   * phase was flown.
   */
  readonly fixedThrottle?: number | null;
  /**
   * Downrange closing speed the canonical profile wants at this range, m/s.
   * Guidance brakes onto it rather than simply nulling velocity, so the burn
   * stays on the 13-minute clock. Positive = closing on the site.
   */
  readonly targetDownrangeSpeedMps?: number | null;
}

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
  braking: BrakingTarget | null = null,
): LunarGuidanceCue {
  const orbit = computeOrbitalValues(state, parameters);
  const mass = totalMassKg(state);
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const localG = mu / (orbit.radiusM * orbit.radiusM);

  // Braking / approach phases: fly the canonical range/altitude profile.
  const signedRange = braking?.rangeToLandingZoneM ?? 0;
  const inBraking =
    braking !== null &&
    signedRange > braking.handoverRangeM &&
    Math.abs(orbit.tangentialSpeedMps) > 5;

  let targetRadial: number;
  let aRadial: number;
  let aHorizontal: number;
  let tiltLimit = MAX_ADVISORY_TILT_RAD;

  if (braking !== null) {
    const v = orbit.tangentialSpeedMps;
    if (inBraking) {
      // Deceleration that brings the downrange velocity to the approach-phase
      // hand-over inside the range that is actually left to run.
      const runoutM = Math.max(500, signedRange - braking.handoverRangeM);
      // Safety law: constant deceleration that stops the downrange motion by
      // high gate. Never brake less than this.
      const stopping = -Math.sign(v) * ((v * v) / (2 * runoutM));
      const profileSpeed = braking.targetDownrangeSpeedMps ?? null;
      if (profileSpeed !== null) {
        const desired = Math.sign(signedRange || 1) * Math.abs(profileSpeed);
        const onProfile = (desired - v) / BRAKING_SPEED_TAU_S;
        // Fly the profile speed; only fall back on the stopping law when the
        // vehicle is genuinely late braking and needs more than the profile.
        aHorizontal =
          Math.abs(stopping) > BRAKING_STOP_OVERRIDE_MPS2 ? stopping : onProfile;
      } else {
        aHorizontal = stopping;
      }
      tiltLimit = MAX_BRAKING_TILT_RAD;
    } else {
      // Approach: close the last kilometres to the site and arrive with the
      // downrange velocity nulled over the aim point.
      const s = Math.abs(signedRange);
      const desired =
        s < 30
          ? 0
          : Math.sign(signedRange) * Math.min(60, Math.sqrt(2 * APPROACH_CLOSING_ACCEL * s));
      aHorizontal = (desired - v) / APPROACH_TAU_S;
    }

    // Vertical: hold the profile altitude for the range still to run, but
    // never sink faster than the altitude schedule allows.
    const altitudeError = braking.targetAltitudeM - orbit.altitudeM;
    targetRadial = Math.max(
      Math.max(-BRAKING_MAX_SINK_MPS, targetSinkRate(orbit.altitudeM)),
      Math.min(5, altitudeError / BRAKING_ALTITUDE_TAU_S),
    );
    aRadial = localG + (targetRadial - orbit.radialSpeedMps) / (VERTICAL_TAU_S * 2);
  } else {
    targetRadial = targetSinkRate(orbit.altitudeM);
    // Radial acceleration needed: cancel gravity, then drive the rate error out.
    aRadial = localG + (targetRadial - orbit.radialSpeedMps) / VERTICAL_TAU_S;
    // Horizontal acceleration needed: null the tangential velocity.
    aHorizontal = -orbit.tangentialSpeedMps / HORIZONTAL_TAU_S;
  }


  const radialError = orbit.radialSpeedMps - targetRadial;

  const maxThrust =
    state.configuration === "ascent-stage"
      ? parameters.ascentEngine.thrustN.value
      : parameters.descentEngine.maxThrustN.value;

  const fixed = braking?.fixedThrottle ?? null;
  let attitude: number;
  let recommendedThrottle: number;

  if (fixed !== null && fixed > 0 && state.configuration !== "ascent-stage") {
    // Thrust magnitude is pinned: pitch is the only vertical control left.
    const aTotal = (maxThrust * fixed) / mass;
    // Pitch splits the fixed thrust vector. Tilt far enough to make the
    // downrange deceleration the profile asks for, but never so far that the
    // vertical component falls below what the altitude profile needs.
    const magnitude = Math.acos(Math.max(-1, Math.min(1, aRadial / aTotal)));
    const sign = aHorizontal < 0 ? -1 : 1;
    attitude = sign * magnitude;
    recommendedThrottle = fixed;
  } else {
    attitude = Math.atan2(aHorizontal, Math.max(aRadial, 1e-6));
    const requiredAccel = Math.hypot(aRadial, aHorizontal);
    const rawThrottle = maxThrust > 0 ? (requiredAccel * mass) / maxThrust : 0;
    recommendedThrottle =
      state.configuration === "ascent-stage"
        ? rawThrottle > 0
          ? 1
          : 0
        : snapDescentThrottle(Math.min(1, Math.max(0, rawThrottle)), parameters);
  }
  if (attitude > tiltLimit) attitude = tiltLimit;
  if (attitude < -tiltLimit) attitude = -tiltLimit;

  let advisory: string;
  if (state.terminalState !== null) {
    advisory = "Terminal state reached — guidance inactive.";
  } else if (inBraking) {
    advisory =
      "Braking phase: thrust retrograde, flying the range/altitude profile to high gate.";
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
