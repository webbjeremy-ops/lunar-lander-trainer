// SPDX-License-Identifier: GPL-3.0-or-later
// Typed message protocol between the main thread (AgcWorkerClient) and the
// dedicated Worker (AgcWorker). Envelopes carry a `dir`-scoped monotonic
// sequence number; the client and worker each keep their own counter. Never
// share a global counter — the two threads run independently.

export const PROTOCOL_VERSION = 2 as const;

/** Time-scale presets exposed to the UI. Zero pauses the mission clock. */
export const TIME_SCALES = [0, 0.25, 0.5, 1, 2, 4, 8] as const;
export type TimeScale = (typeof TIME_SCALES)[number] | number;

import type { DecodedDsky } from "./dsky/DskyTypes";
export type { DecodedDsky };

export type RopeId = "Luminary099" | "Comanche055";

/** Direction of the envelope: c2w = client→worker, w2c = worker→client. */
export type Direction = "c2w" | "w2c";

export type AgcCommand =
  | { type: "initialize"; wasmUrl: string }
  | { type: "loadRope"; ropeId: RopeId; ropeUrl: string; manifestUrl: string }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume"; timeScale?: number }
  | { type: "reset" }
  | { type: "setTimeScale"; timeScale: number }
  | { type: "dskyKeyDown"; keyCode: number }
  | { type: "dskyKeyUp"; keyCode: number }
  | { type: "proceedKey"; pressed: boolean }
  | { type: "stepSimulation"; ticks?: number }
  | { type: "stepAgcDebug"; steps: number }
  | { type: "requestSnapshot" }
  | { type: "requestDiagnostics" }
  | { type: "configure"; erasableBase?: number; erasableLength?: number }
  | { type: "dispose" };

export interface ChannelEventLite {
  /** Monotonic per-worker id assigned at the moment of AGC OUTPUT. */
  eventId: number;
  /** Completed mission ticks at the moment the event was emitted. */
  tickIndex: number;
  channel: number;
  value: number;
  seq: number;
  missionTimeUs: number;
}

export interface StateSnapshot {
  version: number; // snapshot schema version
  missionTimeUs: number;
  timingRemainderNs: number;
  totalAgcSteps: number;
  timeScale: number;
  running: boolean;
  lamps: number;
  channels: Record<number, number>;
  channelEventCount: number;
  recentEvents: ChannelEventLite[];
  erasableBase: number;
  erasableWindow: number[];
  avgTickMs: number;
  schedulerOverruns: number;
  tickIndex: number;
  /** Full latched DSKY state; deterministic replay compares against this. */
  decodedDsky: DecodedDsky;
}


export interface ReadyPayload {
  emulatorRepo: string;
  emulatorCommit: string;
  emulatorVersionString: string;
  ropeId: RopeId;
  ropeSha256: string;
  ropeSourceCommit: string;
  ropeByteLength: number;
  wasmSha256: string;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface Diagnostics {
  crossOriginIsolated: boolean;
  avgTickMs: number;
  maxTickMs: number;
  schedulerOverruns: number;
  ticksExecuted: number;
  lastError: string | null;
  workerState: "idle" | "initializing" | "loading-rope" | "ready" | "paused" | "error";
}

export type AgcEvent =
  | { type: "ready"; payload: ReadyPayload }
  | { type: "stateSnapshot"; payload: StateSnapshot }
  | { type: "dskyUpdate"; payload: { lamps: number; missionTimeUs: number } }
  | { type: "dskyDecoded"; payload: { decoded: DecodedDsky; missionTimeUs: number; tickIndex: number } }
  | { type: "channelUpdate"; payload: ChannelEventLite }
  | { type: "alarm"; payload: { code: number; missionTimeUs: number; eventId: number; tickIndex: number } }
  | { type: "paused"; payload: { missionTimeUs: number } }
  | { type: "resumed"; payload: { missionTimeUs: number; timeScale: number } }
  | { type: "diagnostics"; payload: Diagnostics }
  | { type: "fatalError"; payload: { code: string; message: string; detail?: unknown } }
  | { type: "performanceWarning"; payload: { message: string; overrunMs: number } };

export interface Envelope<TPayload> {
  protocol: typeof PROTOCOL_VERSION;
  dir: Direction;
  seq: number;
  requestId?: string;
  missionTimeUs?: number;
  message: TPayload;
}

export type C2WEnvelope = Envelope<AgcCommand>;
export type W2CEnvelope = Envelope<AgcEvent>;

export function makeEnvelope<T>(
  dir: Direction,
  seq: number,
  message: T,
  extras: { requestId?: string; missionTimeUs?: number } = {},
): Envelope<T> {
  return {
    protocol: PROTOCOL_VERSION,
    dir,
    seq,
    message,
    ...(extras.requestId !== undefined ? { requestId: extras.requestId } : {}),
    ...(extras.missionTimeUs !== undefined ? { missionTimeUs: extras.missionTimeUs } : {}),
  };
}
