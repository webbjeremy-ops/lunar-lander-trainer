// SPDX-License-Identifier: GPL-3.0-or-later
// Dedicated Web Worker that owns the AgcCoreAdapter, MissionClock, EventLog,
// and snapshot coalescer. UI code MUST NOT import this file directly — it is
// instantiated by AgcWorkerClient via new Worker(new URL('./AgcWorker.ts',
// import.meta.url), { type: 'module' }).
//
// No SharedArrayBuffer / Atomics use. Runs identically when
// crossOriginIsolated === false.

/// <reference lib="webworker" />

import { AgcCoreAdapter, type AgcIncTypeName } from "@/sim/agc/AgcCoreAdapter";
import { CANONICAL_AGC_RUNTIME } from "./AgcRuntimeManifest";
import { MissionClock, TICK_MICROS } from "./MissionClock";
const SCHEDULER_TICK_MICROS = Number(TICK_MICROS);
import { SnapshotCoalescer } from "./SnapshotCoalescer";
import { EventLog } from "./EventLog";
import {
  applyDskyChannelEvent,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "./dsky/DskyDecoder";
import type { DecodedDsky } from "./dsky/DskyTypes";

/** The exact source revision of michaelfranzl/virtualagc that produced the
 *  vendored yaAGC.wasm shipped by michaelfranzl/webAGC @ 0575ea7. The
 *  emulator's version() export embeds a short prefix of this hash. */
export const EXPECTED_YAAGC_SOURCE_COMMIT =
  "ddc65e7bed41f1301921b934fcbaaee93db99dda";
export const EXPECTED_YAAGC_VERSION_SUBSTRING = "ddc65e7b";
import {
  PROTOCOL_VERSION,
  makeEnvelope,
  type AgcCommand,
  type AgcEvent,
  type C2WEnvelope,
  type CanonicalInitInfo,
  type ChannelEventLite,
  type Diagnostics,
  type EventLogExportPayload,
  type PublicEventRecord,
  type ReadyPayload,
  type StateSnapshot,
  type W2CEnvelope,
} from "./protocol";
import {
  readinessProjectionCanonical,
} from "@/lessons/ReadinessTracker";
import { V35_READINESS_QUIET_TICKS } from "@/lessons/fixtureExpectations";
import { AGC_KEY } from "@/lessons/keyCodes";
import { MissionRuntime, MISSION_TICK_US } from "@/simulation/runtime/MissionRuntime";
import type { MissionSnapshot } from "@/simulation/runtime/types";
import {
  SIMULATION_PROTOCOL_VERSION,
  SUPPORTED_MONITOR_PROFILES,
  type SetMonitorProfileCommand,
  type SimulationCommand,
  type SimulationEvent,
} from "./simulationProtocol";
// ---- M3.3A2-P5.d monitor mode ------------------------------------------
// The Worker owns ALL monitor state. React receives compact snapshots only.
import { MonitorController, type MonitorHwPort } from "@/simulation/agcio/MonitorController";
import { validateSetMonitorProfileCommand } from "@/simulation/agcio/profileValidation";
import { EXPECTED_ACTUATOR_CHANNELS } from "@/simulation/agcio/actuatorRegistry";
import { MONITOR_TRACE_CAPACITY } from "@/simulation/agcio/monitorTrace";
import { applyFixedAttitudeImuBootstrapV1 } from "@/simulation/agcio/bootstrapTransaction";
import { LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 } from "@/simulation/agcio/padLoadManifest";
import type { LmDiscreteSensorState } from "@/simulation/agcio/discreteEncoder";
import type {
  AgcOutputChannelEvent,
  AgcOutputCounterEvent,
} from "@/simulation/agcio/types";

const SNAPSHOT_SCHEMA_VERSION = 1;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let outSeq = 0;

/**
 * ============================================================================
 *  ⚠  PRE-READY EVENT SUPPRESSION — MAINTENANCE-CRITICAL LIST  ⚠
 * ============================================================================
 *  Every AGC output that could carry visible session state MUST appear here
 *  until the dispatcher is inverted to an allowlist / bypass-flag model
 *  (see `send()` below and the M2.2 review action item).
 *
 *  Rationale: while the Worker runs the canonical startup RSET-and-settle
 *  sequence, `publicPhaseStarted === false`. Anything that leaks in this
 *  window pollutes the public event-id namespace, exposes the system-
 *  generated RSET keypress as if the astronaut pressed it, or makes boot
 *  DSKY transients look like fresh channel activity to lesson observers.
 *
 *  If you add a NEW `AgcEvent` variant that carries emulator output
 *  (channel writes, DSKY updates, input echoes, snapshots, alarms, etc.)
 *  you MUST add its `type` to this set. If you deliberately want the
 *  event to publish during canonical init (e.g. `fatalError`,
 *  `performanceWarning`, `diagnostics`, `ready`) leave it out — those are
 *  the only categories currently intended to bypass suppression.
 *
 *  TODO(M2.3): replace this blocklist with an explicit per-event
 *  `bypassInitialSuppression` flag enforced at `send()` so new emitters
 *  fail closed instead of open.
 * ============================================================================
 */
const PRE_READY_SUPPRESSED_EVENTS: ReadonlySet<AgcEvent["type"]> = new Set([
  "channelUpdate",
  "inputAccepted",
  "dskyUpdate",
  "dskyDecoded",
  "stateSnapshot",
  "eventBoundary",
  "alarm",
  "paused",
  "resumed",
]);


function send(message: AgcEvent, requestId?: string, missionTimeUs?: number): void {
  if (!state.publicPhaseStarted && PRE_READY_SUPPRESSED_EVENTS.has(message.type)) {
    return;
  }
  const env: W2CEnvelope = makeEnvelope("w2c", ++outSeq, message, {
    requestId,
    missionTimeUs,
  });
  ctx.postMessage(env);
}

/** Dedicated dispatcher for M3.2 simulation events. Distinct from `send()`
 *  because sim events are never subject to the pre-ready canonical-init
 *  suppression list — the sim runtime publishes independently. */
function sendSimEvent(message: SimulationEvent, requestId?: string): void {
  const env: W2CEnvelope = makeEnvelope("w2c", ++outSeq, message, { requestId });
  ctx.postMessage(env);
}

function sendSimReady(requestId?: string): void {
  state.simReadyPublished = true;
  sendSimEvent(
    {
      type: "sim:ready",
      payload: {
        simulationProtocolVersion: SIMULATION_PROTOCOL_VERSION,
        simulationEpoch: state.missionRuntime.getSimulationEpoch(),
        missionTickUs: MISSION_TICK_US,
        status: state.missionRuntime.getStatus(),
        // STATIC capability advertisement only. Mutable monitor state
        // (current profile / status / block reasons) never rides on
        // sim:ready — it lives on mission snapshots.
        supportedMonitorProfiles: SUPPORTED_MONITOR_PROFILES,
      },
    },
    requestId,
  );
}

interface WorkerState {
  adapter: AgcCoreAdapter | null;
  clock: MissionClock;
  events: EventLog;
  coalescer: SnapshotCoalescer<StateSnapshot>;
  schedulerHandle: ReturnType<typeof setInterval> | null;
  erasableBase: number;
  erasableLength: number;
  wasmSha256: string;
  ropeSha256: string;
  ropeId: "Luminary099" | "Comanche055" | null;
  ropeSourceCommit: string;
  ropeByteLength: number;
  emulatorVersion: string;
  extensionIdentity: Diagnostics["extensionIdentity"] | undefined;
  lastError: string | null;
  workerState: Diagnostics["workerState"];
  disposed: boolean;
  lastLamps: number;
  lastChannelEventCount: number;
  decodedDsky: DecodedDsky;
  nextEventId: number;
  /** Worker-owned bounded ring of ChannelEventLite that preserves each
   *  event's ORIGINAL eventId / tickIndex / missionTimeUs. Snapshots read
   *  from here instead of re-deriving context from the current clock. */
  recentEventsRing: ChannelEventLite[];
  recentEventsCap: number;
  /** Bounded ring of PUBLIC events (inputAccepted + channelUpdate) since
   *  the current epoch's `ready`. Used exclusively for event-log export.
   *  Distinct from `recentEventsRing` (channel-only, snapshot-facing). */
  publicEventsRing: PublicEventRecord[];
  publicEventsCap: number;
  /** Total number of public events APPENDED to the ring this epoch
   *  (including any that have since been dropped from the head). */
  publicEventsAppendedTotal: number;
  /** Epoch-start baseline captured at publishReady. Null before ready and
   *  between reset and the next ready. */
  epochStartBaseline: {
    tickIndex: number;
    missionTimeUs: number;
    totalAgcSteps: number;
    decodedDsky: DecodedDsky;
    decodedDskyChecksum: string;
    channelValues: Record<string, number>;
  } | null;
  /** Canonical-initialization invariant tracking. `initialResetPerformed`
   *  flips true when the single `loadRope` handler completes its one and
   *  only cpu_reset(); `resetCount` increments on every adapter.reset()
   *  regardless of source, so tests can assert exactly one call for a
   *  session unless the user requested an explicit later reset. */
  initialResetPerformed: boolean;
  resetCount: number;
  /** Session epoch. Starts at 0; every explicit `reset` command bumps it.
   *  The initialization reset itself does NOT bump the epoch — it happens
   *  before the public session becomes usable. */
  sessionEpoch: number;
  /** Canonical-initialization gate. While false, no channel/input/dsky/
   *  snapshot events reach the client; the Worker is running its post-
   *  reset RSET-and-settle sequence privately. `ready` publish flips it
   *  to true, at which point public event IDs restart from 1. */
  publicPhaseStarted: boolean;
  canonicalInit: CanonicalInitState;
  // ---- M3.2 mission runtime (deterministic sim coordinator) ----------
  missionRuntime: MissionRuntime;
  missionCoalescer: SnapshotCoalescer<MissionSnapshot>;
  lastPublishedSimSnapshot: MissionSnapshot | null;
  simReadyPublished: boolean;
  // ---- M3.3A2-P5.d monitor mode (Worker-owned authoritative state) ----
  /** Null until `initialize` creates the adapter. */
  monitor: MonitorController | null;
  /** Operator-declared avionics discretes. NEVER invented by the Worker;
   *  monitor entry is blocked until a complete state is supplied. */
  avionics: LmDiscreteSensorState | null;
  /** Epoch-bound, tick-aligned profile commands awaiting their boundary. */
  monitorCommandQueue: SetMonitorProfileCommand[];
  /** Lossless CHAN11/CHAN14 output events captured during the CURRENT AGC
   *  interval. Cleared at the start of every mission tick. */
  tickChannelEvents: AgcOutputChannelEvent[];
  /** M3.3E: lossless CHAN13 output writes captured during the CURRENT AGC
   *  interval. These are the ONLY trigger for a landing-radar transaction —
   *  there is no host-side radar timer anywhere in the lab. */
  tickChan13Writes: Chan13Write[];

  /** Monotonic pseudo-sequence for lossless channel observations. The
   *  packet path exposes no AGC cycle counter, so ordering (not absolute
   *  cycle) is what is preserved — documented in docs/M3_3A2_P5.md. */
  channelObservationSeq: number;
  /** M3.3C Phase 4B: AGC epoch in which the fixed-attitude IMU bootstrap was
   *  installed and verified. Null until installed; invalidated by any AGC
   *  reset because `sessionEpoch` advances. */
  imuBootstrapAgcEpoch: number | null;
}

type CanonicalInitPhase =
  | "await-agc-active"
  | "await-rset-send"
  | "await-restart-clear"
  | "quiet-window"
  | "settled";

interface CanonicalInitTraceEntry {
  kind:
    | "cpuReset"
    | "restartObserved"
    | "startupRsetSent"
    | "restartCleared"
    | "settled";
  tickIndex: number;
  missionTimeUs: number;
  note?: string;
}

interface CanonicalInitState {
  phase: CanonicalInitPhase;
  cpuResetPerformed: boolean;
  cpuResetCount: number;
  startupRsetSent: boolean;
  startupRsetCode: number;
  startupRsetAccepted: boolean;
  startupRsetCount: number;
  restartObservedBeforeRset: boolean;
  restartClearedAfterRset: boolean;
  settledAtTick: number | null;
  stepsAtReset: number;
  ticksAtReset: number;
  quietWindowSeedTick: number;
  quietWindowSeedSteps: number;
  quietWindowSeedProjection: string;
  trace: CanonicalInitTraceEntry[];
}

function makeCanonicalInitState(
  cpuResetCount: number,
  stepsAtReset: number,
  ticksAtReset: number,
  missionTimeUs: number,
): CanonicalInitState {
  return {
    phase: "await-agc-active",
    cpuResetPerformed: true,
    cpuResetCount,
    startupRsetSent: false,
    startupRsetCode: AGC_KEY.RSET,
    startupRsetAccepted: false,
    startupRsetCount: 0,
    restartObservedBeforeRset: false,
    restartClearedAfterRset: false,
    settledAtTick: null,
    stepsAtReset,
    ticksAtReset,
    quietWindowSeedTick: -1,
    quietWindowSeedSteps: -1,
    quietWindowSeedProjection: "",
    trace: [{ kind: "cpuReset", tickIndex: ticksAtReset, missionTimeUs }],
  };
}

function canonicalInitInfo(ci: CanonicalInitState): CanonicalInitInfo {
  return {
    cpuResetPerformed: ci.cpuResetPerformed,
    cpuResetCount: ci.cpuResetCount,
    startupRsetSent: ci.startupRsetSent,
    startupRsetCode: ci.startupRsetCode,
    startupRsetAccepted: ci.startupRsetAccepted,
    startupRsetCount: ci.startupRsetCount,
    restartObservedBeforeRset: ci.restartObservedBeforeRset,
    restartClearedAfterRset: ci.restartClearedAfterRset,
    settledAtTick: ci.settledAtTick ?? -1,
  };
}


const state: WorkerState = {
  adapter: null,
  clock: new MissionClock({
    onPerformanceWarning: (message, overrunMs) =>
      send({ type: "performanceWarning", payload: { message, overrunMs } }),
  }),
  events: new EventLog(0xC0DE_A11E >>> 0),
  coalescer: new SnapshotCoalescer<StateSnapshot>({
    minIntervalMs: 40,
    publish: (snap) => send({ type: "stateSnapshot", payload: snap }),
  }),
  schedulerHandle: null,
  erasableBase: 0o20,
  erasableLength: 16,
  wasmSha256: "",
  ropeSha256: "",
  ropeId: null,
  ropeSourceCommit: "",
  ropeByteLength: 0,
  emulatorVersion: "",
  extensionIdentity: undefined,
  lastError: null,
  workerState: "idle",
  disposed: false,
  lastLamps: 0,
  lastChannelEventCount: 0,
  decodedDsky: makeEmptyDecodedDsky(),
  nextEventId: 1,
  recentEventsRing: [],
  recentEventsCap: 64,
  publicEventsRing: [],
  publicEventsCap: 32768,
  publicEventsAppendedTotal: 0,
  epochStartBaseline: null,
  initialResetPerformed: false,
  resetCount: 0,
  sessionEpoch: 0,
  publicPhaseStarted: false,
  canonicalInit: makeCanonicalInitState(0, 0, 0, 0),
  missionRuntime: new MissionRuntime(),
  missionCoalescer: new SnapshotCoalescer<MissionSnapshot>({
    minIntervalMs: 40,
    publish: (snap) => {
      state.lastPublishedSimSnapshot = snap;
      sendSimEvent({ type: "sim:snapshot", payload: snap });
    },
  }),
  lastPublishedSimSnapshot: null,
  simReadyPublished: false,
  monitor: null,
  avionics: null,
  monitorCommandQueue: [],
  imuBootstrapAgcEpoch: null,
  tickChannelEvents: [],
  channelObservationSeq: 0,
};

/** Adapter-backed HW-I/O port for the monitor controller. Every emulator
 *  touch the monitor makes goes through here, so the controller itself
 *  stays WASM-free and unit-testable. */
function makeMonitorPort(): MonitorHwPort {
  return {
    hwioVersion: () => state.adapter?.hwioVersion() ?? 0,
    traceEnabled: () => state.adapter?.traceEnabled() ?? false,
    setTraceEnabled: (enabled) => state.adapter?.setTraceEnabled(enabled),
    resetTrace: () => state.adapter?.resetTrace(),
    traceDropped: () => state.adapter?.traceDropped() ?? 0,
    drainTrace: (): readonly AgcOutputCounterEvent[] => {
      const records = state.adapter?.drainTrace() ?? [];
      return records.map((r) => ({
        stream: "counter" as const,
        sequence: { hi: r.sequence.hi, lo: r.sequence.lo },
        cycle: { hi: r.cycle.hi, lo: r.cycle.lo },
        address: r.address,
        operation: r.operation,
        delta: r.delta,
        valueBefore: r.valueBefore,
        valueAfter: r.valueAfter,
      }));
    },
    writeInputChannel: (channel, word) => {
      // Authentic frozen host-input path — a COMPLETE word, never a mask.
      state.adapter?.writeIo(channel, word);
    },
    // ---- M3.3E synthetic hardware-interface lab -------------------------
    applyCounterPulses: (records) => {
      const adapter = state.adapter;
      if (!adapter || !adapter.hwInputSupported() || records.length === 0) return false;
      const result = adapter.applyHwInput(
        records.map((r) => ({
          counterAddress: r.counterAddress,
          incType: r.incType as AgcIncTypeName,
          pulseCount: r.pulseCount,
          suborder: r.suborder,
        })),
      );
      return result.ok;
    },

    applyLandingRadarUpdate: (word, bitCount, raiseRadarupt) => {
      const adapter = state.adapter;
      if (!adapter) return false;
      return adapter.applyLandingRadarUpdate(word, bitCount, raiseRadarupt) === 0;
    },
  };
}


/** Record a host input write in the authoritative shadow. Called for EVERY
 *  accepted host→AGC packet (DSKY keys, PROCEED, monitor discretes) so the
 *  shadow can never drift from the emulator. */
function recordHostInput(channel: number, word: number): void {
  state.monitor?.inputShadow().write(channel, word);
}

/** Trace of pre-ready initialization traces retained across sessions for
 *  diagnostics. Never emitted publicly; exposed via `requestDiagnostics`
 *  in a follow-up if needed. Kept bounded. */
const initTraceHistory: Array<{
  sessionEpoch: number;
  entries: CanonicalInitTraceEntry[];
}> = [];

function currentTickIndex(): number {
  return state.clock.stats().ticksExecuted;
}

async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Copy into a fresh ArrayBuffer so the WebCrypto types are unambiguous
  // (crypto.subtle.digest rejects SharedArrayBuffer-backed views).
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Append a public event to the export ring, evicting the oldest entry
 *  when the ring is at capacity. `publicEventsAppendedTotal` counts every
 *  append (including dropped ones), so the current head's eventId
 *  reveals the drop boundary. */
function appendPublicEvent(rec: PublicEventRecord): void {
  state.publicEventsRing.push(rec);
  state.publicEventsAppendedTotal++;
  if (state.publicEventsRing.length > state.publicEventsCap) {
    state.publicEventsRing.splice(0, state.publicEventsRing.length - state.publicEventsCap);
  }
}




/** Deterministic snapshot of every AGC channel the adapter has observed.
 *  Keys are decimal-encoded channel numbers as strings; values are
 *  canonical numbers. Uses `io.allChannels()` when the private accessor
 *  is available and falls back to the DSKY-relevant channel list. */
function snapshotAllChannels(adapter: AgcCoreAdapter): Record<string, number> {
  const out: Record<string, number> = {};
  const anyAdapter = adapter as unknown as {
    io?: { allChannels(): ReadonlyMap<number, number> };
  };
  if (anyAdapter.io && typeof anyAdapter.io.allChannels === "function") {
    for (const [c, v] of anyAdapter.io.allChannels().entries()) {
      out[String(c)] = v;
    }
    return out;
  }
  const KNOWN = [0o10, 0o11, 0o13, 0o15, 0o30, 0o31, 0o32, 0o33, 0o163];
  for (const c of KNOWN) out[String(c)] = adapter.channel(c);
  return out;
}



function buildSnapshot(): StateSnapshot {
  const adapter = state.adapter;
  if (!adapter) {
    return {
      version: SNAPSHOT_SCHEMA_VERSION,
      missionTimeUs: 0,
      timingRemainderNs: 0,
      totalAgcSteps: 0,
      timeScale: state.clock.getTimeScale(),
      running: !state.clock.isPaused(),
      lamps: 0,
      channels: {},
      channelEventCount: 0,
      recentEvents: [],
      erasableBase: state.erasableBase,
      erasableWindow: [],
      avgTickMs: 0,
      schedulerOverruns: 0,
      tickIndex: 0,
      latestEventId: state.nextEventId - 1,
      decodedDsky: state.decodedDsky,
    };
  }
  const snap = snapshotAllChannels(adapter);
  const channels: Record<number, number> = {};
  for (const key of Object.keys(snap)) channels[Number(key)] = snap[key];
  const era = adapter.erasable();
  const window: number[] = new Array(state.erasableLength);
  for (let i = 0; i < state.erasableLength; i++) window[i] = era[state.erasableBase + i] ?? 0;
  // Read from the Worker-owned ring so each ChannelEventLite retains the
  // eventId, tickIndex, and missionTimeUs captured AT THE MOMENT the event
  // was emitted. Do NOT re-derive tick/time from the current clock here.
  const recentEvents: ChannelEventLite[] = state.recentEventsRing.slice(-24);
  const clockStats = state.clock.stats();
  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    missionTimeUs: Number(state.clock.getMissionTimeUs()),
    timingRemainderNs: state.clock.getTimingRemainderNs(),
    totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
    timeScale: state.clock.getTimeScale(),
    running: !state.clock.isPaused(),
    lamps: adapter.lampBits(),
    channels,
    channelEventCount: adapter.totalChannelEvents(),
    recentEvents,
    erasableBase: state.erasableBase,
    erasableWindow: window,
    avgTickMs: clockStats.avgTickMs,
    schedulerOverruns: clockStats.overruns,
    tickIndex: clockStats.ticksExecuted,
    latestEventId: state.nextEventId - 1,
    decodedDsky: state.decodedDsky,
  };
}

/**
 * The single mission-tick pipeline. Called ONCE per 20 000 µs MissionClock
 * tick from every code path that advances mission time (scheduler wake AND
 * `stepSimulation`). Enforces the M3.3A2-P5.d phase order EXACTLY:
 *
 *   1.  apply queued mission + monitor-profile commands
 *   2.  sample LM + explicit avionics state at tick start
 *   3.  purely encode all due sensor actions
 *   4.  validate the COMPLETE action set before applying anything
 *   5.  apply channel-mask updates in suborder through the input shadow
 *   6.  advance the AGC by exactly one normal 20 ms mission tick
 *   7.  drain the WASM output-counter trace EXACTLY once
 *   8.  collect lossless CHAN11/CHAN14 events from that AGC interval
 *   9.  run the pure actuator decoder
 *   10. append bounded monitor diagnostics
 *   11. advance physics using BRANDED scenario/manual control only
 *   12. latch touchdown and publish compact snapshots
 *
 * Phases 2–5 and 7–10 are inert while the monitor profile is `off`, which
 * is the production default; the resulting physics trace is bit-identical
 * to the frozen M3.2 result either way.
 *
 * ORDERING CAVEAT (documented, not papered over): `packet_write` host
 * inputs and immediate non-CDU counter calls do NOT provide a proven
 * sub-instruction total ordering inside one AGC interval. P5 therefore
 * emits channel-mask sensor actions only, keeps the channel and counter
 * OUTPUT streams distinct, and never fabricates a cross-stream sub-cycle
 * order.
 *
 * NOTE on timing: MissionClock.executeTick increments missionTimeUs BEFORE
 * calling this callback and increments ticksExecuted AFTER it returns. So
 * inside this function, getMissionTimeUs() is the END of the tick and
 * stats().ticksExecuted is the index of the tick being executed (0-based).
 */
function runMissionTickPipeline(steps: number): void {
  const adapter = state.adapter;
  if (!adapter) return;
  const tickEndUs = Number(state.clock.getMissionTimeUs());
  const tickStartUs = tickEndUs - MISSION_TICK_US;
  const tickIndex = state.clock.stats().ticksExecuted;
  // ---- Phase 1: mission commands due at this tick's start boundary ----
  const rejections = state.missionRuntime.applyBoundaryCommands(tickStartUs);
  for (const rej of rejections) {
    sendSimEvent({ type: "sim:commandAck", payload: rej });
  }
  // A scenario reset bumps the simulation epoch: monitoring disarms and
  // must be re-entered explicitly against the new epoch.
  const epochNow = state.missionRuntime.getSimulationEpoch();
  if (state.monitor && state.monitor.facts().simulationEpoch !== epochNow &&
      state.monitor.isActive()) {
    state.monitor.onSimulationEpochChanged(epochNow);
    state.avionics = null;
    state.monitorCommandQueue.length = 0;
  }
  // ---- Phase 1 (cont.): monitor-profile commands, same boundary rule ----
  applyDueMonitorCommands(tickStartUs);

  const monitor = state.monitor;
  // ---- Phases 2-5: sample -> encode -> validate -> apply ---------------
  if (monitor?.isActive()) {
    state.tickChannelEvents = [];
    monitor.preAgcTick({
      missionTick: tickIndex,
      missionTimeUs: tickStartUs,
      avionics: state.avionics,
    });
  }

  // ---- Phase 6: AGC, exactly one normal mission tick -------------------
  adapter.stepCpu(steps);
  adapter.drainIo();

  // ---- Phases 7-10: drain once, decode, retain bounded diagnostics -----
  if (monitor?.isActive()) {
    monitor.postAgcTick(tickIndex, tickEndUs, state.tickChannelEvents);
    state.tickChannelEvents = [];
  }

  // ---- Phases 11 + 12: physics (branded control only) + terminal -------
  const terminal = state.missionRuntime.advancePhysics(tickStartUs, tickIndex);
  if (terminal) {
    // A terminal state disarms monitoring; it never re-arms implicitly.
    monitor?.onTerminalState();
    sendSimEvent({ type: "sim:terminalTouchdown", payload: terminal });
  }
  // Compact sim snapshot (gated on sim:ready, same as AGC public gate).
  if (state.simReadyPublished) {
    const snap = state.missionRuntime.snapshot(
      tickIndex,
      tickEndUs,
      state.clock.isPaused(),
      monitorSnapshot(tickIndex),
    );
    state.missionCoalescer.offer(snap);
  }
}

/** Compact monitor snapshot, or null when the monitor has never been used
 *  (keeps frozen-shaped snapshots for pure-M3.2 sessions). */
function monitorSnapshot(tickIndex: number) {
  const monitor = state.monitor;
  if (!monitor) return null;
  const facts = monitor.facts();
  if (facts.profile === "off" && facts.status === "off" && facts.interlockReason === null) {
    return null;
  }
  return monitor.snapshot(tickIndex);
}

/** Apply every epoch-bound monitor-profile command whose tick boundary has
 *  arrived. Deterministic: drained in (applyAt, commandId) order. */
function applyDueMonitorCommands(tickStartUs: number): void {
  if (state.monitorCommandQueue.length === 0) return;
  state.monitorCommandQueue.sort((a, b) =>
    a.applyAtMissionTimeUs !== b.applyAtMissionTimeUs
      ? a.applyAtMissionTimeUs - b.applyAtMissionTimeUs
      : a.commandId - b.commandId,
  );
  const due: SetMonitorProfileCommand[] = [];
  while (
    state.monitorCommandQueue.length > 0 &&
    state.monitorCommandQueue[0].applyAtMissionTimeUs <= tickStartUs
  ) {
    due.push(state.monitorCommandQueue.shift()!);
  }
  for (const cmd of due) applyMonitorProfileCommand(cmd);
}

function applyMonitorProfileCommand(cmd: SetMonitorProfileCommand): void {
  const monitor = state.monitor;
  if (!monitor) return;
  const runtimeState = state.missionRuntime.getState();
  const result = monitor.requestProfile(
    cmd.profile,
    {
      simulationEpoch: state.missionRuntime.getSimulationEpoch(),
      agcSessionEpoch: state.sessionEpoch,
      agcReady: state.publicPhaseStarted,
      hwioVersion: state.adapter?.hwioVersion() ?? 0,
      ropeId: state.ropeId ?? "",
      ropeSha256: state.ropeSha256,
      runtimeStatus: runtimeState.status,
      activeScenarioId: runtimeState.scenarioId,
      traceCurrentlyEnabled: state.adapter?.traceEnabled() ?? false,
    },
    state.avionics,
  );
  if (result.outcome === "blocked") {
    sendSimEvent({
      type: "sim:monitor-blocked",
      commandId: cmd.commandId,
      simulationEpoch: state.missionRuntime.getSimulationEpoch(),
      requestedProfile: cmd.profile,
      reasons: result.reasons,
    });
    return;
  }
  sendSimEvent({
    type: "sim:commandAck",
    payload: { accepted: true, commandId: cmd.commandId },
  });
}

function startScheduler(): void {
  if (state.schedulerHandle !== null) return;
  // 20 ms scheduler wake. MissionClock decides how many ticks are due based
  // on wall-clock delta * time scale, bounded to prevent runaway catch-up.
  state.schedulerHandle = setInterval(() => {
    const adapter = state.adapter;
    if (!adapter || state.disposed) return;
    state.clock.advanceByWallClock(runMissionTickPipeline);
    onPostTick();
    state.coalescer.tick();
    state.missionCoalescer.tick();
  }, 20);
}

function stopScheduler(): void {
  if (state.schedulerHandle !== null) {
    clearInterval(state.schedulerHandle);
    state.schedulerHandle = null;
  }
}

function onPostTick(): void {
  const adapter = state.adapter;
  if (!adapter) return;
  // Canonical initialization pump runs BEFORE we publish any per-tick
  // event so that the tick which transitions us to `settled` also emits
  // the `ready` message, and the public-phase gate opens before the
  // dsky/decoded/snapshot fanout below.
  pumpCanonicalInit();
  const lamps = adapter.lampBits();
  const evCount = adapter.totalChannelEvents();
  if (lamps !== state.lastLamps) {
    state.lastLamps = lamps;
    // Critical event: bypass coalescer.
    send({ type: "dskyUpdate", payload: { lamps, missionTimeUs: Number(state.clock.getMissionTimeUs()) } });
  }
  if (evCount !== state.lastChannelEventCount) {
    state.lastChannelEventCount = evCount;
    // Also emit an authoritative decoded-DSKY snapshot (bypasses coalescer).
    send({
      type: "dskyDecoded",
      payload: {
        decoded: state.decodedDsky,
        missionTimeUs: Number(state.clock.getMissionTimeUs()),
        tickIndex: currentTickIndex(),
      },
    });
    state.coalescer.offer(buildSnapshot());
  } else {
    state.coalescer.offer(buildSnapshot());
  }
}

/**
 * Pre-ready canonical initialization state machine. Advances at most one
 * transition per scheduler tick; publishes public `ready` when settled.
 * Preconditions established by `enterCanonicalInit()`:
 *   - state.publicPhaseStarted === false
 *   - adapter present, scheduler running, mission clock advancing
 *   - state.decodedDsky reflects live emulator channel output
 *   - state.canonicalInit set to a fresh `await-agc-active` state
 */
function pumpCanonicalInit(): void {
  if (state.publicPhaseStarted) return;
  const adapter = state.adapter;
  if (!adapter) return;
  const ci = state.canonicalInit;
  const tickIndex = currentTickIndex();
  const stepsNow = Number(state.clock.getTotalAgcSteps());
  const missionTimeUs = Number(state.clock.getMissionTimeUs());
  const restartLit = state.decodedDsky.annunciators.restart;

  if (!ci.restartObservedBeforeRset && restartLit) {
    ci.restartObservedBeforeRset = true;
    ci.trace.push({ kind: "restartObserved", tickIndex, missionTimeUs });
  }

  switch (ci.phase) {
    case "await-agc-active": {
      // AGC must have taken steps beyond the reset baseline. This ensures
      // PINBALL and the executive have had scheduler time before we submit
      // any DSKY input; sending RSET on tick 0 would race the boot code.
      if (stepsNow <= ci.stepsAtReset) return;
      if (tickIndex - ci.ticksAtReset < 2) return;
      ci.phase = "await-rset-send";
      return;
    }
    case "await-rset-send": {
      // Send exactly one RSET keycode (0o22) through the SAME authentic
      // path the rendered DSKY keypad uses. Not another cpu_reset(); not a
      // silent decoder mutation. PINBALL will observe it via KEYRUPT and
      // clear the test-alarm output responsible for STBY and RESTART.
      adapter.keyPress(AGC_KEY.RSET);
      recordHostInput(0o15, AGC_KEY.RSET);
      ci.startupRsetSent = true;
      ci.startupRsetAccepted = true; // synchronous CH015 write
      ci.startupRsetCount++;
      ci.trace.push({ kind: "startupRsetSent", tickIndex, missionTimeUs });
      ci.phase = ci.restartObservedBeforeRset || restartLit
        ? "await-restart-clear"
        : "quiet-window";
      ci.quietWindowSeedTick = tickIndex;
      ci.quietWindowSeedSteps = stepsNow;
      ci.quietWindowSeedProjection = readinessProjectionCanonical(state.decodedDsky);
      return;
    }
    case "await-restart-clear": {
      if (!restartLit) {
        ci.restartClearedAfterRset = true;
        ci.trace.push({ kind: "restartCleared", tickIndex, missionTimeUs });
        ci.quietWindowSeedTick = tickIndex;
        ci.quietWindowSeedSteps = stepsNow;
        ci.quietWindowSeedProjection = readinessProjectionCanonical(state.decodedDsky);
        ci.phase = "quiet-window";
      }
      return;
    }
    case "quiet-window": {
      const standbyLit = state.decodedDsky.annunciators.standby;
      if (restartLit || standbyLit) {
        // Regression: restart/standby re-asserted. Restart the wait.
        if (restartLit) {
          ci.restartClearedAfterRset = false;
          ci.phase = "await-restart-clear";
        } else {
          ci.quietWindowSeedTick = tickIndex;
          ci.quietWindowSeedSteps = stepsNow;
          ci.quietWindowSeedProjection = readinessProjectionCanonical(state.decodedDsky);
        }
        return;
      }
      const proj = readinessProjectionCanonical(state.decodedDsky);
      if (proj !== ci.quietWindowSeedProjection) {
        ci.quietWindowSeedTick = tickIndex;
        ci.quietWindowSeedProjection = proj;
        return;
      }
      if (stepsNow <= ci.quietWindowSeedSteps) return;
      if (tickIndex - ci.quietWindowSeedTick < V35_READINESS_QUIET_TICKS) return;
      ci.settledAtTick = tickIndex;
      ci.phase = "settled";
      ci.trace.push({ kind: "settled", tickIndex, missionTimeUs });
      publishReady();
      return;
    }
    case "settled":
      return;
  }
}

/**
 * Transition from pre-ready canonical init to the public session. Public
 * event IDs restart from 1 so lesson attempt boundaries and the public
 * event log begin from a documented origin; pre-ready channel events
 * (including RSET's own inputAccepted echo) never appear in the public
 * event log by construction. The initialization trace is preserved in
 * `initTraceHistory` for post-hoc inspection.
 */
function publishReady(): void {
  const adapter = state.adapter;
  if (!adapter || state.ropeId === null) return;
  // Archive the pre-ready trace, then start the public session clean.
  initTraceHistory.push({
    sessionEpoch: state.sessionEpoch,
    entries: state.canonicalInit.trace.slice(),
  });
  if (initTraceHistory.length > 8) initTraceHistory.splice(0, initTraceHistory.length - 8);
  state.nextEventId = 1;
  state.recentEventsRing.length = 0;
  state.publicEventsRing.length = 0;
  state.publicEventsAppendedTotal = 0;
  state.lastLamps = adapter.lampBits();
  state.lastChannelEventCount = adapter.totalChannelEvents();
  // Align the Worker-owned decoder's EC counter with the client-side pure
  // replay boundary. The decoder was fed every pre-ready DSKY channel write
  // (needed so the live lamp state is correct at hand-off), but its
  // `eventCount` accumulator would otherwise diverge from any consumer that
  // replays only the post-ready `channelUpdate` stream (e.g. the golden-trace
  // capture fixtures). We reset ONLY `eventCount`, preserving digits, signs,
  // and annunciators so the UI keeps showing the actual settled DSKY state.
  state.decodedDsky.eventCount = 0;
  // Capture the epoch-start baseline BEFORE flipping publicPhaseStarted so
  // no channel/input event can race in and shift the recorded origin.
  // Deep-clone decodedDsky so downstream mutations cannot perturb it.
  state.epochStartBaseline = {
    tickIndex: currentTickIndex(),
    missionTimeUs: Number(state.clock.getMissionTimeUs()),
    totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
    decodedDsky: JSON.parse(JSON.stringify(state.decodedDsky)) as DecodedDsky,
    decodedDskyChecksum: decodedDskyCanonical(state.decodedDsky),
    channelValues: snapshotAllChannels(adapter),
  };
  state.publicPhaseStarted = true;
  state.workerState = "ready";
  send({
    type: "ready",
    payload: {
      emulatorRepo: "michaelfranzl/webAGC",
      emulatorCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
      emulatorVersionString: state.emulatorVersion,
      ropeId: state.ropeId,
      ropeSha256: state.ropeSha256,
      ropeSourceCommit: state.ropeSourceCommit,
      ropeByteLength: state.ropeByteLength,
      wasmSha256: state.wasmSha256,
      protocolVersion: PROTOCOL_VERSION,
      initialResetPerformed: true,
      resetCount: state.resetCount,
      sessionEpoch: state.sessionEpoch,
      canonicalInit: canonicalInitInfo(state.canonicalInit),
    },
  });
  // M3.3A2-P4: publish extension identity as its own additive message so
  // the frozen M2 ReadyPayload shape is untouched. Emitted AFTER ready so
  // legacy listeners never see it and any consumer that awaits both can
  // rely on ordering.
  if (state.extensionIdentity) {
    const ext = state.extensionIdentity;
    send({
      type: "agc:extension-ready",
      hwioVersion: 4,
      extVersion: ext.extVersion,
      extensionTag: ext.extensionTag,
      wasmSha256: state.wasmSha256,
      traceEnabled: false,
      traceDropped: 0,
    });
  }
  // Publish the M3.2 sim:ready AFTER the AGC ready so consumers see AGC
  // provenance first, then the sim namespace open in a separate frame.
  sendSimReady();
}

function diagnostics(): Diagnostics {
  const s = state.clock.stats();
  return {
    crossOriginIsolated:
      typeof (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ===
      "boolean"
        ? Boolean((self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated)
        : false,
    avgTickMs: s.avgTickMs,
    maxTickMs: s.maxTickMs,
    schedulerOverruns: s.overruns,
    ticksExecuted: s.ticksExecuted,
    lastError: state.lastError,
    workerState: state.workerState,
    initialResetPerformed: state.initialResetPerformed,
    resetCount: state.resetCount,
    sessionEpoch: state.sessionEpoch,
    canonicalInit: state.initialResetPerformed
      ? canonicalInitInfo(state.canonicalInit)
      : null,
    extensionIdentity: state.extensionIdentity,
  };
}

async function loadRopeVerified(
  ropeUrl: string,
  manifestUrl: string,
  ropeId: "Luminary099" | "Comanche055",
): Promise<{ bytes: Uint8Array; sha256: string; sourceCommit: string }> {
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`rope-manifest fetch failed: HTTP ${manifestResp.status}`);
  }
  const manifest = await manifestResp.json();
  const expectedSha: string | undefined = manifest?.artifactProvenance?.sha256;
  const expectedLen: number | undefined = manifest?.artifactProvenance?.byteLength;
  const sourceCommit: string = manifest?.sourceProvenance?.commit ?? "";
  if (!expectedSha || !expectedLen) {
    throw new Error("rope-manifest missing artifactProvenance.sha256 or byteLength");
  }
  const ropeResp = await fetch(ropeUrl);
  if (!ropeResp.ok) {
    throw new Error(`rope fetch failed: HTTP ${ropeResp.status}`);
  }
  const buf = await ropeResp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength !== expectedLen) {
    throw new Error(
      `rope-integrity byte length mismatch: expected ${expectedLen}, got ${bytes.byteLength}`,
    );
  }
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== expectedSha) {
    throw new Error(
      `rope-integrity SHA-256 mismatch for ${ropeId}: expected ${expectedSha}, got ${sha256}`,
    );
  }
  return { bytes, sha256, sourceCommit };
}

async function handle(
  rawCmd: AgcCommand | SimulationCommand,
  requestId?: string,
): Promise<void> {
  // ---- M3.2 simulation namespace dispatch ------------------------------
  const anyCmd = rawCmd as { type: string };
  if (anyCmd.type.startsWith("sim:")) {
    handleSimulationCommand(rawCmd as SimulationCommand, requestId);
    return;
  }
  // Below this line the message is a frozen AGC command. Shadowing the
  // parameter as `cmd` keeps the (large, unchanged) switch body intact.
  const cmd = rawCmd as AgcCommand;
  const adapter = state.adapter;
  switch (cmd.type) {
    case "initialize": {
      if (state.adapter) return;
      state.workerState = "initializing";
      const a = new AgcCoreAdapter({
        // LOSSLESS observer (P5.d §7): every output packet, including
        // repeated writes of the same value which onChannelUpdate filters.
        onChannelPacket: (ch, val, before) => {
          if (!state.monitor?.isActive()) return;
          if (!EXPECTED_ACTUATOR_CHANNELS.includes(ch)) return;
          const seq = ++state.channelObservationSeq;
          state.tickChannelEvents.push({
            stream: "channel",
            sequence: { hi: 0, lo: seq },
            cycle: { hi: 0, lo: seq },
            channel: ch,
            value: val,
            valueBefore: before,
          });
        },
        onChannelUpdate: (ch, val) => {
          const eventId = state.nextEventId++;
          const tickIndex = currentTickIndex();
          const missionTimeUs = Number(state.clock.getMissionTimeUs());
          // Route DSKY-relevant channels through the source-normative decoder:
          //   * 0o10  — digit rows + selector-12 annunciator row (yaDSKY2)
          //   * 0o11  — COMP ACTY / UPLINK ACTY (webAGC synthetic)
          //   * 0o163 — TEMP / KEY REL / VN FLASH / OPR ERR / RESTART / STBY / etc.
          applyDskyChannelEvent(state.decodedDsky, ch, val);
          const lite: ChannelEventLite = {
            eventId, tickIndex, channel: ch, value: val, seq: eventId, missionTimeUs,
          };
          // Preserve the per-event context in the Worker-owned ring so
          // buildSnapshot cannot lose it. Bounded so it cannot grow.
          state.recentEventsRing.push(lite);
          if (state.recentEventsRing.length > state.recentEventsCap) {
            state.recentEventsRing.splice(0, state.recentEventsRing.length - state.recentEventsCap);
          }
          // Record on the public event ring for event-log export. The
          // `send()` gate below drops this event before it reaches the
          // client during pre-ready canonical init; mirror that here so
          // the export ring cannot contain pre-public events either.
          if (state.publicPhaseStarted) {
            appendPublicEvent({
              type: "channelUpdate",
              eventId, tickIndex, missionTimeUs,
              totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
              channel: ch, value: val,
            });
          }
          send({ type: "channelUpdate", payload: lite });
        },
      });
      await a.init(cmd.wasmUrl);
      state.adapter = a;
      // Worker-owned monitor state machine. Constructed dormant: no trace
      // arming, no counter input, no injection until an accepted
      // `sim:set-monitor-profile` command reaches its tick boundary.
      state.monitor = new MonitorController(makeMonitorPort());
      state.emulatorVersion = a.version() || "unknown";
      // Source-normative assertion: the WASM version() must embed the pinned
      // yaAGC/virtualagc source commit that produced our decoder tables. If
      // this ever fails, the decoder mapping and the running emulator have
      // desynchronized and every subsequent decoded value is unsound.
      if (!state.emulatorVersion.includes(EXPECTED_YAAGC_VERSION_SUBSTRING)) {
        const msg =
          `yaAGC WASM version mismatch: expected version string to contain ` +
          `"${EXPECTED_YAAGC_VERSION_SUBSTRING}" (from ${EXPECTED_YAAGC_SOURCE_COMMIT}), ` +
          `got ${JSON.stringify(state.emulatorVersion)}`;
        state.lastError = msg;
        state.workerState = "error";
        send({ type: "fatalError", payload: { code: "yaagc-version-mismatch", message: msg } });
        throw new Error(msg);
      }
      // M3.3A2-P4: production must always instantiate the extended runtime
      // (`yaAGC-ext.wasm`, HW-I/O v3). The frozen artifact is missing the
      // extension exports and is a hard-failure in the Worker; the parity
      // harness loads it directly under Vitest, never through this path.
      const extId = a.extensionIdentity();
      if (!extId) {
        const msg =
          `AGC runtime is missing HW-I/O extension exports. ` +
          `Expected canonical extended runtime (agc_hwio_version=${CANONICAL_AGC_RUNTIME.hwioVersion}) ` +
          `at ${cmd.wasmUrl}; got frozen artifact. This is a build/deploy defect.`;
        state.lastError = msg;
        state.workerState = "error";
        send({ type: "fatalError", payload: { code: "agc-runtime-not-extended", message: msg } });
        throw new Error(msg);
      }
      if (extId.hwioVersion !== CANONICAL_AGC_RUNTIME.hwioVersion) {
        const msg =
          `AGC HW-I/O version mismatch: expected ${CANONICAL_AGC_RUNTIME.hwioVersion}, ` +
          `got ${extId.hwioVersion}`;
        state.lastError = msg;
        state.workerState = "error";
        send({ type: "fatalError", payload: { code: "agc-hwio-version-mismatch", message: msg } });
        throw new Error(msg);
      }
      // Dormancy contract: the canonical runtime boots with tracing disabled.
      // Any nonzero counter here means the extension code path was invoked
      // before the Worker got to observe it, which violates M3.3A2-P4.
      if (extId.traceEnabled !== 0 || extId.traceDropped !== 0) {
        const msg =
          `AGC runtime is not dormant at boot: trace_enabled=${extId.traceEnabled}, ` +
          `trace_dropped=${extId.traceDropped}`;
        state.lastError = msg;
        state.workerState = "error";
        send({ type: "fatalError", payload: { code: "agc-runtime-not-dormant", message: msg } });
        throw new Error(msg);
      }
      state.extensionIdentity = {
        hwioVersion: extId.hwioVersion,
        extVersion: extId.extVersion,
        extensionTag: CANONICAL_AGC_RUNTIME.extensionTag,
        traceEnabled: extId.traceEnabled,
        traceDropped: extId.traceDropped,
      };
      // Compute WASM SHA-256 for diagnostics (best-effort; skip on failure).
      try {
        const resp = await fetch(cmd.wasmUrl);
        state.wasmSha256 = await sha256Hex(await resp.arrayBuffer());
      } catch {
        state.wasmSha256 = "";
      }
      state.workerState = "ready";
      return;
    }
    case "loadRope": {
      if (!adapter) throw new Error("loadRope before initialize");
      state.workerState = "loading-rope";
      const { bytes, sha256, sourceCommit } = await loadRopeVerified(
        cmd.ropeUrl,
        cmd.manifestUrl,
        cmd.ropeId,
      );
      // Hand off to the emulator using its existing loadRom path — pass a
      // blob URL so the adapter's fetch works, or use the internal write.
      // We call adapter.loadRom(url) with the original ropeUrl to preserve
      // the adapter's fixed-memory setup semantics; bytes were already
      // integrity-checked above.
      await adapter.loadRom(cmd.ropeUrl);
      state.ropeId = cmd.ropeId;
      state.ropeSha256 = sha256;
      state.ropeSourceCommit = sourceCommit;
      state.ropeByteLength = bytes.byteLength;
      // Canonical initialization: exactly one cpu_reset() after rope load.
      // We do NOT emit `ready` here — the Worker holds the public session
      // closed until pumpCanonicalInit() completes the RSET-and-settle
      // sequence, and only then publishes `ready` with the resulting
      // canonicalInit block. Every route (/learn, /sim, /capture) reaches
      // the SAME post-canonical-init starting state.
      if (state.initialResetPerformed) {
        throw new Error("canonical-init: loadRope invoked twice on one session");
      }
      adapter.reset();
      state.monitor?.inputShadow().seedAfterCpuReset();
      state.resetCount++;
      state.initialResetPerformed = true;
      state.clock.reset();
      // Pre-ready gate is already closed by construction; belt-and-braces:
      state.publicPhaseStarted = false;
      state.canonicalInit = makeCanonicalInitState(
        state.resetCount,
        Number(state.clock.getTotalAgcSteps()),
        currentTickIndex(),
        Number(state.clock.getMissionTimeUs()),
      );
      state.workerState = "canonical-init";
      startScheduler();
      return;
    }
    case "start":
    case "resume": {
      state.clock.resume(cmd.type === "resume" ? cmd.timeScale : undefined);
      state.workerState = "ready";
      startScheduler();
      send({
        type: "resumed",
        payload: {
          missionTimeUs: Number(state.clock.getMissionTimeUs()),
          timeScale: state.clock.getTimeScale(),
        },
      });
      return;
    }
    case "pause": {
      state.clock.setTimeScale(0);
      state.workerState = "paused";
      send({ type: "paused", payload: { missionTimeUs: Number(state.clock.getMissionTimeUs()) } });
      return;
    }
    case "setTimeScale": {
      state.clock.setTimeScale(cmd.timeScale);
      if (cmd.timeScale === 0) {
        state.workerState = "paused";
        send({
          type: "paused",
          payload: { missionTimeUs: Number(state.clock.getMissionTimeUs()) },
        });
      } else {
        state.workerState = "ready";
        send({
          type: "resumed",
          payload: {
            missionTimeUs: Number(state.clock.getMissionTimeUs()),
            timeScale: cmd.timeScale,
          },
        });
      }
      return;
    }
    case "reset": {
      if (!adapter) return;
      // Explicit user Reset AGC: perform ONE cpu_reset(), bump the public
      // session epoch, then re-enter canonical initialization so the same
      // authentic startup RSET-and-settle sequence runs before the next
      // public `ready`. Ordinary navigation must never invoke this path.
      // M3.2: if a scenario is running, transition the MissionRuntime into
      // the `interlocked` state. Only a subsequent `sim:resetScenario`
      // command can clear the interlock — an AGC-side epoch change alone
      // does NOT resume physics.
      state.missionRuntime.interlock("agc-epoch-changed");
      state.simReadyPublished = false;
      adapter.reset();
      state.resetCount++;
      state.sessionEpoch++;
      // cpu_reset() disarms HW-I/O tracing inside the WASM. Monitor mode
      // therefore INTERLOCKS: injection stops, the trace is confirmed
      // disabled, and re-entry requires an explicit scenario reset plus a
      // new profile command. It never re-arms itself.
      state.monitor?.onAgcEpochChanged(state.sessionEpoch);
      state.avionics = null;
      state.monitorCommandQueue.length = 0;
      state.tickChannelEvents.length = 0;
      state.clock.reset();
      state.events = new EventLog(state.events.snapshot().seed);
      state.decodedDsky = makeEmptyDecodedDsky();
      state.recentEventsRing.length = 0;
      state.publicEventsRing.length = 0;
      state.publicEventsAppendedTotal = 0;
      state.epochStartBaseline = null;
      state.lastLamps = 0;
      state.lastChannelEventCount = 0;
      state.publicPhaseStarted = false;
      state.workerState = "canonical-init";
      state.canonicalInit = makeCanonicalInitState(
        state.resetCount,
        Number(state.clock.getTotalAgcSteps()),
        currentTickIndex(),
        Number(state.clock.getMissionTimeUs()),
      );
      return;
    }
    case "dskyKeyDown": {
      if (!adapter) return;
      adapter.keyPress(cmd.keyCode);
      recordHostInput(0o15, cmd.keyCode);
      const eventId = state.nextEventId++;
      const tickIndex = currentTickIndex();
      const missionTimeUs = Number(state.clock.getMissionTimeUs());
      state.events.append({
        missionTimeUs,
        kind: "dskyKeyDown",
        payload: { keyCode: cmd.keyCode },
      });
      if (state.publicPhaseStarted) {
        appendPublicEvent({
          type: "inputAccepted",
          eventId, tickIndex, missionTimeUs,
          totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
          kind: "dskyKeyDown", keyCode: cmd.keyCode,
        });
      }
      send({
        type: "inputAccepted",
        payload: { eventId, tickIndex, missionTimeUs, kind: "dskyKeyDown", keyCode: cmd.keyCode },
      });
      return;
    }
    case "dskyKeyUp": {
      if (!adapter) return;
      const eventId = state.nextEventId++;
      const tickIndex = currentTickIndex();
      const missionTimeUs = Number(state.clock.getMissionTimeUs());
      state.events.append({
        missionTimeUs,
        kind: "dskyKeyUp",
        payload: { keyCode: cmd.keyCode },
      });
      if (state.publicPhaseStarted) {
        appendPublicEvent({
          type: "inputAccepted",
          eventId, tickIndex, missionTimeUs,
          totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
          kind: "dskyKeyUp", keyCode: cmd.keyCode,
        });
      }
      send({
        type: "inputAccepted",
        payload: { eventId, tickIndex, missionTimeUs, kind: "dskyKeyUp", keyCode: cmd.keyCode },
      });
      return;
    }
    case "proceedKey": {
      if (!adapter) return;
      adapter.proceedKey(cmd.pressed);
      recordHostInput(0o32, cmd.pressed ? 0 : 1 << 13);
      const eventId = state.nextEventId++;
      const tickIndex = currentTickIndex();
      const missionTimeUs = Number(state.clock.getMissionTimeUs());
      state.events.append({
        missionTimeUs,
        kind: "proceedKey",
        payload: { pressed: cmd.pressed },
      });
      if (state.publicPhaseStarted) {
        appendPublicEvent({
          type: "inputAccepted",
          eventId, tickIndex, missionTimeUs,
          totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
          kind: "proceedKey", pressed: cmd.pressed,
        });
      }
      send({
        type: "inputAccepted",
        payload: { eventId, tickIndex, missionTimeUs, kind: "proceedKey", pressed: cmd.pressed },
      });
      return;
    }
    case "stepSimulation": {
      if (!adapter) return;
      const ticks = Math.max(1, cmd.ticks ?? 1);
      for (let i = 0; i < ticks; i++) {
        state.clock.stepOneTick(runMissionTickPipeline);
      }
      onPostTick();
      state.coalescer.flushNow();
      state.missionCoalescer.flushNow();
      return;
    }
    case "stepAgcDebug": {
      if (!adapter) return;
      adapter.singleStep(cmd.steps);
      state.coalescer.offer(buildSnapshot());
      return;
    }
    case "configure": {
      if (cmd.erasableBase !== undefined) {
        state.erasableBase = Math.max(0, Math.min(2032, cmd.erasableBase | 0));
      }
      if (cmd.erasableLength !== undefined) {
        state.erasableLength = Math.max(1, Math.min(256, cmd.erasableLength | 0));
      }
      return;
    }
    case "requestSnapshot": {
      state.coalescer.offer(buildSnapshot());
      state.coalescer.flushNow();
      return;
    }
    case "requestDiagnostics": {
      send({ type: "diagnostics", payload: diagnostics() }, requestId);
      return;
    }
    case "requestEventBoundary": {
      // Allocate a boundary id from the SAME nextEventId counter used by
      // inputAccepted and channelUpdate. Every subsequent event has id >
      // boundaryEventId, so lesson attempts opened on this boundary
      // strictly reject stale evidence without any main-thread timing.
      const boundaryEventId = state.nextEventId++;
      const stats = state.clock.stats();
      send(
        {
          type: "eventBoundary",
          payload: {
            boundaryEventId,
            tickIndex: stats.ticksExecuted,
            missionTimeUs: Number(state.clock.getMissionTimeUs()),
            totalAgcSteps: Number(state.clock.getTotalAgcSteps()),
            // Structured-clone-safe deep copy so the worker can keep
            // mutating its own decoded state without perturbing the
            // client's baseline. postMessage clones again, but cloning
            // here up-front documents the ownership hand-off.
            decodedDsky: JSON.parse(JSON.stringify(state.decodedDsky)) as DecodedDsky,
            decodedDskyChecksum: decodedDskyCanonical(state.decodedDsky),
          },
        },
        requestId,
      );
      return;
    }
    case "requestEventLogExport": {
      if (!state.publicPhaseStarted || !state.epochStartBaseline) {
        // Reply with an empty-epoch export so the client can still show a
        // well-formed "no data yet" state. `sessionEpoch` still identifies
        // which epoch this is (pre-ready → the epoch currently spinning up).
        send(
          {
            type: "eventLogExport",
            payload: {
              sessionEpoch: state.sessionEpoch,
              timing: { nominalStepNs: 11720, schedulerTickUs: SCHEDULER_TICK_MICROS },
              baseline: {
                tickIndex: 0,
                missionTimeUs: 0,
                totalAgcSteps: 0,
                decodedDsky: makeEmptyDecodedDsky(),
                decodedDskyChecksum: decodedDskyCanonical(makeEmptyDecodedDsky()),
                channelValues: {},
              },
              events: [],
              retention: {
                completeEpoch: true,
                droppedBeforeEventId: null,
                retainedEventLimit: state.publicEventsCap,
              },
            },
          },
          requestId,
        );
        return;
      }
      // Deep-copy ring records so the caller receives its own snapshot; a
      // subsequent tick could otherwise append into the same array before
      // postMessage's structured clone runs.
      const eventsCopy: PublicEventRecord[] = state.publicEventsRing.map((e) =>
        e.type === "channelUpdate" ? { ...e } : { ...e },
      );
      const dropped =
        state.publicEventsAppendedTotal - state.publicEventsRing.length;
      const firstRetainedId =
        eventsCopy.length > 0 ? eventsCopy[0].eventId : null;
      const payload: EventLogExportPayload = {
        sessionEpoch: state.sessionEpoch,
        timing: { nominalStepNs: 11720, schedulerTickUs: SCHEDULER_TICK_MICROS },
        baseline: {
          tickIndex: state.epochStartBaseline.tickIndex,
          missionTimeUs: state.epochStartBaseline.missionTimeUs,
          totalAgcSteps: state.epochStartBaseline.totalAgcSteps,
          decodedDsky: JSON.parse(
            JSON.stringify(state.epochStartBaseline.decodedDsky),
          ) as DecodedDsky,
          decodedDskyChecksum: state.epochStartBaseline.decodedDskyChecksum,
          channelValues: { ...state.epochStartBaseline.channelValues },
        },
        events: eventsCopy,
        retention: {
          completeEpoch: dropped === 0,
          droppedBeforeEventId: dropped === 0 ? null : firstRetainedId,
          retainedEventLimit: state.publicEventsCap,
        },
      };
      send({ type: "eventLogExport", payload }, requestId);
      return;
    }
    case "dispose": {
      state.disposed = true;
      state.monitor?.dispose();
      stopScheduler();
      return;
    }
  }
}

/**
 * M3.2 simulation-namespace dispatcher. Synchronous — every sim command
 * completes in constant time so the FIFO `commandQueue` in the message
 * listener never blocks on physics. Runtime state mutations only happen
 * here (enqueue) or inside `runMissionTickPipeline` (apply + advance).
 */
/** PROG register -> integer major mode. Blank digits read as P00, which is
 *  what a freshly reset, pre-scenario AGC displays. */
function decodedProgramNumber(dsky: DecodedDsky): number {
  const text = dsky.program.digits.map((d) => String(d.value ?? 0)).join("");
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : 0;
}

function handleSimulationCommand(
  cmd: SimulationCommand,
  requestId?: string,
): void {
  switch (cmd.type) {
    case "sim:queryReady": {
      // Idempotent: caller may ask again to re-sync after a route mount.
      sendSimReady(requestId);
      return;
    }
    case "sim:enqueue": {
      const ack = state.missionRuntime.enqueue(cmd.command);
      sendSimEvent({ type: "sim:commandAck", payload: ack }, requestId);
      return;
    }
    case "sim:forceSnapshot": {
      const stats = state.clock.stats();
      const snap = state.missionRuntime.snapshot(
        stats.ticksExecuted,
        Number(state.clock.getMissionTimeUs()),
        state.clock.isPaused(),
        monitorSnapshot(stats.ticksExecuted),
      );
      state.missionCoalescer.offer(snap);
      state.missionCoalescer.flushNow();
      return;
    }
    // ---- Simulation protocol v2: monitor mode --------------------------
    case "sim:set-avionics": {
      // Operator-declared discretes. Rejected on a stale epoch so an
      // avionics state can never leak across a scenario reset.
      const epoch = state.missionRuntime.getSimulationEpoch();
      if (cmd.simulationEpoch !== epoch) {
        sendSimEvent({
          type: "sim:commandAck",
          payload: {
            accepted: false,
            commandId: cmd.commandId,
            reason: "stale-simulation-epoch",
            message: `command epoch ${cmd.simulationEpoch} != runtime epoch ${epoch}`,
          },
        }, requestId);
        return;
      }
      state.avionics = { ...cmd.avionics };
      sendSimEvent({
        type: "sim:commandAck",
        payload: { accepted: true, commandId: cmd.commandId },
      }, requestId);
      return;
    }
    case "sim:set-monitor-profile": {
      const epoch = state.missionRuntime.getSimulationEpoch();
      const validation = validateSetMonitorProfileCommand(
        cmd,
        epoch,
        state.missionRuntime.getState().acceptedCursorUs,
        MISSION_TICK_US,
      );
      if (!validation.ok) {
        sendSimEvent({
          type: "sim:monitor-blocked",
          commandId: cmd.commandId,
          simulationEpoch: epoch,
          requestedProfile: cmd.profile,
          reasons: [{ code: "prerequisite-missing", detail: validation.message }],
        }, requestId);
        return;
      }
      state.monitorCommandQueue.push(cmd);
      return;
    }
    // ---- M3.3C Phase 4B: fixed-attitude IMU bootstrap ------------------
    case "sim:apply-imu-bootstrap": {
      const epoch = state.missionRuntime.getSimulationEpoch();
      const manifest = LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1;
      const emit = (
        ok: boolean,
        installedWords: number,
        failures: readonly { code: string; detail: string }[],
      ) =>
        sendSimEvent({
          type: "sim:imu-bootstrap-result",
          commandId: cmd.commandId,
          simulationEpoch: epoch,
          agcEpoch: state.sessionEpoch,
          ok,
          manifestId: manifest.id,
          installedWords,
          failures,
        }, requestId);

      if (cmd.simulationEpoch !== epoch) {
        emit(false, 0, [{
          code: "stale-simulation-epoch",
          detail: `command epoch ${cmd.simulationEpoch} != runtime epoch ${epoch}`,
        }]);
        return;
      }
      if (cmd.manifestId !== manifest.id) {
        emit(false, 0, [{ code: "unknown-manifest", detail: cmd.manifestId }]);
        return;
      }
      const adapter = state.adapter;
      if (!adapter) {
        emit(false, 0, [{ code: "no-adapter", detail: "AGC core is not initialized" }]);
        return;
      }

      const runtimeState = state.missionRuntime.getState();
      const result = applyFixedAttitudeImuBootstrapV1(adapter, {
        clockPaused: state.clock.isPaused(),
        monitorProfile: state.monitor?.facts().profile ?? "off",
        traceRingCount: state.monitor?.traceWindow().retainedCount ?? 0,
        pendingHwInputRecords: 0,
        ropeId: state.ropeId,
        ropeSha256: state.ropeSha256,
        runtimeSha256: state.wasmSha256,
        agcEpoch: state.sessionEpoch,
        simulationEpoch: epoch,
        installedInAgcEpoch: state.imuBootstrapAgcEpoch,
        majorMode: decodedProgramNumber(state.decodedDsky),
        scenarioId: runtimeState.scenarioId ?? "",
        allowedScenarioIds: manifest.allowedScenarioIds,
      }, manifest);

      if (result.ok) state.imuBootstrapAgcEpoch = state.sessionEpoch;
      emit(result.ok, result.installedWords, result.failures);
      return;
    }
    case "sim:request-monitor-trace": {
      const monitor = state.monitor;
      const window = monitor
        ? monitor.traceWindow()
        : { events: [], firstSeq: null, lastSeq: null, retainedCount: 0, droppedCount: 0, capacity: MONITOR_TRACE_CAPACITY, firstMissionTick: null, lastMissionTick: null };
      sendSimEvent({
        type: "sim:monitor-trace",
        requestId: cmd.requestId,
        simulationEpoch: state.missionRuntime.getSimulationEpoch(),
        agcEpoch: state.sessionEpoch,
        profile: monitor?.facts().profile ?? "off",
        firstSeq: window.firstSeq,
        lastSeq: window.lastSeq,
        retainedCount: window.retainedCount,
        capacity: window.capacity,
        droppedCount: window.droppedCount,
        wasmDroppedCount: state.adapter?.traceDropped() ?? 0,
        // The ring is drained once per mission tick, so nothing is pending
        // between ticks. Reported explicitly rather than assumed.
        wasmPendingCount: 0,
        events: window.events,
      }, requestId);
      return;
    }
  }
}

// FIFO serialization: a later command (e.g. loadRope) MUST NOT start until
// the previous command's async handler has fully resolved. Without this, the
// initialize handler's `await a.init(wasmUrl)` yields the event loop and the
// next queued message runs concurrently — loadRope then sees adapter === null
// and throws "loadRope before initialize".
let commandQueue: Promise<void> = Promise.resolve();

ctx.addEventListener("message", (ev: MessageEvent<C2WEnvelope>) => {
  const env = ev.data;
  if (!env || env.protocol !== PROTOCOL_VERSION || env.dir !== "c2w") return;
  commandQueue = commandQueue.then(() =>
    handle(env.message, env.requestId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      state.lastError = message;
      state.workerState = "error";
      send({
        type: "fatalError",
        payload: {
          code: err instanceof Error && err.message.startsWith("rope-integrity") ? "rope-integrity" : "worker",
          message,
        },
      }, env.requestId);
    }),
  );
});

// Signal readiness so the client knows the module Worker booted.
send({ type: "diagnostics", payload: diagnostics() });
