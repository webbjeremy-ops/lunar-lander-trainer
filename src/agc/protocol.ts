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
  | { type: "requestEventBoundary" }
  | { type: "requestEventLogExport" }
  | { type: "configure"; erasableBase?: number; erasableLength?: number }
  | { type: "dispose" };

/** ---------- Event-log export (Worker → client reply) --------------------
 *  Deterministic snapshot of the current public epoch: the baseline captured
 *  at the moment public event IDs began (post-canonical-init) plus every
 *  retained public event since. The main-thread `buildEventLogExport` helper
 *  wraps this raw payload into the versioned file schema. */
export interface PublicInputRecord {
  type: "inputAccepted";
  eventId: number;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  kind: "dskyKeyDown" | "dskyKeyUp" | "proceedKey";
  keyCode?: number;
  pressed?: boolean;
}

export interface PublicChannelRecord {
  type: "channelUpdate";
  eventId: number;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  channel: number;
  value: number;
}

export type PublicEventRecord = PublicInputRecord | PublicChannelRecord;

export interface EventLogExportPayload {
  sessionEpoch: number;
  timing: {
    /** Nanoseconds per AGC step (11720 ns nominal). */
    nominalStepNs: number;
    /** Scheduler tick period in microseconds. */
    schedulerTickUs: number;
  };
  baseline: {
    tickIndex: number;
    missionTimeUs: number;
    totalAgcSteps: number;
    decodedDsky: DecodedDsky;
    decodedDskyChecksum: string;
    channelValues: Record<string, number>;
  };
  events: PublicEventRecord[];
  retention: {
    /** True iff no events have been dropped from the head of the ring. */
    completeEpoch: boolean;
    /** eventId of the oldest retained event when completeEpoch is false. */
    droppedBeforeEventId: number | null;
    /** Configured ring capacity; null if unbounded. */
    retainedEventLimit: number | null;
  };
}

/**
 * Worker-allocated attempt boundary. The `boundaryEventId` is drawn from the
 * SAME monotonic counter used by inputAccepted/channelUpdate events. Every
 * accepted input and every channel event emitted after this reply will have
 * eventId > boundaryEventId. Lesson attempts open on the boundary, so any
 * stale evidence carrying an id <= boundaryEventId falls out of scope.
 */
export interface EventBoundaryPayload {
  boundaryEventId: number;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  /**
   * Full latched DSKY state as of the boundary allocation. Structurally
   * cloned across the postMessage boundary, so the client owns the value.
   * Lesson observers seed their shadow decoders from this baseline so the
   * shadow reflects EXACTLY what the AGC had emitted through boundaryEventId
   * — any subsequent channel event with id > boundaryEventId can be applied
   * to it losslessly without a snapshot round-trip.
   */
  decodedDsky: DecodedDsky;
  /** Canonical checksum of decodedDsky at the boundary. */
  decodedDskyChecksum: string;
}

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
  /**
   * Highest eventId allocated so far (inputs + channels + boundaries share
   * this counter). Snapshot readers use this to reason about the global
   * ordering namespace; it is NOT the same as `channelEventCount`.
   */
  latestEventId: number;
  /** Full latched DSKY state; deterministic replay compares against this. */
  decodedDsky: DecodedDsky;
}


/**
 * Canonical initialization outcome. Reports the Worker-driven post-reset
 * DSKY RSET startup sequence that runs before every public `ready`:
 *   1. cpu_reset() (exactly once per epoch).
 *   2. AGC scheduler starts privately (public input disabled).
 *   3. Observe initial RESTART assertion + AGC step advance.
 *   4. Send RSET (keycode 0o22) through the authentic DSKY input path.
 *   5. Observe RESTART clear from the emulator's own channel output.
 *   6. Run the 20-tick activity-filtered quiet-state gate.
 *   7. Publish public ready.
 *
 * The startup RSET is a simulator startup convention — not a claim that
 * the AGC pressed its own key. It is NOT another cpu_reset() and does NOT
 * silently mutate any channel or decoded value.
 */
export interface CanonicalInitInfo {
  cpuResetPerformed: boolean;
  cpuResetCount: number;
  startupRsetSent: boolean;
  /** Fixed at 0o22 (decimal 18) — the AGC RSET key code. */
  startupRsetCode: number;
  startupRsetAccepted: boolean;
  startupRsetCount: number;
  restartObservedBeforeRset: boolean;
  restartClearedAfterRset: boolean;
  /** Mission tick index at which the quiet-window gate declared settled. */
  settledAtTick: number;
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
  /** Canonical initialization invariant: the Worker performed exactly
   *  one cpu_reset() after rope load and before this ready message.
   *  Always true — a false value here would be a bug. */
  initialResetPerformed: true;
  /** Number of cpu_reset() calls performed by the Worker during this
   *  session (from initialization + any explicit `reset` commands). At
   *  `ready` time this is exactly 1. */
  resetCount: number;
  /** Session epoch. 0 at initialization; each explicit `reset` bumps it. */
  sessionEpoch: number;
  /** Canonical startup RSET sequence outcome. Public input is only enabled
   *  after this sequence completes. */
  canonicalInit: CanonicalInitInfo;
  /** M3.3A2-P4: identity of the extended runtime the Worker loaded.
   *  Absent only in test contexts that instantiate the frozen artifact. */
  extensionIdentity?: {
    hwioVersion: number;
    extVersion: string;
    extensionTag: string;
    /** 0 in production — canonical runtime is dormant by default. */
    traceEnabled: number;
    /** 0 in production — no whitelisted deltas are ever observed while
     *  tracing remains disabled. */
    traceDropped: number;
  };
}

export interface Diagnostics {
  crossOriginIsolated: boolean;
  avgTickMs: number;
  maxTickMs: number;
  schedulerOverruns: number;
  ticksExecuted: number;
  lastError: string | null;
  workerState:
    | "idle"
    | "initializing"
    | "loading-rope"
    | "canonical-init"
    | "ready"
    | "paused"
    | "error";
  initialResetPerformed: boolean;
  resetCount: number;
  sessionEpoch: number;
  canonicalInit: CanonicalInitInfo | null;
  /** M3.3A2-P4: extension identity reported by the loaded WASM. */
  extensionIdentity?: ReadyPayload["extensionIdentity"];
}

export type AgcEvent =
  | { type: "ready"; payload: ReadyPayload }
  | { type: "stateSnapshot"; payload: StateSnapshot }
  | { type: "dskyUpdate"; payload: { lamps: number; missionTimeUs: number } }
  | { type: "dskyDecoded"; payload: { decoded: DecodedDsky; missionTimeUs: number; tickIndex: number } }
  | { type: "channelUpdate"; payload: ChannelEventLite }
  | { type: "inputAccepted"; payload: InputAcceptedEvent }
  | { type: "eventBoundary"; payload: EventBoundaryPayload }
  | { type: "eventLogExport"; payload: EventLogExportPayload }
  | { type: "alarm"; payload: { code: number; missionTimeUs: number; eventId: number; tickIndex: number } }
  | { type: "paused"; payload: { missionTimeUs: number } }
  | { type: "resumed"; payload: { missionTimeUs: number; timeScale: number } }
  | { type: "diagnostics"; payload: Diagnostics }
  | { type: "fatalError"; payload: { code: string; message: string; detail?: unknown } }
  | { type: "performanceWarning"; payload: { message: string; overrunMs: number } };

/**
 * Worker-echoed acknowledgement of an accepted user input. The eventId is
 * drawn from the SAME monotonic counter as channel events, so predicates can
 * compare `input.eventId` against subsequent `channelEvent.eventId` in a
 * single ordered namespace. Emitted exactly once per accepted press.
 */
export interface InputAcceptedEvent {
  eventId: number;
  tickIndex: number;
  missionTimeUs: number;
  kind: "dskyKeyDown" | "dskyKeyUp" | "proceedKey";
  keyCode?: number;
  pressed?: boolean;
}

export interface Envelope<TPayload> {
  protocol: typeof PROTOCOL_VERSION;
  dir: Direction;
  seq: number;
  requestId?: string;
  missionTimeUs?: number;
  message: TPayload;
}

import type { SimulationCommand, SimulationEvent } from "./simulationProtocol";
// Widened to carry the M3.2 simulation namespace over the same channel.
// The AGC discriminated unions above are unchanged; sim messages are all
// prefixed `sim:` and dispatched by the Worker in a separate handler.
export type C2WEnvelope = Envelope<AgcCommand | SimulationCommand>;
export type W2CEnvelope = Envelope<AgcEvent | SimulationEvent>;

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
