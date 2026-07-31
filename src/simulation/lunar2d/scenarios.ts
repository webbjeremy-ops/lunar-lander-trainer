// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Versioned scenario registry for the planar lunar-flight kernel.
// Scenarios are pure data: an initial condition plus parameter overrides.
// Adding or editing a scenario must bump its `version`, so replays recorded
// against an older definition are detectable.

import type { LunarFlightState } from "./types";
import type { LunarFlightParameters } from "./LunarMissionConstants";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  LUNAR_ENVIRONMENT,
} from "./LunarMissionConstants";
import { createLunarFlightState, type InitialStateOptions } from "./physics";

export type LunarScenarioId =
  | "terminal-descent"
  | "high-gate-descent"
  | "liftoff-training"
  | "orbital-mechanics-sandbox";

export interface LunarScenarioDefinition {
  readonly id: LunarScenarioId;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly objective: string;
  readonly initial: InitialStateOptions;
  readonly parameters: LunarFlightParameters;
}

const R = LUNAR_ENVIRONMENT.meanRadiusM.value;

/** Circular orbital speed at a given altitude above the mean radius. */
export function circularSpeedAtAltitude(altitudeM: number): number {
  return Math.sqrt(
    LUNAR_ENVIRONMENT.gravitationalParameterM3S2.value / (R + altitudeM),
  );
}

export const LUNAR_SCENARIOS: Readonly<
  Record<LunarScenarioId, LunarScenarioDefinition>
> = {
  "terminal-descent": {
    id: "terminal-descent",
    version: 1,
    title: "Terminal descent",
    summary:
      "150 m above a flat site, near-vertical, low residual horizontal rate.",
    objective:
      "Touch down inside the landing-gear limits: under 3.05 m/s vertical, " +
      "1.2 m/s horizontal, 6 degrees of tilt.",
    initial: {
      altitudeM: 150,
      radialSpeedMps: -4,
      tangentialSpeedMps: 3,
      attitudeRad: 0,
      configuration: "complete-lm",
      descentPropellantKg: 700,
    },
    parameters: DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  },

  "high-gate-descent": {
    id: "high-gate-descent",
    version: 1,
    title: "High gate",
    summary:
      "2,300 m altitude with substantial downrange velocity, as at the LM's " +
      "high-gate transition into the visibility phase.",
    objective:
      "Null the horizontal velocity and arrive over the site with a " +
      "controlled sink rate, then land within gear limits.",
    initial: {
      altitudeM: 2_300,
      radialSpeedMps: -44,
      tangentialSpeedMps: 155,
      attitudeRad: -0.6,
      configuration: "complete-lm",
      descentPropellantKg: 2_400,
    },
    parameters: DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  },

  "liftoff-training": {
    id: "liftoff-training",
    version: 1,
    title: "Ascent-stage liftoff",
    summary:
      "Ascent stage on the surface, APS loaded. Non-throttleable engine.",
    objective:
      "Pitch over after the vertical rise and reach a periapsis at or above " +
      "15 km without depleting the APS.",
    initial: {
      altitudeM: 0,
      radialSpeedMps: 0,
      tangentialSpeedMps: 0,
      attitudeRad: 0,
      configuration: "ascent-stage",
    },
    parameters: DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  },

  "orbital-mechanics-sandbox": {
    id: "orbital-mechanics-sandbox",
    version: 1,
    title: "Orbital mechanics sandbox",
    summary:
      "Circular 100 km orbit with the complete LM. No terminal orbit check; " +
      "free to experiment with prograde and retrograde burns.",
    objective:
      "Observe how a burn along or against the velocity vector moves " +
      "apoapsis and periapsis.",
    initial: {
      altitudeM: 100_000,
      radialSpeedMps: 0,
      tangentialSpeedMps: circularSpeedAtAltitude(100_000),
      attitudeRad: Math.PI / 2,
      configuration: "complete-lm",
    },
    parameters: DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  },
};

export const LUNAR_SCENARIO_IDS: readonly LunarScenarioId[] = [
  "terminal-descent",
  "high-gate-descent",
  "liftoff-training",
  "orbital-mechanics-sandbox",
];

export function getLunarScenario(id: LunarScenarioId): LunarScenarioDefinition {
  const scenario = LUNAR_SCENARIOS[id];
  if (!scenario) throw new Error(`Unknown lunar scenario: ${id}`);
  return scenario;
}

export function instantiateLunarScenario(
  id: LunarScenarioId,
): { definition: LunarScenarioDefinition; state: LunarFlightState } {
  const definition = getLunarScenario(id);
  return {
    definition,
    state: createLunarFlightState(definition.initial, definition.parameters),
  };
}
