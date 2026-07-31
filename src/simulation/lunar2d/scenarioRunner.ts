// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Deterministic scenario/replay runner for the planar kernel.
// Pure: no clocks, no randomness, no I/O. Given the same initial state and
// the same command schedule it always produces the same terminal state.

import type {
  LunarControlInput,
  LunarFlightState,
  TimedLunarCommand,
} from "./types";
import type { LunarFlightParameters } from "./LunarMissionConstants";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "./LunarMissionConstants";
import { stepLunarFlight } from "./physics";

export interface LunarRunResult {
  readonly finalState: LunarFlightState;
  readonly history: readonly LunarFlightState[];
}

export interface LunarRunOptions {
  /** Capture a state sample at every command boundary. Default false. */
  readonly captureHistory?: boolean;
  /** If > 0, also sample the state on this microsecond cadence. */
  readonly sampleIntervalUs?: number;
}

export const NEUTRAL_CONTROL: LunarControlInput = {
  throttle: 0,
  engineCommand: "off",
  attitudeCommand: 0,
  stageSeparation: false,
};

function sortCommands(
  commands: readonly TimedLunarCommand[],
): TimedLunarCommand[] {
  const indexed = commands.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => {
    if (a.c.missionTimeUs !== b.c.missionTimeUs) {
      return a.c.missionTimeUs - b.c.missionTimeUs;
    }
    const ao = a.c.order ?? 0;
    const bo = b.c.order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.i - b.i;
  });
  return indexed.map((x) => x.c);
}

export function applyLunarCommand(
  control: LunarControlInput,
  command: TimedLunarCommand,
): LunarControlInput {
  return {
    throttle: command.throttle ?? control.throttle,
    engineCommand: command.engineCommand ?? control.engineCommand,
    attitudeCommand: command.attitudeCommand ?? control.attitudeCommand,
    // Staging is edge-like: a command that does not mention it clears it, so
    // a single scheduled separation does not latch forever.
    stageSeparation: command.stageSeparation ?? false,
  };
}

/**
 * Evolve `initialState` under `commands` until `endTimeUs` (absolute mission
 * microseconds) or until a terminal state is reached.
 */
export function runLunarScenario(
  initialState: Readonly<LunarFlightState>,
  commands: readonly TimedLunarCommand[],
  endTimeUs: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  options: LunarRunOptions = {},
): LunarRunResult {
  if (!Number.isFinite(endTimeUs) || endTimeUs < initialState.missionTimeUs) {
    throw new RangeError(
      `runLunarScenario: endTimeUs (${endTimeUs}) must be >= initial missionTimeUs (${initialState.missionTimeUs})`,
    );
  }

  const substepUs = parameters.integration.substepUs;
  const sorted = sortCommands(commands);
  const history: LunarFlightState[] = [];
  const capture = options.captureHistory === true;
  const sample = options.sampleIntervalUs ?? 0;
  if (capture) history.push(initialState);

  let state: LunarFlightState = initialState;
  let control: LunarControlInput = NEUTRAL_CONTROL;
  let cmdIdx = 0;

  while (
    cmdIdx < sorted.length &&
    sorted[cmdIdx].missionTimeUs <= state.missionTimeUs
  ) {
    control = applyLunarCommand(control, sorted[cmdIdx]);
    cmdIdx++;
  }

  while (state.missionTimeUs < endTimeUs && state.terminalState === null) {
    const nextCmdTime =
      cmdIdx < sorted.length
        ? sorted[cmdIdx].missionTimeUs
        : Number.POSITIVE_INFINITY;
    let boundary = Math.min(nextCmdTime, endTimeUs);
    if (sample > 0) {
      const nextSample =
        Math.floor(state.missionTimeUs / sample) * sample + sample;
      boundary = Math.min(boundary, nextSample);
    }
    let dtUs = boundary - state.missionTimeUs;
    dtUs = Math.trunc(dtUs / substepUs) * substepUs;

    if (dtUs <= 0) {
      if (nextCmdTime <= state.missionTimeUs) {
        control = applyLunarCommand(control, sorted[cmdIdx]);
        cmdIdx++;
        continue;
      }
      // Remaining interval is shorter than one substep: nothing further to do.
      break;
    }

    state = stepLunarFlight(state, control, dtUs, parameters);
    // Staging is consumed by the step that applied it.
    if (control.stageSeparation) control = { ...control, stageSeparation: false };

    if (capture) history.push(state);

    while (
      cmdIdx < sorted.length &&
      sorted[cmdIdx].missionTimeUs <= state.missionTimeUs
    ) {
      control = applyLunarCommand(control, sorted[cmdIdx]);
      cmdIdx++;
    }
  }

  return { finalState: state, history };
}

// -----------------------------------------------------------------------------
// Deterministic serialization + checksum (replay proof)
// -----------------------------------------------------------------------------

/** Canonical, key-ordered JSON for a flight state. */
export function canonicalizeLunarState(state: Readonly<LunarFlightState>): string {
  const canon = (s: Readonly<LunarFlightState>): unknown => ({
    missionTimeUs: s.missionTimeUs,
    positionM: [s.positionM[0], s.positionM[1]],
    velocityMps: [s.velocityMps[0], s.velocityMps[1]],
    attitudeRad: s.attitudeRad,
    angularRateRadPerSec: s.angularRateRadPerSec,
    configuration: s.configuration,
    dryMassKg: s.dryMassKg,
    descentPropellantKg: s.descentPropellantKg,
    ascentPropellantKg: s.ascentPropellantKg,
    rcsPropellantKg: s.rcsPropellantKg,
    mainEngine: s.mainEngine,
    throttle: s.throttle,
    terminalState: s.terminalState,
    touchdown: s.touchdown
      ? {
          classification: s.touchdown.classification,
          missionTimeUs: s.touchdown.missionTimeUs,
          verticalSpeedMps: s.touchdown.verticalSpeedMps,
          horizontalSpeedMps: s.touchdown.horizontalSpeedMps,
          tiltRad: s.touchdown.tiltRad,
          violations: [...s.touchdown.violations],
        }
      : null,
    separatedDescentStage: s.separatedDescentStage
      ? canon(s.separatedDescentStage)
      : null,
  });
  return JSON.stringify(canon(state));
}

/** FNV-1a 32-bit checksum over the canonical serialization. */
export function lunarStateChecksum(state: Readonly<LunarFlightState>): number {
  const text = canonicalizeLunarState(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
