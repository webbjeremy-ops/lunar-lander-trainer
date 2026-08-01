// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Relative motion between the LM and the passive Command Module.
//
// The AUTHORITATIVE values are direct Moon-centred state differences. A local
// orbital-frame view may be derived for teaching, but it is labelled
// EDUCATIONAL RELATIVE-MOTION VIEW and is never used as a propagator.

import type { LunarFlightState } from "@/simulation/lunar2d/types";
import { wrapPi } from "./OrbitalElements";
import type { RelativeState } from "./types";

export function relativeState(
  lm: Readonly<LunarFlightState>,
  target: Readonly<LunarFlightState>,
): RelativeState {
  const dx = target.positionM[0] - lm.positionM[0];
  const dy = target.positionM[1] - lm.positionM[1];
  const dvx = target.velocityMps[0] - lm.velocityMps[0];
  const dvy = target.velocityMps[1] - lm.velocityMps[1];

  const range = Math.hypot(dx, dy);
  // Range rate: positive = opening, negative = closing.
  const rangeRate = range > 0 ? (dx * dvx + dy * dvy) / range : 0;

  const losAngle = Math.atan2(dy, dx);
  // d/dt atan2(dy, dx) = (dx*dvy - dy*dvx) / range^2
  const losRate = range > 0 ? (dx * dvy - dy * dvx) / (range * range) : 0;

  const lmAngle = Math.atan2(lm.positionM[1], lm.positionM[0]);
  const targetAngle = Math.atan2(target.positionM[1], target.positionM[0]);
  const phase = wrapPi(targetAngle - lmAngle);

  // Along-track / radial decomposition in the LM local orbital frame.
  const rLm = Math.hypot(lm.positionM[0], lm.positionM[1]);
  const ux = rLm > 0 ? lm.positionM[0] / rLm : 1;
  const uy = rLm > 0 ? lm.positionM[1] / rLm : 0;
  const hx = -uy;
  const hy = ux;
  const radialSeparation = dx * ux + dy * uy;
  const alongTrackSeparation = dx * hx + dy * hy;

  // Closest approach on the instantaneous straight-line relative motion.
  const relSpeedSq = dvx * dvx + dvy * dvy;
  let tca = 0;
  if (relSpeedSq > 1e-12) {
    tca = -(dx * dvx + dy * dvy) / relSpeedSq;
    if (tca < 0) tca = 0;
  }
  const cx = dx + dvx * tca;
  const cy = dy + dvy * tca;

  return {
    rangeM: range,
    rangeRateMps: rangeRate,
    relativePositionM: [dx, dy],
    relativeVelocityMps: [dvx, dvy],
    lineOfSightAngleRad: losAngle,
    lineOfSightRateRadPerSec: losRate,
    phaseAngleRad: phase,
    alongTrackSeparationM: alongTrackSeparation,
    radialSeparationM: radialSeparation,
    closestApproachM: Math.hypot(cx, cy),
    timeToClosestApproachS: tca,
  };
}

/** Closing rate, positive when the range is shrinking. */
export function closingRateMps(rel: RelativeState): number {
  return -rel.rangeRateMps;
}
