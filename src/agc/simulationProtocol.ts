// SPDX-License-Identifier: GPL-3.0-or-later
//
// Simulation protocol — client ↔ Worker messages for the MissionRuntime
// that lives inside the AGC Worker.
//
// The transport is the existing AGC Web-Worker channel. This is a distinct
// message namespace with its own `simulationProtocolVersion` so it can be
// bumped independently of the AGC protocol. Every command and event
// discriminator is prefixed with `sim:`; the Worker's dispatcher routes on
// that prefix and everything else stays on the frozen AGC path.
//
// VERSION 2 (M3.3A2-P5.d) — activates the monitor-mode surface reserved in
// P5.a. Additive only: every v1 command/event keeps its shape, and the
// FROZEN M2 AGC protocol (`ReadyPayload`, `agc:extension-ready`, event
// export/replay) is untouched.
//
// `sim:ready` carries STATIC capability information only. Mutable monitor
// state (current profile, status, block reasons, trace counters) travels on
// mission snapshots and command acknowledgments.

import type {
  CommandAck,
  MissionCommand,
  MissionRuntimeStatus,
  MissionSnapshot,
  TerminalTouchdownEvent,
} from "@/simulation/runtime/types";
import type { AgcMonitorProfile, MonitorBlockReason } from "@/simulation/agcio/types";
import type { MonitorTraceEntry } from "@/simulation/agcio/monitorTrace";
import type { LmDiscreteSensorState } from "@/simulation/agcio/discreteEncoder";

export const SIMULATION_PROTOCOL_VERSION = 2 as const;

/** Static capability list advertised on `sim:ready`. Includes profiles the
 *  Worker will *accept a command for* — `descent-monitor-v1` is accepted and
 *  then authentically blocked, which is different from silently unknown. */
export const SUPPORTED_MONITOR_PROFILES: readonly AgcMonitorProfile[] = [
  "off",
  "discrete-observer-v0",
  "agc-hardware-interface-lab-v1",
  "descent-monitor-v1",
];


/** Epoch-bound, tick-aligned monitor profile command (P5.a shape). */
export interface SetMonitorProfileCommand {
  readonly type: "sim:set-monitor-profile";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly applyAtMissionTimeUs: number;
  readonly profile: AgcMonitorProfile;
}

/** Operator-declared avionics discrete state. The Worker never invents
 *  these values; monitor entry is blocked until a complete state arrives. */
export interface SetAvionicsStateCommand {
  readonly type: "sim:set-avionics";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly avionics: LmDiscreteSensorState;
}

export interface RequestMonitorTraceCommand {
  readonly type: "sim:request-monitor-trace";
  readonly requestId: number;
  readonly simulationEpoch: number;
}

/** M3.3C Phase 4B — install the NON-FLIGHT SCENARIO PAD LOAD (fixed-attitude
 *  IMU bootstrap). Carries NO addresses or words: the Worker owns the
 *  source-derived manifest, so this can never become a memory editor. */
export interface ApplyImuBootstrapCommand {
  readonly type: "sim:apply-imu-bootstrap";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly manifestId: "luminary099-fixed-attitude-descent-padload-v1";
}

export interface ImuBootstrapResultEvent {
  readonly type: "sim:imu-bootstrap-result";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly agcEpoch: number;
  readonly ok: boolean;
  readonly manifestId: string;
  readonly installedWords: number;
  readonly failures: readonly { readonly code: string; readonly detail: string }[];
}

/** Structural-clone-safe wire form: MissionCommand is already all
 *  primitives + a plain LmScenarioDefinition (numbers/strings/booleans). */
export type SimulationCommand =
  | { type: "sim:enqueue"; command: MissionCommand }
  | { type: "sim:queryReady" }
  | { type: "sim:forceSnapshot" }
  | SetMonitorProfileCommand
  | SetAvionicsStateCommand
  | RequestMonitorTraceCommand
  | ApplyImuBootstrapCommand;

export interface SimReadyPayload {
  simulationProtocolVersion: typeof SIMULATION_PROTOCOL_VERSION;
  simulationEpoch: number;
  missionTickUs: number;
  status: MissionRuntimeStatus;
  /** STATIC capability advertisement (v2). Never mutable monitor state. */
  supportedMonitorProfiles: readonly AgcMonitorProfile[];
}

export interface MonitorBlockedEvent {
  readonly type: "sim:monitor-blocked";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly requestedProfile: AgcMonitorProfile;
  readonly reasons: readonly MonitorBlockReason[];
}

export interface MonitorTraceEvent {
  readonly type: "sim:monitor-trace";
  readonly requestId: number;
  readonly simulationEpoch: number;
  readonly agcEpoch: number;
  readonly profile: AgcMonitorProfile;
  /** Retained window in the Worker's bounded diagnostic ring. */
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  readonly retainedCount: number;
  readonly capacity: number;
  /** Entries evicted from the Worker ring (bounded retention overflow). */
  readonly droppedCount: number;
  /** Entries the WASM output-counter ring itself dropped. */
  readonly wasmDroppedCount: number;
  /** Entries still pending inside the WASM ring. Zero after every drain. */
  readonly wasmPendingCount: number;
  readonly events: readonly MonitorTraceEntry[];
}

export type SimulationEvent =
  | { type: "sim:ready"; payload: SimReadyPayload }
  | { type: "sim:snapshot"; payload: MissionSnapshot }
  | { type: "sim:commandAck"; payload: CommandAck }
  | { type: "sim:terminalTouchdown"; payload: TerminalTouchdownEvent }
  | MonitorBlockedEvent
  | MonitorTraceEvent
  | ImuBootstrapResultEvent;

export function isSimulationMessage(msg: { type: string } | null | undefined): boolean {
  return !!msg && typeof msg.type === "string" && msg.type.startsWith("sim:");
}
