// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.2 Simulation protocol — client ↔ Worker messages for the
// MissionRuntime that lives inside the AGC Worker.
//
// The transport is the existing AGC Web-Worker channel. This is a distinct
// message namespace with its own `simulationProtocolVersion` so it can be
// bumped independently of the AGC protocol. Every command and event
// discriminator is prefixed with `sim:`; the Worker's dispatcher routes on
// that prefix and everything else stays on the frozen AGC path.

import type {
  CommandAck,
  MissionCommand,
  MissionRuntimeStatus,
  MissionSnapshot,
  TerminalTouchdownEvent,
} from "@/simulation/runtime/types";

export const SIMULATION_PROTOCOL_VERSION = 1 as const;

/** Structural-clone-safe wire form: MissionCommand is already all
 *  primitives + a plain LmScenarioDefinition (numbers/strings/booleans). */
export type SimulationCommand =
  | { type: "sim:enqueue"; command: MissionCommand }
  | { type: "sim:queryReady" }
  | { type: "sim:forceSnapshot" };

export interface SimReadyPayload {
  simulationProtocolVersion: typeof SIMULATION_PROTOCOL_VERSION;
  simulationEpoch: number;
  missionTickUs: number;
  status: MissionRuntimeStatus;
}

export type SimulationEvent =
  | { type: "sim:ready"; payload: SimReadyPayload }
  | { type: "sim:snapshot"; payload: MissionSnapshot }
  | { type: "sim:commandAck"; payload: CommandAck }
  | { type: "sim:terminalTouchdown"; payload: TerminalTouchdownEvent };

export function isSimulationMessage(msg: { type: string } | null | undefined): boolean {
  return !!msg && typeof msg.type === "string" && msg.type.startsWith("sim:");
}
