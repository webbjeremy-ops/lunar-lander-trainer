// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Pure orbital evaluation for the lunar-ascent game.
//
// Independent of the flight loop and of the UI: every function here is a pure
// function of a flight state (or of raw orbital values) and the mission target.
// Nothing here reads AGC state.

import {
  computeOrbitalValues,
  totalMassKg,
  type LunarFlightParameters,
  type LunarFlightState,
  type LunarOrbitalValues,
} from "@/simulation/lunar2d";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import type { AscentMissionDefinition, AscentOutcome, TargetOrbit } from "./types";

const TWO_PI = Math.PI * 2;

/**
 * Time from the current position to apoapsis, seconds.
 * Returns null for non-elliptic trajectories (no apoapsis exists).
 */
export function timeToApoapsisSeconds(
  orbit: LunarOrbitalValues,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): number | null {
  const a = orbit.semiMajorAxisM;
  if (a === null || a <= 0) return null;
  const e = orbit.eccentricity;
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const n = Math.sqrt(mu / (a * a * a));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (e < 1e-9) return 0; // circular: every point is "apoapsis"

  // True anomaly from the conic equation, signed by the radial velocity.
  const cosNu = (a * (1 - e * e) - orbit.radiusM) / (e * orbit.radiusM);
  const nu = Math.acos(Math.min(1, Math.max(-1, cosNu)));
  const trueAnomaly = orbit.radialSpeedMps >= 0 ? nu : -nu;

  // Eccentric then mean anomaly.
  const E = 2 * Math.atan2(
    Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2),
    Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2),
  );
  const M = E - e * Math.sin(E);
  // Mean anomaly at apoapsis is PI.
  let dM = Math.PI - M;
  while (dM < 0) dM += TWO_PI;
  while (dM >= TWO_PI) dM -= TWO_PI;
  return dM / n;
}

/**
 * Ideal remaining delta-v from the Tsiolkovsky equation using the APS
 * propellant that is still on board. Delta-v is NOT fuel quantity: it depends
 * on the mass being pushed, which is why the same kilograms buy less near
 * liftoff than they do late in the burn.
 */
export function remainingAscentDeltaVMps(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): number {
  const propellant = state.ascentPropellantKg;
  if (propellant <= 0) return 0;
  const m0 = totalMassKg(state);
  const m1 = m0 - propellant;
  if (m1 <= 0) return 0;
  const ve =
    parameters.ascentEngine.specificImpulseS.value *
    parameters.environment.standardGravityMps2.value;
  return ve * Math.log(m0 / m1);
}

export interface TargetOrbitError {
  /** Signed periapsis error (current minus target), metres. */
  readonly periapsisErrorM: number;
  /** Signed apoapsis error (current minus target), metres. Null if unbound. */
  readonly apoapsisErrorM: number | null;
  /** Normalised 0..1 quality, 1 = exactly on target. */
  readonly quality: number;
}

export function targetOrbitError(
  orbit: LunarOrbitalValues,
  target: TargetOrbit,
): TargetOrbitError {
  const periapsisErrorM = orbit.periapsisAltitudeM - target.periapsisAltitudeM;
  const apoapsisErrorM =
    orbit.apoapsisAltitudeM === null
      ? null
      : orbit.apoapsisAltitudeM - target.apoapsisAltitudeM;

  // Tolerance scale: 20% of the target dimension.
  const pTol = Math.max(2_000, target.periapsisAltitudeM * 0.2);
  const aTol = Math.max(2_000, target.apoapsisAltitudeM * 0.2);
  const pq = Math.max(0, 1 - Math.abs(periapsisErrorM) / pTol);
  const aq =
    apoapsisErrorM === null ? 0 : Math.max(0, 1 - Math.abs(apoapsisErrorM) / aTol);
  return { periapsisErrorM, apoapsisErrorM, quality: (pq + aq) / 2 };
}

/**
 * Outcome evaluation. Pure and total: it never mutates the state and it is the
 * single place that decides success or failure for the ascent game.
 *
 * `powered` means the ascent engine is still commanded; while powered the
 * flight is always "in-flight" (the orbit is not yet final).
 */
export function evaluateAscentOutcome(
  state: Readonly<LunarFlightState>,
  mission: Readonly<AscentMissionDefinition>,
  powered: boolean,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): AscentOutcome {
  if (
    state.terminalState === "crashed" ||
    state.terminalState === "hard-landing" ||
    (state.terminalState === "landed" && state.missionTimeUs > 0)
  ) {
    return "surface-impact";
  }
  if (powered) return "in-flight";

  const orbit = computeOrbitalValues(state, parameters);
  if (
    orbit.altitudeM > 0 &&
    orbit.periapsisAltitudeM >= mission.safePeriapsisAltitudeM
  ) {
    return "orbit-achieved";
  }
  if (state.ascentPropellantKg <= 0) return "propellant-depleted";
  return "insufficient-periapsis";
}

export interface ConicSample {
  readonly x: number;
  readonly y: number;
}

/**
 * Sample the predicted coast conic in the Moon-centred inertial frame.
 * For bound orbits the full ellipse is returned; open trajectories are sampled
 * over the true-anomaly range that stays in front of the vehicle.
 */
export function sampleCoastArc(
  orbit: LunarOrbitalValues,
  samples = 180,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): readonly ConicSample[] {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const e = orbit.eccentricity;
  const r = orbit.radiusM;
  const v = orbit.speedMps;
  const h = r * orbit.tangentialSpeedMps;
  const p = (h * h) / mu;
  if (!Number.isFinite(p) || p <= 0) return [];

  // True anomaly of the current position.
  const cosNu = e > 1e-9 ? (p / r - 1) / e : 0;
  const nu0 =
    (orbit.radialSpeedMps >= 0 ? 1 : -1) *
    Math.acos(Math.min(1, Math.max(-1, cosNu)));
  // Argument of periapsis measured in the inertial frame.
  const omega = orbit.centralAngleRad - nu0;

  const out: ConicSample[] = [];
  const span = e < 1 ? TWO_PI : Math.PI * 1.2;
  const start = e < 1 ? 0 : nu0;
  for (let i = 0; i <= samples; i++) {
    const nu = start + (span * i) / samples;
    const denom = 1 + e * Math.cos(nu);
    if (denom <= 1e-6) continue;
    const rr = p / denom;
    if (!Number.isFinite(rr) || rr > 40 * parameters.terrain.meanRadiusM) continue;
    const ang = omega + nu;
    out.push({ x: rr * Math.cos(ang), y: rr * Math.sin(ang) });
  }
  void v;
  return out;
}
