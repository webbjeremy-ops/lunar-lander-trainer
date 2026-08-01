// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Finite-burn execution through the physical vehicle model.
//
// Planned delta-v is NEVER added directly to the vehicle velocity during
// gameplay. Every manoeuvre is integrated by the frozen M4.0 kernel with the
// scenario's propulsion source: real thrust, real mass loss, real orbital
// motion during the burn.
//
// ATTITUDE MODEL (educational approximation, registered): during a commanded
// burn the thrust axis is held on the requested direction each substep, rather
// than being flown there by the RCS attitude loop. Steering errors are
// therefore not simulated; everything else about the burn is physical.

import { stepLunarFlight } from "@/simulation/lunar2d/physics";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import { totalMassKg } from "@/simulation/lunar2d/physics";
import type {
  LunarControlInput,
  LunarFlightState,
} from "@/simulation/lunar2d/types";
import type { BurnDirection, FiniteBurnResult } from "./types";

/** Thrust-axis angle (from local vertical) for a burn direction. */
export function attitudeForDirection(
  state: Readonly<LunarFlightState>,
  direction: BurnDirection,
): number {
  const [px, py] = state.positionM;
  const [vx, vy] = state.velocityMps;
  const r = Math.hypot(px, py);
  if (r === 0) return 0;
  const ux = px / r;
  const uy = py / r;
  const hx = -uy;
  const hy = ux;
  const vr = vx * ux + vy * uy;
  const vt = vx * hx + vy * hy;

  switch (direction) {
    case "prograde":
      return Math.atan2(vt, vr);
    case "retrograde":
      return Math.atan2(-vt, -vr);
    case "radial-out":
      return 0;
    case "radial-in":
      return Math.PI;
  }
}

export function exhaustVelocityMps(
  parameters: Readonly<LunarFlightParameters>,
): number {
  return (
    parameters.ascentEngine.specificImpulseS.value *
    parameters.environment.standardGravityMps2.value
  );
}

/** Ideal delta-v still available from the on-board manoeuvring propellant. */
export function availableDeltaVMps(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): number {
  const prop = state.ascentPropellantKg;
  if (prop <= 0) return 0;
  const m0 = totalMassKg(state);
  const m1 = m0 - prop;
  if (m1 <= 0) return 0;
  return exhaustVelocityMps(parameters) * Math.log(m0 / m1);
}

/** Propellant needed for an ideal delta-v at the current mass. */
export function propellantForDeltaVKg(
  state: Readonly<LunarFlightState>,
  deltaVMps: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): number {
  if (deltaVMps <= 0) return 0;
  const m0 = totalMassKg(state);
  const ve = exhaustVelocityMps(parameters);
  return m0 * (1 - Math.exp(-deltaVMps / ve));
}

/** Burn duration for an ideal delta-v at constant thrust. */
export function burnSecondsForDeltaV(
  state: Readonly<LunarFlightState>,
  deltaVMps: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): number {
  const thrust = parameters.ascentEngine.thrustN.value;
  if (thrust <= 0) return 0;
  const dm = propellantForDeltaVKg(state, deltaVMps, parameters);
  const mdot = thrust / exhaustVelocityMps(parameters);
  return mdot > 0 ? dm / mdot : 0;
}

export interface FiniteBurnOptions {
  /** Hard limit on integrated burn time, seconds. Default 900. */
  readonly maxSeconds?: number;
}

/**
 * Integrate a finite burn until the ideal delta-v target is reached, the
 * propellant runs out, or a terminal state occurs. Pure and deterministic.
 */
export function executeFiniteBurn(
  initial: Readonly<LunarFlightState>,
  direction: BurnDirection,
  targetDeltaVMps: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  options: FiniteBurnOptions = {},
): FiniteBurnResult {
  const substepUs = parameters.integration.substepUs;
  const maxSeconds = options.maxSeconds ?? 900;
  const maxSteps = Math.max(0, Math.floor((maxSeconds * 1_000_000) / substepUs));
  const ve = exhaustVelocityMps(parameters);
  const startProp = initial.ascentPropellantKg;
  const startTimeUs = initial.missionTimeUs;

  let state: LunarFlightState = initial;
  let achieved = 0;

  if (!(targetDeltaVMps > 0)) {
    return {
      state,
      achievedDeltaVMps: 0,
      propellantUsedKg: 0,
      burnSeconds: 0,
      completed: true,
      ranOutOfPropellant: false,
    };
  }

  let steps = 0;
  let ranOut = false;
  while (achieved < targetDeltaVMps && steps < maxSteps) {
    if (state.terminalState !== null) break;
    if (state.ascentPropellantKg <= 0) {
      ranOut = true;
      break;
    }
    const attitude = attitudeForDirection(state, direction);
    const aligned: LunarFlightState = { ...state, attitudeRad: attitude };
    const input: LunarControlInput = {
      throttle: 1,
      engineCommand: "ascent",
      attitudeCommand: 0,
      stageSeparation: false,
    };
    const m0 = totalMassKg(aligned);
    const next = stepLunarFlight(aligned, input, substepUs, parameters);
    const m1 = totalMassKg(next);
    if (m1 > 0 && m0 > m1) achieved += ve * Math.log(m0 / m1);
    state = next;
    steps += 1;
    if (state.ascentPropellantKg <= 0 && achieved < targetDeltaVMps) {
      ranOut = true;
      break;
    }
  }

  return {
    state,
    achievedDeltaVMps: achieved,
    propellantUsedKg: startProp - state.ascentPropellantKg,
    burnSeconds: (state.missionTimeUs - startTimeUs) / 1_000_000,
    completed: achieved >= targetDeltaVMps,
    ranOutOfPropellant: ranOut,
  };
}
