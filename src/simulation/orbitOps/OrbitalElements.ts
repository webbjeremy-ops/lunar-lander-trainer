// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Pure planar orbital-element derivation.
//
// Everything is a total function of (position, velocity, mu, referenceRadius).
// No clocks, no randomness, no React, no AGC.

import type { OrbitalElements, OrbitShape } from "./types";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import type { LunarFlightState } from "@/simulation/lunar2d/types";

const TWO_PI = Math.PI * 2;
const CIRCULAR_ECCENTRICITY = 1e-6;

export function wrapPi(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let x = a % TWO_PI;
  if (x > Math.PI) x -= TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  return x;
}

export function wrapTwoPi(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

const INVALID: OrbitalElements = {
  radiusM: 0,
  altitudeM: 0,
  speedMps: 0,
  radialSpeedMps: 0,
  tangentialSpeedMps: 0,
  specificEnergyJPerKg: 0,
  specificAngularMomentumM2S: 0,
  eccentricity: 0,
  semiMajorAxisM: null,
  periapsisRadiusM: 0,
  apoapsisRadiusM: null,
  periapsisAltitudeM: 0,
  apoapsisAltitudeM: null,
  orbitalPeriodS: null,
  trueAnomalyRad: 0,
  argumentOfPeriapsisRad: 0,
  flightPathAngleRad: 0,
  centralAngleRad: 0,
  timeToPeriapsisS: null,
  timeToApoapsisS: null,
  impactTrajectory: true,
  shape: "degenerate",
  valid: false,
};

export interface ElementsOptions {
  readonly gravitationalParameterM3S2?: number;
  readonly referenceRadiusM?: number;
}

export function defaultMu(): number {
  return DEFAULT_LUNAR_FLIGHT_PARAMETERS.environment.gravitationalParameterM3S2
    .value;
}

export function defaultReferenceRadius(): number {
  return DEFAULT_LUNAR_FLIGHT_PARAMETERS.terrain.meanRadiusM;
}

/**
 * Derive the full planar element set. Handles circular, elliptical,
 * suborbital, surface-intersecting and escape trajectories, and returns a
 * `valid: false` record rather than throwing on degenerate input.
 */
export function deriveOrbitalElements(
  positionM: readonly [number, number],
  velocityMps: readonly [number, number],
  options: ElementsOptions = {},
): OrbitalElements {
  const mu = options.gravitationalParameterM3S2 ?? defaultMu();
  const R = options.referenceRadiusM ?? defaultReferenceRadius();

  const [px, py] = positionM;
  const [vx, vy] = velocityMps;
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(vx) ||
    !Number.isFinite(vy) ||
    !Number.isFinite(mu) ||
    mu <= 0
  ) {
    return INVALID;
  }

  const r = Math.hypot(px, py);
  if (r <= 0) return INVALID;

  const speed = Math.hypot(vx, vy);
  const ux = px / r;
  const uy = py / r;
  const hx = -uy;
  const hy = ux;

  const radialSpeed = vx * ux + vy * uy;
  const tangentialSpeed = vx * hx + vy * hy;
  const centralAngle = Math.atan2(py, px);

  const energy = (speed * speed) / 2 - mu / r;
  const hz = px * vy - py * vx;

  const eSq = Math.max(0, 1 + (2 * energy * hz * hz) / (mu * mu));
  const eccentricity = Math.sqrt(eSq);

  let semiMajorAxis: number | null = null;
  let apoapsisRadius: number | null = null;
  let periapsisRadius: number;
  let period: number | null = null;
  const p = (hz * hz) / mu;

  if (energy < 0) {
    semiMajorAxis = -mu / (2 * energy);
    apoapsisRadius = semiMajorAxis * (1 + eccentricity);
    periapsisRadius = semiMajorAxis * (1 - eccentricity);
    period = TWO_PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / mu);
  } else {
    periapsisRadius = eccentricity > 0 ? p / (1 + eccentricity) : r;
  }

  // True anomaly, signed by the radial velocity.
  let trueAnomaly = 0;
  if (eccentricity > CIRCULAR_ECCENTRICITY && p > 0) {
    const cosNu = clamp(-1, 1, (p / r - 1) / eccentricity);
    trueAnomaly = Math.acos(cosNu) * (radialSpeed >= 0 ? 1 : -1);
  }
  // Retrograde motion mirrors the sweep direction.
  const sweep = hz >= 0 ? 1 : -1;
  const argumentOfPeriapsis = wrapPi(centralAngle - sweep * trueAnomaly);

  const flightPathAngle = Math.atan2(radialSpeed, Math.abs(tangentialSpeed));

  const shape = classifyShape(energy, eccentricity, periapsisRadius, R);
  const impact = periapsisRadius <= R;

  const { toPeriapsis, toApoapsis } = apsisTimes(
    mu,
    semiMajorAxis,
    eccentricity,
    trueAnomaly,
    period,
  );

  return {
    radiusM: r,
    altitudeM: r - R,
    speedMps: speed,
    radialSpeedMps: radialSpeed,
    tangentialSpeedMps: tangentialSpeed,
    specificEnergyJPerKg: energy,
    specificAngularMomentumM2S: hz,
    eccentricity,
    semiMajorAxisM: semiMajorAxis,
    periapsisRadiusM: periapsisRadius,
    apoapsisRadiusM: apoapsisRadius,
    periapsisAltitudeM: periapsisRadius - R,
    apoapsisAltitudeM: apoapsisRadius === null ? null : apoapsisRadius - R,
    orbitalPeriodS: period,
    trueAnomalyRad: trueAnomaly,
    argumentOfPeriapsisRad: argumentOfPeriapsis,
    flightPathAngleRad: flightPathAngle,
    centralAngleRad: centralAngle,
    timeToPeriapsisS: toPeriapsis,
    timeToApoapsisS: toApoapsis,
    impactTrajectory: impact,
    shape,
    valid: true,
  };
}

export function elementsForState(
  state: Readonly<LunarFlightState>,
  options: ElementsOptions = {},
): OrbitalElements {
  return deriveOrbitalElements(state.positionM, state.velocityMps, options);
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function classifyShape(
  energy: number,
  eccentricity: number,
  periapsisRadius: number,
  referenceRadius: number,
): OrbitShape {
  if (!Number.isFinite(energy)) return "degenerate";
  if (energy >= 0) return "escape";
  if (periapsisRadius <= referenceRadius) return "suborbital";
  if (eccentricity < 1e-3) return "circular";
  return "elliptical";
}

function apsisTimes(
  mu: number,
  a: number | null,
  e: number,
  trueAnomaly: number,
  period: number | null,
): { toPeriapsis: number | null; toApoapsis: number | null } {
  if (a === null || a <= 0 || period === null) {
    return { toPeriapsis: null, toApoapsis: null };
  }
  const n = TWO_PI / period;
  if (e < CIRCULAR_ECCENTRICITY) {
    // Circular: every point is both. Report 0 rather than an arbitrary sweep.
    return { toPeriapsis: 0, toApoapsis: 0 };
  }
  const E =
    2 *
    Math.atan2(
      Math.sqrt(Math.max(0, 1 - e)) * Math.sin(trueAnomaly / 2),
      Math.sqrt(Math.max(0, 1 + e)) * Math.cos(trueAnomaly / 2),
    );
  const M = E - e * Math.sin(E);
  const toPeriapsis = wrapTwoPi(TWO_PI - M) / n;
  const toApoapsis = wrapTwoPi(Math.PI - M) / n;
  return {
    toPeriapsis: Number.isFinite(toPeriapsis) ? toPeriapsis : null,
    toApoapsis: Number.isFinite(toApoapsis) ? toApoapsis : null,
  };
}

/**
 * The one approved way to present a periapsis altitude. A negative periapsis
 * is never a safe orbit and must never be rendered as one.
 */
export const IMPACT_TRAJECTORY_LABEL = "IMPACT TRAJECTORY" as const;

export function describePeriapsis(elements: OrbitalElements): string {
  if (!elements.valid) return IMPACT_TRAJECTORY_LABEL;
  if (elements.periapsisAltitudeM < 0) return IMPACT_TRAJECTORY_LABEL;
  return `${(elements.periapsisAltitudeM / 1000).toFixed(2)} km`;
}

/** Circular orbital speed at radius r. */
export function circularSpeedMps(radiusM: number, mu = defaultMu()): number {
  if (radiusM <= 0) return 0;
  return Math.sqrt(mu / radiusM);
}

/** Speed on an ellipse of semi-major axis a at radius r (vis-viva). */
export function visVivaSpeedMps(
  radiusM: number,
  semiMajorAxisM: number,
  mu = defaultMu(),
): number {
  const v2 = mu * (2 / radiusM - 1 / semiMajorAxisM);
  return v2 <= 0 ? 0 : Math.sqrt(v2);
}
