// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Coast prediction, conic sampling and passive target propagation.
//
// The target vehicle is propagated with the SAME kernel as the LM
// (`stepLunarFlight`, engine off). There is no second physics model and no
// screen-space motion: the Command Module is a physical body in the same
// Moon-centred planar frame, and it does not gravitationally influence the LM.

import { stepLunarFlight } from "@/simulation/lunar2d/physics";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import type {
  LunarControlInput,
  LunarFlightState,
} from "@/simulation/lunar2d/types";
import { deriveOrbitalElements, wrapTwoPi } from "./OrbitalElements";
import type { OrbitalElements } from "./types";

export const COAST_CONTROL: LunarControlInput = {
  throttle: 0,
  engineCommand: "off",
  attitudeCommand: 0,
  stageSeparation: false,
};

/**
 * Advance a passive body. Deterministic for a given (state, dtUs) pair; the
 * caller is responsible for stepping on the substep grid.
 */
export function propagatePassive(
  state: Readonly<LunarFlightState>,
  dtUs: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightState {
  return stepLunarFlight(state, COAST_CONTROL, dtUs, parameters);
}

export interface ConicPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Sample the conic that the given elements describe, in the Moon-centred
 * inertial frame. Bound orbits return the closed ellipse; open trajectories
 * are sampled forward of the current position only.
 */
export function sampleConic(
  elements: OrbitalElements,
  samples = 180,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): readonly ConicPoint[] {
  if (!elements.valid) return [];
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const h = elements.specificAngularMomentumM2S;
  const p = (h * h) / mu;
  if (!Number.isFinite(p) || p <= 0) return [];
  const e = elements.eccentricity;
  const sweep = h >= 0 ? 1 : -1;
  const omega = elements.argumentOfPeriapsisRad;

  const closed = e < 1;
  const span = closed ? Math.PI * 2 : Math.PI * 1.2;
  const start = closed ? 0 : elements.trueAnomalyRad;

  const out: ConicPoint[] = [];
  const limit = 40 * parameters.terrain.meanRadiusM;
  for (let i = 0; i <= samples; i++) {
    const nu = start + (span * i) / samples;
    const denom = 1 + e * Math.cos(nu);
    if (denom <= 1e-6) continue;
    const rr = p / denom;
    if (!Number.isFinite(rr) || rr > limit) continue;
    const ang = omega + sweep * nu;
    out.push({ x: rr * Math.cos(ang), y: rr * Math.sin(ang) });
  }
  return out;
}

/** Cartesian point on a conic at a given true anomaly. */
export function pointAtTrueAnomaly(
  elements: OrbitalElements,
  trueAnomalyRad: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): ConicPoint | null {
  if (!elements.valid) return null;
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const h = elements.specificAngularMomentumM2S;
  const p = (h * h) / mu;
  const denom = 1 + elements.eccentricity * Math.cos(trueAnomalyRad);
  if (!Number.isFinite(p) || p <= 0 || denom <= 1e-6) return null;
  const rr = p / denom;
  const sweep = h >= 0 ? 1 : -1;
  const ang = elements.argumentOfPeriapsisRad + sweep * trueAnomalyRad;
  return { x: rr * Math.cos(ang), y: rr * Math.sin(ang) };
}

export interface ImpactPrediction {
  readonly willImpact: boolean;
  /** Seconds until the conic first reaches the reference radius, if bound. */
  readonly timeToImpactS: number | null;
}

/**
 * Analytic surface-impact prediction on the current conic. Only meaningful
 * while the vehicle is coasting; a burn invalidates it immediately.
 */
export function predictSurfaceImpact(
  elements: OrbitalElements,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): ImpactPrediction {
  const R = parameters.terrain.meanRadiusM;
  if (!elements.valid) return { willImpact: true, timeToImpactS: null };
  if (elements.periapsisRadiusM > R) {
    return { willImpact: false, timeToImpactS: null };
  }
  const a = elements.semiMajorAxisM;
  const e = elements.eccentricity;
  const period = elements.orbitalPeriodS;
  if (a === null || a <= 0 || period === null || e < 1e-9) {
    return { willImpact: true, timeToImpactS: null };
  }
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const n = Math.sqrt(mu / (a * a * a));
  const p = a * (1 - e * e);
  const cosNu = Math.min(1, Math.max(-1, (p / R - 1) / e));
  // Descending branch: negative true anomaly reaches R before periapsis.
  const nuImpact = -Math.acos(cosNu);
  const meanAt = (nu: number): number => {
    const E =
      2 *
      Math.atan2(
        Math.sqrt(Math.max(0, 1 - e)) * Math.sin(nu / 2),
        Math.sqrt(Math.max(0, 1 + e)) * Math.cos(nu / 2),
      );
    return E - e * Math.sin(E);
  };
  const dM = wrapTwoPi(meanAt(nuImpact) - meanAt(elements.trueAnomalyRad));
  return { willImpact: true, timeToImpactS: dM / n };
}

/**
 * Predict the coast conic that would follow an instantaneous velocity change.
 * This is an analytical preview only — see ManeuverPlanner for the required
 * labelling — and never touches vehicle state.
 */
export function predictAfterDeltaV(
  positionM: readonly [number, number],
  velocityMps: readonly [number, number],
  deltaVMps: readonly [number, number],
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): OrbitalElements {
  return deriveOrbitalElements(
    positionM,
    [velocityMps[0] + deltaVMps[0], velocityMps[1] + deltaVMps[1]],
    {
      gravitationalParameterM3S2:
        parameters.environment.gravitationalParameterM3S2.value,
      referenceRadiusM: parameters.terrain.meanRadiusM,
    },
  );
}
