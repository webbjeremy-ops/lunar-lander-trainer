// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.2 Deterministic Mission Runtime — types.
//
// The runtime is a pure coordinator that lives inside the AGC Worker and
// composes the already-frozen M3.1 LM physics kernel with a timestamped
// command queue. Every value here is structured-cloneable so main-thread
// consumers can receive snapshots via postMessage without special handling.

import type {
  LmControlInput,
  LmPhysicsState,
  TimedLmCommand,
  TouchdownResult,
} from "@/simulation/lm";
import type { AgcMonitorSnapshot } from "@/simulation/agcio/types";

/** Runtime status is deliberately separate from the shared MissionClock
 *  state. `interlocked` is reserved for the AGC-reset-during-scenario
 *  condition and CANNOT be exited by merely un-pausing the clock. */
export type MissionRuntimeStatus =
  | "idle"
  | "running"
  | "interlocked"
  | "landed"
  | "crashed";

export type InterlockReason = "agc-epoch-changed" | null;

export interface LmScenarioDefinition {
  readonly id: string;
  /** LM state at scenario start. `simulationTimeUs` is IGNORED by the
   *  runtime — the scenario always begins at scenario-relative t=0. */
  readonly initialLmState: LmPhysicsState;
  /** Scenario-relative timed commands (t=0 at scenario start). */
  readonly timedCommands: readonly TimedLmCommand[];
}

export interface MissionCommandBase {
  readonly commandId: number;
  readonly simulationEpoch: number;
  /** Absolute mission time in microseconds. Must be strictly greater than
   *  the runtime's accepted cursor when the command is enqueued. */
  readonly applyAtMissionTimeUs: number;
}

export type MissionCommand =
  | (MissionCommandBase & {
      readonly type: "startScenario";
      readonly scenario: LmScenarioDefinition;
    })
  | (MissionCommandBase & {
      readonly type: "setControl";
      readonly throttle?: number;
      readonly engineEnabled?: boolean;
    })
  | (MissionCommandBase & {
      readonly type: "resetScenario";
    });

export type CommandRejectionReason =
  | "duplicate-command-id"
  | "stale-command"
  | "stale-simulation-epoch"
  | "scenario-not-running"
  | "interlocked";

export interface CommandAccepted {
  readonly accepted: true;
  readonly commandId: number;
}
export interface CommandRejected {
  readonly accepted: false;
  readonly commandId: number;
  readonly reason: CommandRejectionReason;
  readonly message: string;
}
export type CommandAck = CommandAccepted | CommandRejected;

export interface MissionRuntimeState {
  simulationEpoch: number;
  status: MissionRuntimeStatus;
  interlockReason: InterlockReason;

  scenarioId: string | null;
  scenarioStartMissionTimeUs: number | null;
  scenarioElapsedUs: number;

  lm: LmPhysicsState | null;
  control: LmControlInput;
  touchdown: TouchdownResult | null;

  lastAppliedCommandId: number | null;
  /** Last mission time at which a tick has completed. Commands with
   *  applyAtMissionTimeUs <= this are stale. Starts at -1 so a command
   *  scheduled at absolute mission time 0 is accepted. */
  acceptedCursorUs: number;
}

export interface MissionSnapshot {
  readonly sequence: number;
  readonly missionTick: number;
  readonly missionTimeUs: number;
  /** Shared MissionClock pause state — DISTINCT from runtime status. A
   *  user-initiated clock pause freezes the tick generator but does not
   *  alter `status`; the scenario is still logically "running". */
  readonly clockPaused: boolean;
  readonly simulationEpoch: number;
  readonly scenarioElapsedUs: number;
  readonly status: MissionRuntimeStatus;
  readonly interlockReason: InterlockReason;
  readonly lm: LmPhysicsState | null;
  readonly control: LmControlInput;
  readonly touchdown: TouchdownResult | null;
  /** Compact monitor state (simulation protocol v2). Never carries the
   *  retained trace ring — that is fetched via `sim:request-monitor-trace`.
   *  `null` when no monitor profile has ever been requested. */
  readonly monitor: AgcMonitorSnapshot | null;
}

export interface TerminalTouchdownEvent {
  readonly simulationEpoch: number;
  readonly scenarioId: string;
  readonly missionTick: number;
  readonly missionTimeUs: number;
  readonly scenarioElapsedUs: number;
  readonly touchdown: TouchdownResult;
  readonly finalLm: LmPhysicsState;
}
