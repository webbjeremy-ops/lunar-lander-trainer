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
/** Terminal-phase horizontal nulling time constant, seconds. */
const TERMINAL_HORIZONTAL_TAU_S = 6;
const MAX_ADVISORY_TILT_RAD = 1.05; // ~60 degrees
/**
 * Braking-phase attitude authority. The real LM flew the braking phase with
 * the thrust vector almost horizontal (pitch 80-88 degrees from local
 * vertical), which is the only way the downrange velocity is killed inside the
 * available range. The 60-degree cap above is a terminal-phase limit.
 */
// Slightly past horizontal is allowed: at the fixed throttle point the only
// way to keep from ballooning while nearly orbital is to let the thrust vector
// dip a few degrees below the local horizon, exactly as the real profile did.
const MAX_BRAKING_TILT_RAD = 1.66; // ~95 degrees
/** Vertical error is flown out on this time constant during braking, seconds. */
const BRAKING_ALTITUDE_TAU_S = 25;
/** Sink-rate authority during braking, m/s. */
const BRAKING_MAX_SINK_MPS = 55;
/**
 * Once the stopping law needs more than this deceleration the vehicle is late
 * braking, and it takes priority over the nominal speed profile, m/s².
 */
const BRAKING_STOP_OVERRIDE_MPS2 = 2.8;
/** Braking-phase downrange velocity loop time constant, seconds. */
const BRAKING_SPEED_TAU_S = 20;
/** Closing deceleration used to fly the last kilometres onto the site, m/s². */
const APPROACH_CLOSING_ACCEL = 0.6;
/** Schedule catch-up trim: time constant and authority limit. */
const SCHEDULE_TRIM_TAU_S = 30;
const SCHEDULE_TRIM_MAX_MPS2 = 0.8;
/** Time constant for the approach-phase downrange velocity loop, seconds. */
const APPROACH_TAU_S = 8;
/** Vertical error is flown out on this time constant after high gate, seconds. */
const APPROACH_ALTITUDE_TAU_S = 18;

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
  /**
   * Downrange speed the vehicle should have when it reaches `handoverRangeM`
   * — the high-gate aim speed (~152 m/s on Apollo 11). Braking is terminal-
   * targeted onto this speed at that range so the burn arrives on the
   * historical pitch-over point instead of merely low and slow.
   */
  readonly handoverSpeedMps?: number | null;
  /** Low-gate aim range for the approach phase, metres. */
  readonly approachAimRangeM?: number | null;
  /** Low-gate aim downrange speed for the approach phase, m/s. */
  readonly approachAimSpeedMps?: number | null;
  /**
   * The DPS throttle band the engine will actually be held inside, [0, 1].
   * Guidance snaps its own command into this band and then chooses the pitch
   * that splits the DELIVERED thrust — without this, a clamped or snapped
   * throttle over-thrusts both axes and the vehicle over-brakes.
   */
  readonly throttleMinFraction?: number | null;
  readonly throttleMaxFraction?: number | null;
  /**
   * Slope of the canonical altitude-versus-range profile here (metres of
   * altitude per metre of ground track). Guidance flies the profile as a
   * flight path: sink rate = slope x closing speed, so altitude, range and
   * speed reach each gate together instead of drifting apart.
   */
  readonly targetGlideSlope?: number | null;
}

/**
 * Target sink-rate schedule: gentle near the surface, faster up high.
 * v_target = -min(45, 0.7 * sqrt(altitude)), floored at -0.6 m/s so the
 * vehicle keeps settling instead of hovering forever.
 */
export function targetSinkRate(altitudeM: number): number {
  if (altitudeM <= 0) return 0;
  // Below low gate the flown profile is much gentler than a square-root
  // schedule: Apollo 11 took ~110 s to fly the last 500 ft. Cap the sink so a
  // guided descent settles at a crew-plausible rate instead of dropping.
  const schedule = Math.max(0.6, 0.7 * Math.sqrt(altitudeM));
  const lowGate = altitudeM < 160 ? Math.max(0.6, altitudeM / 45 + 0.5) : Infinity;
  const magnitude = Math.min(45, schedule, lowGate);
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

  // M4.29 — Centrifugal relief. At PDI the vehicle is still nearly orbital
  // (v^2 / r is within a few percent of local g), so a vertical law written
  // against gravity alone commands far too much lift and the trajectory
  // blooms upward instead of tracking the profile. Net radial gravity is what
  // the thrust vector actually has to fight.
  const centrifugal =
    (orbit.tangentialSpeedMps * orbit.tangentialSpeedMps) / Math.max(1, orbit.radiusM);
  const netG = localG - centrifugal;

  let targetRadial: number;
  let aRadial: number;
  let aHorizontal: number;
  let tiltLimit = MAX_ADVISORY_TILT_RAD;

  if (braking !== null) {
    const v = orbit.tangentialSpeedMps;
    // M4.29 — ONE continuous closing law for braking and approach. Both
    // phases are terminal targeting: pick the deceleration that arrives at an
    // aim point (high gate first, low gate always) with its aim speed over the
    // range actually left to run, and take whichever demand is larger. Using
    // the same formulation either side of high gate is what removes the
    // pitch step the crew would have seen at pitch-over.
    const s = Math.abs(signedRange);
    const aimRange = braking.approachAimRangeM ?? 0;
    const aimSpeed = Math.abs(braking.approachAimSpeedMps ?? 0);
    const vGate = Math.abs(braking.handoverSpeedMps ?? 0);
    if (s <= Math.max(30, aimRange)) {
      // Over the site: settle the residual translation out.
      const desired = s < 30 ? 0 : Math.sqrt(2 * APPROACH_CLOSING_ACCEL * s);
      aHorizontal = (Math.sign(signedRange || 1) * desired - v) / APPROACH_TAU_S;
    } else {
      const toLowGate =
        (v * v - aimSpeed * aimSpeed) / (2 * Math.max(50, s - aimRange));
      const toHighGate = inBraking
        ? (v * v - vGate * vGate) / (2 * Math.max(500, s - braking.handoverRangeM))
        : 0;
      let decel = Math.max(0, toLowGate, toHighGate);
      // The canonical table paces the run: if the vehicle is running faster
      // than the flown range-versus-time schedule, add the trim that puts it
      // back on the schedule, so it does not reach low gate a minute early.
      const scheduled = braking.targetDownrangeSpeedMps ?? null;
      if (scheduled !== null && Math.abs(v) > Math.abs(scheduled)) {
        // Trim gently and with limited authority: a hard schedule catch-up
        // would snap the pitch over at high gate instead of easing through it.
        decel += Math.min(
          SCHEDULE_TRIM_MAX_MPS2,
          (Math.abs(v) - Math.abs(scheduled)) / SCHEDULE_TRIM_TAU_S,
        );
      }
      if (inBraking) {
        // Safety law: genuinely late braking (still faster than the gate speed
        // and needing more than the profile deceleration) takes priority.
        const stopping = (v * v) / (2 * Math.max(500, s - braking.handoverRangeM));
        if (Math.abs(v) > vGate && stopping > BRAKING_STOP_OVERRIDE_MPS2) decel = stopping;
        tiltLimit = MAX_BRAKING_TILT_RAD;
      }
      aHorizontal = -Math.sign(v || 1) * decel;
    }
    // Never thrust the vehicle FORWARD to catch a schedule it has already
    // fallen behind: descent guidance only ever removes downrange velocity.
    if (Math.abs(v) > 2 && Math.sign(aHorizontal) === Math.sign(v)) aHorizontal = 0;

    // Vertical: hold the profile altitude for the range still to run, but
    // never sink faster than the altitude schedule allows.
    const altitudeError = braking.targetAltitudeM - orbit.altitudeM;
    const altitudeTau = inBraking ? BRAKING_ALTITUDE_TAU_S : APPROACH_ALTITUDE_TAU_S;
    const slope = braking.targetGlideSlope ?? null;
    if (slope !== null) {
      // Fly the profile as a flight path: the nominal sink rate is the profile
      // slope times the closing speed, trimmed by the altitude error.
      const pathSink = -Math.abs(slope) * Math.abs(v);
      const trim = Math.max(-12, Math.min(6, altitudeError / altitudeTau));
      targetRadial = Math.max(-BRAKING_MAX_SINK_MPS, pathSink + trim);
      // Near the surface the sink-rate schedule has the final word: below
      // 800 m the profile may not command a faster sink than the schedule, so
      // the vehicle arrives at low gate settled instead of diving through it.
      const slack = orbit.altitudeM > 800 ? 6 : 0;
      targetRadial = Math.max(targetRadial, targetSinkRate(orbit.altitudeM) - slack);
      // Terminal picture (P66): low down with translation still on, ease the
      // sink so the vehicle flies the last few hundred metres to the site
      // instead of settling short of it.
      const residual = Math.abs(v);
      if (orbit.altitudeM < 150 && residual > 1.5) {
        targetRadial = Math.max(targetRadial, -Math.max(0.8, 3 - residual * 0.3));
      }
    } else {
      targetRadial = Math.max(
        Math.max(-BRAKING_MAX_SINK_MPS, targetSinkRate(orbit.altitudeM)),
        Math.min(5, altitudeError / altitudeTau),
      );
    }
    aRadial = netG + (targetRadial - orbit.radialSpeedMps) / (VERTICAL_TAU_S * 2);
  } else {
    targetRadial = targetSinkRate(orbit.altitudeM);
    // Terminal descent (P66 picture): the last hundred metres are flown by
    // nulling the residual translation first and settling second. If the
    // vehicle still has forward motion low down, ease the sink so the
    // horizontal loop has time to work before the gear touches.
    const residual = Math.abs(orbit.tangentialSpeedMps);
    if (orbit.altitudeM < 150 && residual > 1.5) {
      targetRadial = Math.max(targetRadial, -Math.max(0.8, 3 - residual * 0.3));
    }
    aRadial = netG + (targetRadial - orbit.radialSpeedMps) / VERTICAL_TAU_S;
    // Horizontal acceleration needed: null the tangential velocity.
    aHorizontal = -orbit.tangentialSpeedMps / TERMINAL_HORIZONTAL_TAU_S;
  }
  // Thrust can only push: never ask for a negative vertical component.
  if (aRadial < 0) aRadial = 0;


  const radialError = orbit.radialSpeedMps - targetRadial;

  const maxThrust =
    state.configuration === "ascent-stage"
      ? parameters.ascentEngine.thrustN.value
      : parameters.descentEngine.maxThrustN.value;

  const fixed = braking?.fixedThrottle ?? null;
  const bandMin = braking?.throttleMinFraction ?? null;
  const bandMax = braking?.throttleMaxFraction ?? null;
  let attitude: number;
  let recommendedThrottle: number;

  if (state.configuration === "ascent-stage") {
    const requiredAccel = Math.hypot(aRadial, aHorizontal);
    attitude = Math.atan2(aHorizontal, Math.max(aRadial, 1e-6));
    recommendedThrottle = requiredAccel > 0 ? 1 : 0;
  } else {
    // M4.29 — one law for both regimes. Decide the throttle the engine will
    // ACTUALLY be held at (pinned fixed-throttle point, or the required
    // magnitude snapped into the DPS band), then choose the pitch that splits
    // that delivered thrust so its vertical component meets the profile. The
    // old code commanded an ideal vector and let the clamped throttle
    // over-thrust both axes, which over-braked the vehicle and produced a
    // pitch step at throttle recovery.
    const requiredAccel = Math.hypot(aRadial, aHorizontal);
    let throttle: number;
    if (fixed !== null && fixed > 0) {
      throttle = fixed;
    } else {
      const raw = maxThrust > 0 ? (requiredAccel * mass) / maxThrust : 0;
      throttle = snapDescentThrottle(Math.min(1, Math.max(0, raw)), parameters);
      if (bandMax !== null) throttle = Math.min(throttle, bandMax);
      if (bandMin !== null && throttle > 0) throttle = Math.max(throttle, bandMin);
    }
    const aTotal = throttle > 0 ? (maxThrust * throttle) / mass : 0;
    if (aTotal <= 0) {
      attitude = Math.atan2(aHorizontal, Math.max(aRadial, 1e-6));
    } else if (aTotal >= requiredAccel - 1e-9 && requiredAccel > 0) {
      // Enough thrust to satisfy the vertical demand: pitch so the vertical
      // component is exactly aRadial and the rest goes into deceleration.
      const magnitude = Math.acos(Math.max(-1, Math.min(1, aRadial / aTotal)));
      attitude = (aHorizontal < 0 ? -1 : 1) * magnitude;
    } else {
      // Not enough thrust for the whole demand: hold the demanded direction.
      attitude = Math.atan2(aHorizontal, Math.max(aRadial, 1e-6));
    }
    recommendedThrottle = throttle;
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
