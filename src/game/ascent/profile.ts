// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Pure, deterministic ascent profile runner.
//
// Used by tests (determinism, staging, failure modes) and by the explicitly
// labelled demonstration autopilot in the UI. Given the same mission, the same
// options and the same control law it always produces the same trajectory.
//
// The control law here is the game's own advisory guidance. It is NOT the AGC:
// no AGC state is read and no AGC output is applied.

import {
  computeOrbitalValues,
  createLunarFlightState,
  stepLunarFlight,
  type LunarControlInput,
  type LunarFlightParameters,
  type LunarFlightState,
} from "@/simulation/lunar2d";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import { computeAscentGuidance } from "./guidance";
import { targetForMission } from "./missions";
import { evaluateAscentOutcome } from "./orbit";
import type {
  AscentMissionDefinition,
  AscentOutcome,
  AscentPhase,
} from "./types";

export const ASCENT_STEP_US = 20_000;

/**
 * Parameters for a mission: the sandbox never latches an orbital terminal
 * state, so the player can keep manoeuvring after insertion.
 */
export function parametersForAscentMission(
  mission: Readonly<AscentMissionDefinition>,
  base: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): LunarFlightParameters {
  return {
    ...base,
    integration: {
      ...base.integration,
      orbitPeriapsisAltitudeM: mission.sandbox
        ? Number.POSITIVE_INFINITY
        : mission.safePeriapsisAltitudeM,
    },
  };
}

/** Initial state: on the surface as a complete LM, or already in orbit. */
export function createAscentInitialState(
  mission: Readonly<AscentMissionDefinition>,
  parameters: Readonly<LunarFlightParameters> = parametersForAscentMission(mission),
): LunarFlightState {
  if (mission.sandbox) {
    const target = targetForMission(mission);
    const R = parameters.terrain.meanRadiusM;
    const mu = parameters.environment.gravitationalParameterM3S2.value;
    // Start at the low point of the published insertion orbit.
    const rp = R + 9 * 1852;
    const ra = R + 45 * 1852;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(mu * (2 / rp - 1 / a));
    void target;
    return createLunarFlightState(
      {
        altitudeM: rp - R,
        radialSpeedMps: 0,
        tangentialSpeedMps: vp,
        attitudeRad: Math.PI / 2,
        configuration: "ascent-stage",
        ascentPropellantKg: mission.ascentPropellantKg,
        rcsPropellantKg: mission.rcsPropellantKg,
      },
      parameters,
    );
  }

  return createLunarFlightState(
    {
      altitudeM: 0,
      radialSpeedMps: 0,
      tangentialSpeedMps: 0,
      attitudeRad: 0,
      configuration: "complete-lm",
      // The descent stage is spent: it is the launch pad, not a usable engine.
      descentPropellantKg: 0,
      ascentPropellantKg: mission.ascentPropellantKg,
      rcsPropellantKg: mission.rcsPropellantKg,
    },
    parameters,
  );
}

export interface AscentProfileOptions {
  /** Stop after this many seconds of flight. */
  readonly maxSeconds?: number;
  /** Override the automatic cutoff decision (seconds after liftoff). */
  readonly forcedCutoffSeconds?: number | null;
  /** Never cut off; burn to depletion. */
  readonly burnToDepletion?: boolean;
  /** Sample every state (large); otherwise only the final state is kept. */
  readonly captureHistory?: boolean;
  /** Seconds of coast simulated after cutoff. Default 0. */
  readonly coastSeconds?: number;
  /** Constant pitch command override, radians from local vertical. */
  readonly fixedPitchRad?: number | null;
}

export interface AscentProfileResult {
  readonly finalState: LunarFlightState;
  readonly outcome: AscentOutcome;
  readonly cutoffMissionTimeUs: number | null;
  readonly phase: AscentPhase;
  readonly history: readonly LunarFlightState[];
}

/**
 * Attitude authority command that drives the body angle onto `desiredPitchRad`.
 * Shared by the demonstration autopilot and the profile runner so both behave
 * identically. Pure.
 */
export function attitudeCommandFor(
  state: Readonly<LunarFlightState>,
  desiredPitchRad: number,
): number {
  const err = desiredPitchRad - state.attitudeRad;
  const raw = err * 3 - state.angularRateRadPerSec * 2.5;
  return raw < -1 ? -1 : raw > 1 ? 1 : raw;
}

export function runAscentProfile(
  mission: Readonly<AscentMissionDefinition>,
  options: AscentProfileOptions = {},
): AscentProfileResult {
  const parameters = parametersForAscentMission(mission);
  const target = targetForMission(mission);
  const maxSeconds = options.maxSeconds ?? 900;
  const coastSeconds = options.coastSeconds ?? 0;
  const history: LunarFlightState[] = [];

  let state = createAscentInitialState(mission, parameters);
  if (options.captureHistory) history.push(state);

  let staged = mission.sandbox;
  let cutoff = false;
  let cutoffUs: number | null = null;
  let phase: AscentPhase = "surface-preparation";
  const totalSteps = Math.round(
    ((maxSeconds + coastSeconds) * 1_000_000) / ASCENT_STEP_US,
  );
  const startUs = state.missionTimeUs;

  for (let i = 0; i < totalSteps; i++) {
    if (state.terminalState !== null) break;
    const burnElapsedS = (state.missionTimeUs - startUs) / 1_000_000;
    if (burnElapsedS >= maxSeconds && !cutoff) {
      cutoff = true;
      cutoffUs = state.missionTimeUs;
    }

    const cue = computeAscentGuidance(
      state,
      mission,
      target,
      burnElapsedS,
      true,
      parameters,
    );
    phase = cue.phase;

    if (!cutoff) {
      if (options.forcedCutoffSeconds != null) {
        if (burnElapsedS >= options.forcedCutoffSeconds) {
          cutoff = true;
          cutoffUs = state.missionTimeUs;
        }
      } else if (!options.burnToDepletion && cue.recommendCutoff) {
        cutoff = true;
        cutoffUs = state.missionTimeUs;
      }
    }

    const desiredPitch =
      options.fixedPitchRad != null ? options.fixedPitchRad : cue.recommendedPitchRad;

    const input: LunarControlInput = {
      throttle: cutoff ? 0 : 1,
      engineCommand: cutoff ? "off" : "ascent",
      attitudeCommand: cutoff ? 0 : attitudeCommandFor(state, desiredPitch),
      stageSeparation: !staged,
    };
    staged = true;

    state = stepLunarFlight(state, input, ASCENT_STEP_US, parameters);
    if (options.captureHistory) history.push(state);

    if (cutoff && coastSeconds <= 0) break;
    if (
      cutoff &&
      cutoffUs !== null &&
      (state.missionTimeUs - cutoffUs) / 1_000_000 >= coastSeconds
    ) {
      break;
    }
  }

  const powered = state.mainEngine === "ascent";
  return {
    finalState: state,
    outcome: evaluateAscentOutcome(state, mission, powered, parameters),
    cutoffMissionTimeUs: cutoffUs,
    phase,
    history,
  };
}

/** Convenience for the UI/debrief: orbital values under mission parameters. */
export function ascentOrbit(
  state: Readonly<LunarFlightState>,
  mission: Readonly<AscentMissionDefinition>,
) {
  return computeOrbitalValues(state, parametersForAscentMission(mission));
}
