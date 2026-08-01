// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Advisory ascent guidance (pitch program).
//
// ADVISORY ONLY. This is a teaching aid. Nothing in the kernel, the session
// hook, or the UI applies its output automatically; the instructor overlay
// draws the cue and the player decides. The one exception is the explicitly
// labelled demonstration autopilot in `profile.ts`, which the player has to
// switch on and which is recorded in the debrief.
//
// This is NOT Luminary's P12. The AGC session is never consulted here.

import {
  computeOrbitalValues,
  totalMassKg,
  type LunarFlightParameters,
  type LunarFlightState,
} from "@/simulation/lunar2d";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import { timeToApoapsisSeconds } from "./orbit";
import type { AscentMissionDefinition, AscentPhase, TargetOrbit } from "./types";

/** Radial-speed schedule anchor at the top of the pitch-over, m/s. */
const VERTICAL_RISE_TARGET_MPS = 80;
/** Time constant for driving the radial-speed error out, seconds. */
const RADIAL_TAU_S = 10;
/** The advisory never asks for more than this from local vertical. */
const MAX_PITCH_RAD = (88 * Math.PI) / 180;

export interface AscentGuidanceCue {
  readonly phase: AscentPhase;
  /** Advisory body angle from local vertical, radians. */
  readonly recommendedPitchRad: number;
  /** Current minus recommended pitch, radians. */
  readonly pitchErrorRad: number;
  readonly targetRadialSpeedMps: number;
  readonly radialSpeedErrorMps: number;
  readonly recommendCutoff: boolean;
  readonly timeToApoapsisS: number | null;
  readonly advisory: string;
}

export function computeAscentGuidance(
  state: Readonly<LunarFlightState>,
  mission: Readonly<AscentMissionDefinition>,
  target: Readonly<TargetOrbit>,
  burnElapsedSeconds: number,
  lifted: boolean,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): AscentGuidanceCue {
  const orbit = computeOrbitalValues(state, parameters);
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const mass = totalMassKg(state);
  const thrust = parameters.ascentEngine.thrustN.value;
  const aTotal = mass > 0 ? thrust / mass : 0;

  const hIns = Math.max(1, mission.insertionAltitudeM);
  // Square-root altitude schedule: climb hard early, flatten out at the
  // insertion altitude so the low point of the final orbit ends up there.
  const climbFraction = Math.max(0, 1 - orbit.altitudeM / hIns);
  const targetRadial = VERTICAL_RISE_TARGET_MPS * Math.sqrt(climbFraction);
  const radialError = orbit.radialSpeedMps - targetRadial;

  // Radial acceleration the vehicle must hold: cancel gravity, credit the
  // centrifugal relief that horizontal speed already buys, then null the
  // radial-rate error.
  const localG = mu / (orbit.radiusM * orbit.radiusM);
  const centrifugal =
    (orbit.tangentialSpeedMps * orbit.tangentialSpeedMps) / orbit.radiusM;
  const aRadialNeeded =
    localG - centrifugal + (targetRadial - orbit.radialSpeedMps) / RADIAL_TAU_S;

  let pitch = 0;
  if (aTotal > 0) {
    pitch = Math.acos(Math.min(1, Math.max(-1, aRadialNeeded / aTotal)));
  }
  if (!Number.isFinite(pitch)) pitch = 0;
  if (pitch > MAX_PITCH_RAD) pitch = MAX_PITCH_RAD;
  if (pitch < 0) pitch = 0;

  const inVerticalRise = lifted && burnElapsedSeconds < mission.verticalRiseSeconds;
  if (inVerticalRise) pitch = 0;

  const apo = orbit.apoapsisAltitudeM;
  // Cutting off as soon as the high point reaches the target is the classic
  // mistake: the low point is still inside the Moon while the vehicle is only
  // part-way up. The cue therefore also waits for the insertion altitude.
  const recommendCutoff =
    lifted &&
    (apo === null ||
      (apo >= target.apoapsisAltitudeM &&
        orbit.periapsisAltitudeM >= mission.safePeriapsisAltitudeM));

  let phase: AscentPhase;
  if (!lifted) phase = "surface-preparation";
  else if (inVerticalRise) phase = "vertical-rise";
  else if (state.mainEngine !== "ascent") phase = "coast";
  else if (pitch < Math.PI / 4) phase = "pitch-over";
  else phase = "orbital-acceleration";

  let advisory: string;
  if (!lifted) {
    advisory = "Stage the descent stage, then commit to liftoff.";
  } else if (inVerticalRise) {
    advisory = `Hold vertical for ${(mission.verticalRiseSeconds - burnElapsedSeconds).toFixed(0)} s to clear the descent stage.`;
  } else if (recommendCutoff) {
    advisory = "Apoapsis is at the target — cut off the ascent engine.";
  } else if (orbit.periapsisAltitudeM < 0) {
    advisory =
      "Periapsis is still below the surface: keep pitching over and building horizontal speed.";
  } else {
    advisory = `Pitch ${((pitch * 180) / Math.PI).toFixed(0)}° from vertical and keep the horizontal speed climbing.`;
  }

  return {
    phase,
    recommendedPitchRad: pitch,
    pitchErrorRad: state.attitudeRad - pitch,
    targetRadialSpeedMps: targetRadial,
    radialSpeedErrorMps: radialError,
    recommendCutoff,
    timeToApoapsisS: timeToApoapsisSeconds(orbit, parameters),
    advisory,
  };
}
