// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.66 — Hover throttle: the DPS setting at which thrust exactly balances
// weight for the vehicle's CURRENT mass. Pure, presentation-facing helper.
//
// Hover throttle is not a constant. At PDI (~15,100 kg) it sits near 54 %;
// with the descent tanks nearly dry (~7,000 kg) it is near 25 %. That moving
// target is why the same throttle setting climbs late in the burn and sinks
// early in it.

import {
  DESCENT_ENGINE,
  LUNAR_ENVIRONMENT,
} from "@/simulation/lunar2d/LunarMissionConstants";

/** Surface gravity from the published GM and mean radius (~1.62 m/s²). */
export const LUNAR_SURFACE_GRAVITY_MPS2 =
  LUNAR_ENVIRONMENT.gravitationalParameterM3S2.value /
  (LUNAR_ENVIRONMENT.meanRadiusM.value * LUNAR_ENVIRONMENT.meanRadiusM.value);

/**
 * Throttle fraction that exactly cancels weight: T = m·g  =>  f = m·g / Tmax.
 * Returns a raw fraction (may exceed 1 for a vehicle too heavy to hover).
 */
export function hoverThrottleFraction(
  massKg: number,
  gravityMps2: number = LUNAR_SURFACE_GRAVITY_MPS2,
  maxThrustN: number = DESCENT_ENGINE.maxThrustN.value,
): number {
  if (!Number.isFinite(massKg) || massKg <= 0) return 0;
  if (!Number.isFinite(maxThrustN) || maxThrustN <= 0) return 0;
  return (massKg * gravityMps2) / maxThrustN;
}

/**
 * True when the hover setting is a throttle the crew can actually command:
 * inside the DPS continuous band floor and at or below full thrust.
 */
export function hoverThrottleIsCommandable(fraction: number): boolean {
  return (
    Number.isFinite(fraction) &&
    fraction >= DESCENT_ENGINE.minThrottleFraction.value &&
    fraction <= 1
  );
}
