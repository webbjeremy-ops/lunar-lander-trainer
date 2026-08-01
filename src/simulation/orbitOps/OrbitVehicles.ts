// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Vehicle construction and propulsion parameter resolution.
//
// The authoritative propagator stays `stepLunarFlight` from the frozen M4.0
// kernel. This module only builds initial states and derives the parameter
// record that selects which propulsion source a scenario may use.

import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import { createLunarFlightState } from "@/simulation/lunar2d/physics";
import type { LunarFlightState } from "@/simulation/lunar2d/types";
import { orbitNumber } from "./OrbitConstants";
import type { OrbitVehicleSeed, PropulsionSourceId } from "./types";
import { visVivaSpeedMps } from "./OrbitalElements";

export interface PropulsionProfile {
  readonly id: PropulsionSourceId;
  readonly label: string;
  readonly thrustN: number;
  readonly specificImpulseS: number;
  readonly restartable: boolean;
  readonly minimumImpulseSeconds: number;
  readonly educational: boolean;
}

export const PROPULSION_PROFILES: Readonly<
  Record<PropulsionSourceId, PropulsionProfile>
> = {
  "ascent-propulsion": {
    id: "ascent-propulsion",
    label: "Ascent propulsion system (APS)",
    thrustN: DEFAULT_LUNAR_FLIGHT_PARAMETERS.ascentEngine.thrustN.value,
    specificImpulseS:
      DEFAULT_LUNAR_FLIGHT_PARAMETERS.ascentEngine.specificImpulseS.value,
    restartable: false,
    minimumImpulseSeconds: 0.5,
    educational: false,
  },
  "rcs-translation": {
    id: "rcs-translation",
    label: "RCS translation (aggregated planar axis)",
    thrustN: orbitNumber("rcs-translation-thrust"),
    specificImpulseS: orbitNumber("rcs-translation-isp"),
    restartable: true,
    minimumImpulseSeconds: 0.1,
    educational: false,
  },
  "educational-maneuver-actuator": {
    id: "educational-maneuver-actuator",
    label: "Educational manoeuvre actuator",
    thrustN: orbitNumber("educational-actuator-thrust"),
    specificImpulseS: orbitNumber("educational-actuator-isp"),
    restartable: true,
    minimumImpulseSeconds: 0.1,
    educational: true,
  },
};

/**
 * Parameters for a manoeuvring vehicle. Only the ascent-engine slot is
 * overridden: the orbital-operations vehicle is always an ascent stage, so
 * that slot is the kernel's manoeuvring engine.
 */
export function parametersForPropulsion(
  propulsion: PropulsionSourceId,
  base: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightParameters {
  const profile = PROPULSION_PROFILES[propulsion];
  return {
    ...base,
    ascentEngine: {
      thrustN: {
        ...base.ascentEngine.thrustN,
        value: profile.thrustN,
        classification: profile.educational ? "gameplay-tuned" : base.ascentEngine.thrustN.classification,
      },
      specificImpulseS: {
        ...base.ascentEngine.specificImpulseS,
        value: profile.specificImpulseS,
      },
    },
    integration: {
      ...base.integration,
      // Orbital operations never latch "orbit-achieved": the scenario's own
      // objectives decide when the exercise is finished.
      orbitPeriapsisAltitudeM: Number.POSITIVE_INFINITY,
    },
  };
}

/**
 * Parameters for a passive body (the Command Module target). Identical to the
 * default kernel parameters except that the ascent-stage "orbit-achieved"
 * latch is disabled: a passive target must keep integrating forever.
 */
export const PASSIVE_TARGET_PARAMETERS: LunarFlightParameters = {
  ...DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  integration: {
    ...DEFAULT_LUNAR_FLIGHT_PARAMETERS.integration,
    orbitPeriapsisAltitudeM: Number.POSITIVE_INFINITY,
  },
};

/**
 * Build an ascent-stage state on the orbit described by `seed`, positioned at
 * one of its apsides. Pure and deterministic.
 */
export function createOrbitVehicleState(
  seed: OrbitVehicleSeed,
  propellantKg: number,
  rcsPropellantKg: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightState {
  const R = parameters.terrain.meanRadiusM;
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const rp = R + seed.periapsisAltitudeM;
  const ra = R + seed.apoapsisAltitudeM;
  const a = (rp + ra) / 2;
  const r = seed.startAtPeriapsis ? rp : ra;
  const speed = visVivaSpeedMps(r, a, mu);

  return createLunarFlightState(
    {
      altitudeM: r - R,
      centralAngleRad: seed.centralAngleRad,
      radialSpeedMps: 0,
      tangentialSpeedMps: speed,
      // Start aligned prograde: thrust axis along the velocity vector.
      attitudeRad: Math.PI / 2,
      configuration: "ascent-stage",
      ascentPropellantKg: propellantKg,
      rcsPropellantKg,
      missionTimeUs: 0,
    },
    parameters,
  );
}
