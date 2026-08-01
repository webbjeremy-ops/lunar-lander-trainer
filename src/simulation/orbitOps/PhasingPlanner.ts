// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Deterministic bounded phasing planner.
//
// Given the LM orbit, a passive target orbit and the phase angle between the
// two vehicles, search a bounded delta-v grid for the apsis burn that brings
// the LM into the planned intercept region after a whole number of
// revolutions. The search is a fixed grid scan: no randomness, no optimizer
// dependency, identical output for identical input.
//
// This is a coplanar, co-apsidal approximation. It reports its own confidence
// and never promises a perfect intercept.

import { defaultMu } from "./OrbitalElements";
import { wrapPi } from "./OrbitalElements";
import type { BurnDirection } from "./types";

export interface PhasingRequest {
  /** Radius at which the phasing burn is made (an apsis), metres. */
  readonly burnRadiusM: number;
  /** LM speed at the burn point before the burn, m/s. */
  readonly burnSpeedMps: number;
  /** Target orbital period, seconds. */
  readonly targetPeriodS: number;
  /** Target orbital radius used for the range estimate, metres. */
  readonly targetRadiusM: number;
  /** Target central angle minus LM central angle at the burn, radians. */
  readonly phaseAtBurnRad: number;
  readonly availableDeltaVMps: number;
  readonly maxRevolutions?: number;
  readonly deltaVStepMps?: number;
  readonly maxDeltaVMps?: number;
  readonly gravitationalParameterM3S2?: number;
  /** Reference radius used to reject surface-intersecting solutions. */
  readonly referenceRadiusM?: number;
  readonly safePeriapsisAltitudeM?: number;
}

export type PhasingConfidence = "good" | "approximate" | "poor" | "none";

export interface PhasingRecommendation {
  readonly found: boolean;
  readonly direction: BurnDirection;
  readonly deltaVMps: number;
  /** Whole LM revolutions on the phasing orbit before the intercept. */
  readonly revolutions: number;
  readonly phasingPeriodS: number;
  /** Seconds from the burn to the predicted intercept. */
  readonly timeToInterceptS: number;
  readonly predictedPhaseRad: number;
  readonly predictedRangeM: number;
  readonly predictedClosingRateMps: number;
  readonly confidence: PhasingConfidence;
  readonly note: string;
}

const NONE: PhasingRecommendation = {
  found: false,
  direction: "prograde",
  deltaVMps: 0,
  revolutions: 0,
  phasingPeriodS: 0,
  timeToInterceptS: 0,
  predictedPhaseRad: 0,
  predictedRangeM: Number.POSITIVE_INFINITY,
  predictedClosingRateMps: 0,
  confidence: "none",
  note: "No bounded phasing solution within the available delta-v.",
};

const TWO_PI = Math.PI * 2;

export function planPhasingBurn(req: PhasingRequest): PhasingRecommendation {
  const mu = req.gravitationalParameterM3S2 ?? defaultMu();
  const R = req.referenceRadiusM ?? 1_737_400;
  const safeAlt = req.safePeriapsisAltitudeM ?? 15_000;
  const maxRevs = Math.max(1, Math.floor(req.maxRevolutions ?? 6));
  const step = Math.max(0.1, req.deltaVStepMps ?? 0.5);
  const budget = Math.max(
    0,
    Math.min(req.availableDeltaVMps, req.maxDeltaVMps ?? req.availableDeltaVMps),
  );
  if (
    !Number.isFinite(req.burnRadiusM) ||
    req.burnRadiusM <= 0 ||
    !Number.isFinite(req.targetPeriodS) ||
    req.targetPeriodS <= 0 ||
    budget <= 0
  ) {
    return NONE;
  }

  const targetSpeed = Math.sqrt(mu / req.targetRadiusM);
  const steps = Math.min(2000, Math.floor(budget / step));

  let best: PhasingRecommendation = NONE;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= steps; i++) {
    const dv = i * step;
    for (const sign of [1, -1] as const) {
      if (dv === 0 && sign === -1) continue;
      const vNew = req.burnSpeedMps + sign * dv;
      if (vNew <= 0) continue;
      const invA = 2 / req.burnRadiusM - (vNew * vNew) / mu;
      if (invA <= 0) continue; // escape trajectory
      const a = 1 / invA;
      // Reject orbits that would strike the surface.
      const rOther = 2 * a - req.burnRadiusM;
      const rp = Math.min(req.burnRadiusM, rOther);
      if (rp < R + safeAlt) continue;

      const period = TWO_PI * Math.sqrt((a * a * a) / mu);
      if (!Number.isFinite(period) || period <= 0) continue;

      for (let n = 1; n <= maxRevs; n++) {
        const phase = wrapPi(
          req.phaseAtBurnRad + TWO_PI * n * (period / req.targetPeriodS - 1),
        );
        const rangeM = 2 * req.targetRadiusM * Math.abs(Math.sin(phase / 2));
        // Chord-based approximation of the closing rate at the rendezvous point.
        const lmSpeed = Math.sqrt(mu * (2 / req.burnRadiusM - 1 / a));
        const closing = Math.abs(lmSpeed - targetSpeed);
        // Prefer small range, then small delta-v, then few revolutions.
        const score = rangeM + dv * 500 + n * 250;
        if (score < bestScore) {
          bestScore = score;
          best = {
            found: true,
            direction: sign > 0 ? "prograde" : "retrograde",
            deltaVMps: dv,
            revolutions: n,
            phasingPeriodS: period,
            timeToInterceptS: period * n,
            predictedPhaseRad: phase,
            predictedRangeM: rangeM,
            predictedClosingRateMps: closing,
            confidence: confidenceFor(rangeM, closing),
            note:
              "Coplanar co-apsidal approximation from a bounded grid search. " +
              "Execute the recommendation as a finite burn and re-plan from " +
              "the achieved orbit.",
          };
        }
      }
    }
  }

  return best;
}

function confidenceFor(rangeM: number, closingMps: number): PhasingConfidence {
  if (rangeM <= 20_000 && closingMps <= 30) return "good";
  if (rangeM <= 80_000) return "approximate";
  return "poor";
}
