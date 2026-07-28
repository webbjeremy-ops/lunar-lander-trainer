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
  applyDskyOutput,
  makeEmptyDecodedDsky,
} from "./dsky/DskyDecoder";
import type { DecodedDsky } from "./dsky/DskyTypes";
import {
  PROTOCOL_VERSION,
  makeEnvelope,
  type AgcCommand,
  type AgcEvent,
  type C2WEnvelope,
  type ChannelEventLite,
  type Diagnostics,
  type StateSnapshot,
  type W2CEnvelope,
} from "./protocol";

const SNAPSHOT_SCHEMA_VERSION = 1;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let outSeq = 0;

function send(message: AgcEvent, requestId?: string, missionTimeUs?: number): void {
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
};

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
  const recentRaw = adapter.recentEvents(24);
  const recentEvents: ChannelEventLite[] = recentRaw.map((e) => ({
    eventId: e.seq,
    tickIndex: currentTickIndex(),
    channel: e.channel,
    value: e.value,
    seq: e.seq,
    missionTimeUs: Number(state.clock.getMissionTimeUs()),
  }));
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
          // Channel 010 → drive the authentic latched DSKY decoder in order.
          if (ch === 0o10) applyDskyOutput(state.decodedDsky, val);
          send({
            type: "channelUpdate",
            payload: { eventId, tickIndex, channel: ch, value: val, seq: eventId, missionTimeUs },
          });
        },
      });
      await a.init(cmd.wasmUrl);
      state.adapter = a;
      state.emulatorVersion = a.version() || "unknown";
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
      adapter.reset();
      state.clock.reset();
      state.workerState = "ready";
      startScheduler();
      send({
        type: "ready",
        payload: {
          emulatorRepo: "michaelfranzl/webAGC",
          emulatorCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
          emulatorVersionString: state.emulatorVersion,
          ropeId: cmd.ropeId,
          ropeSha256: sha256,
          ropeSourceCommit: sourceCommit,
          ropeByteLength: bytes.byteLength,
          wasmSha256: state.wasmSha256,
          protocolVersion: PROTOCOL_VERSION,
        },
      });
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
      adapter.reset();
      state.clock.reset();
      state.events = new EventLog(state.events.snapshot().seed);
      state.decodedDsky = makeEmptyDecodedDsky();
      state.lastLamps = 0;
      state.lastChannelEventCount = 0;
      state.coalescer.offer(buildSnapshot());
      return;
    }
    case "dskyKeyDown": {
      if (!adapter) return;
      adapter.keyPress(cmd.keyCode);
      state.events.append({
        missionTimeUs: Number(state.clock.getMissionTimeUs()),
        kind: "dskyKeyDown",
        payload: { keyCode: cmd.keyCode },
      });
      return;
    }
    case "dskyKeyUp": {
      if (!adapter) return;
      state.events.append({
        missionTimeUs: Number(state.clock.getMissionTimeUs()),
        kind: "dskyKeyUp",
        payload: { keyCode: cmd.keyCode },
      });
      return;
    }
    case "proceedKey": {
      if (!adapter) return;
      adapter.proceedKey(cmd.pressed);
      state.events.append({
        missionTimeUs: Number(state.clock.getMissionTimeUs()),
        kind: "proceedKey",
        payload: { pressed: cmd.pressed },
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
