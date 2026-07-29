// SPDX-License-Identifier: GPL-3.0-or-later
// Dedicated Web Worker that owns the AgcCoreAdapter, MissionClock, EventLog,
// and snapshot coalescer. UI code MUST NOT import this file directly — it is
// instantiated by AgcWorkerClient via new Worker(new URL('./AgcWorker.ts',
// import.meta.url), { type: 'module' }).
//
// No SharedArrayBuffer / Atomics use. Runs identically when
// crossOriginIsolated === false.

/// <reference lib="webworker" />

import { AgcCoreAdapter } from "@/sim/agc/AgcCoreAdapter";
import { MissionClock, TICK_MICROS } from "./MissionClock";
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
  type StateSnapshot,
  type W2CEnvelope,
} from "./protocol";
import { TICK_MICROS as SCHEDULER_TICK_MICROS } from "./MissionClock";
import {
  readinessProjectionCanonical,
} from "@/lessons/ReadinessTracker";
import { V35_READINESS_QUIET_TICKS } from "@/lessons/fixtureExpectations";
import { AGC_KEY } from "@/lessons/keyCodes";

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
  lastError: null,
  workerState: "idle",
  disposed: false,
  lastLamps: 0,
  lastChannelEventCount: 0,
  decodedDsky: makeEmptyDecodedDsky(),
  nextEventId: 1,
  recentEventsRing: [],
  recentEventsCap: 64,
  initialResetPerformed: false,
  resetCount: 0,
  sessionEpoch: 0,
  publicPhaseStarted: false,
  canonicalInit: makeCanonicalInitState(0, 0, 0, 0),
};

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
  const channels: Record<number, number> = {};
  for (const [c, v] of ((): Iterable<[number, number]> => {
    const anyAdapter = adapter as unknown as {
      io?: { allChannels(): ReadonlyMap<number, number> };
    };
    // AgcCoreAdapter keeps the io state private; walk known channels instead
    // when the private accessor is not available.
    if (anyAdapter.io && typeof anyAdapter.io.allChannels === "function") {
      return anyAdapter.io.allChannels().entries();
    }
    // Fallback: iterate the small set of channels the DSKY cares about.
    const KNOWN = [0o10, 0o11, 0o13, 0o15, 0o30, 0o31, 0o32, 0o33, 0o163];
    return KNOWN.map((c) => [c, adapter.channel(c)] as [number, number])[Symbol.iterator]();
  })()) {
    channels[c] = v;
  }
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

function startScheduler(): void {
  if (state.schedulerHandle !== null) return;
  // 20 ms scheduler wake. MissionClock decides how many ticks are due based
  // on wall-clock delta * time scale, bounded to prevent runaway catch-up.
  state.schedulerHandle = setInterval(() => {
    const adapter = state.adapter;
    if (!adapter || state.disposed) return;
    state.clock.advanceByWallClock((steps) => {
      adapter.stepCpu(steps);
      adapter.drainIo();
    });
    onPostTick();
    state.coalescer.tick();
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

async function handle(cmd: AgcCommand, requestId?: string): Promise<void> {
  const adapter = state.adapter;
  switch (cmd.type) {
    case "initialize": {
      if (state.adapter) return;
      state.workerState = "initializing";
      const a = new AgcCoreAdapter({
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
          send({ type: "channelUpdate", payload: lite });
        },
      });
      await a.init(cmd.wasmUrl);
      state.adapter = a;
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
      adapter.reset();
      state.resetCount++;
      state.sessionEpoch++;
      state.clock.reset();
      state.events = new EventLog(state.events.snapshot().seed);
      state.decodedDsky = makeEmptyDecodedDsky();
      state.recentEventsRing.length = 0;
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
      const eventId = state.nextEventId++;
      const tickIndex = currentTickIndex();
      const missionTimeUs = Number(state.clock.getMissionTimeUs());
      state.events.append({
        missionTimeUs,
        kind: "dskyKeyDown",
        payload: { keyCode: cmd.keyCode },
      });
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
      send({
        type: "inputAccepted",
        payload: { eventId, tickIndex, missionTimeUs, kind: "dskyKeyUp", keyCode: cmd.keyCode },
      });
      return;
    }
    case "proceedKey": {
      if (!adapter) return;
      adapter.proceedKey(cmd.pressed);
      const eventId = state.nextEventId++;
      const tickIndex = currentTickIndex();
      const missionTimeUs = Number(state.clock.getMissionTimeUs());
      state.events.append({
        missionTimeUs,
        kind: "proceedKey",
        payload: { pressed: cmd.pressed },
      });
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
        state.clock.stepOneTick((steps) => {
          adapter.stepCpu(steps);
          adapter.drainIo();
        });
      }
      onPostTick();
      state.coalescer.flushNow();
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
    case "dispose": {
      state.disposed = true;
      stopScheduler();
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
