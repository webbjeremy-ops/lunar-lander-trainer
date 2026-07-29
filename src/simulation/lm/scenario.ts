// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deterministic scenario runner: applies a timestamped command schedule to
// the pure physics kernel and returns the terminal state. No wall clock,
// no side effects.

import type {
  LmControlInput,
  LmPhysicsState,
  TimedLmCommand,
} from "./types";
import type { LmPhysicsParameters } from "./parameters";
import { DEFAULT_LM_PHYSICS_PARAMETERS } from "./parameters";
import { stepLmPhysics } from "./physics";

export interface LmScenarioResult {
  readonly finalState: LmPhysicsState;
  readonly history: readonly LmPhysicsState[];
}

/**
 * Sort commands by (simulationTimeUs, order, original index). Stable.
 */
function sortCommands(commands: readonly TimedLmCommand[]): TimedLmCommand[] {
  const indexed = commands.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => {
    if (a.c.simulationTimeUs !== b.c.simulationTimeUs) {
      return a.c.simulationTimeUs - b.c.simulationTimeUs;
    }
    const ao = a.c.order ?? 0;
    const bo = b.c.order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.i - b.i;
  });
  return indexed.map((x) => x.c);
}

export interface RunOptions {
  /** If true, record state after every command / boundary. Default false. */
  readonly captureHistory?: boolean;
}

/**
 * Deterministically evolve `initialState` under `commands` until
 * `endTimeUs` (mission microseconds, absolute) is reached or the vehicle
 * lands. Returns the final state and (optionally) a history.
 */
export function runLmScenario(
  initialState: Readonly<LmPhysicsState>,
  commands: readonly TimedLmCommand[],
  endTimeUs: number,
  parameters: Readonly<LmPhysicsParameters> = DEFAULT_LM_PHYSICS_PARAMETERS,
  options: RunOptions = {},
): LmScenarioResult {
  if (!Number.isFinite(endTimeUs) || endTimeUs < initialState.simulationTimeUs) {
    throw new RangeError(
      `runLmScenario: endTimeUs (${endTimeUs}) must be >= initial simulationTimeUs (${initialState.simulationTimeUs})`,
    );
  }

  const substepUs = parameters.integration.substepUs;
  const sorted = sortCommands(commands);
  const history: LmPhysicsState[] = [];
  if (options.captureHistory) history.push(initialState);

  let state: LmPhysicsState = initialState;
  let control: LmControlInput = {
    throttle: initialState.throttle,
    engineEnabled: initialState.engineEnabled,
  };
  let cmdIdx = 0;

  // Apply any commands scheduled at or before the initial time (order stable).
  while (
    cmdIdx < sorted.length &&
    sorted[cmdIdx].simulationTimeUs <= state.simulationTimeUs
  ) {
    control = applyCommand(control, sorted[cmdIdx]);
    cmdIdx++;
  }

  while (state.simulationTimeUs < endTimeUs && !state.landed) {
    // Next boundary is either the next command's time or endTimeUs.
    const nextCmdTime = cmdIdx < sorted.length
      ? sorted[cmdIdx].simulationTimeUs
      : Number.POSITIVE_INFINITY;
    const boundary = Math.min(nextCmdTime, endTimeUs);
    let dtUs = boundary - state.simulationTimeUs;
    // Quantise to whole substeps so the integrator stays in lockstep.
    dtUs = Math.trunc(dtUs / substepUs) * substepUs;

    if (dtUs > 0) {
      state = stepLmPhysics(state, control, dtUs, parameters);
      if (options.captureHistory) history.push(state);
    } else {
      // Boundary lies inside a substep; nudge time forward to the boundary
      // by advancing one substep so we always make progress.
      const forced = stepLmPhysics(state, control, substepUs, parameters);
      state = forced;
      if (options.captureHistory) history.push(state);
    }

    // Apply every command whose time we've now reached, in stable order.
    while (
      cmdIdx < sorted.length &&
      sorted[cmdIdx].simulationTimeUs <= state.simulationTimeUs &&
      !state.landed
    ) {
      control = applyCommand(control, sorted[cmdIdx]);
      cmdIdx++;
    }
  }

  return { finalState: state, history };
}

function applyCommand(current: LmControlInput, cmd: TimedLmCommand): LmControlInput {
  return {
    throttle: cmd.throttle ?? current.throttle,
    engineEnabled: cmd.engineEnabled ?? current.engineEnabled,
  };
}
