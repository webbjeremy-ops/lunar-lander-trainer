// SPDX-License-Identifier: GPL-3.0-or-later
// Main-thread client for AgcWorker. UI components hold exactly one of these
// per active simulation session; on unmount, call dispose().
//
// - Owns its own outbound `seq` counter (monotonic per client instance).
// - Uses uuid-prefixed requestIds so a pending-request map cannot collide
//   with another AgcWorkerClient in the same tab.
// - Rejects all pending requests on fatalError, worker `error`, or dispose.
// - `visibilitychange` listener is only registered when the caller opts in
//   with `{ pauseOnHidden: true }`, and never auto-resumes on visibility
//   change (the user or app has to explicitly resume).

import {
  PROTOCOL_VERSION,
  makeEnvelope,
  type AgcCommand,
  type AgcEvent,
  type C2WEnvelope,
  type Diagnostics,
  type EventBoundaryPayload,
  type EventLogExportPayload,
  type ReadyPayload,
  type RopeId,
  type StateSnapshot,
  type W2CEnvelope,
} from "./protocol";
import type {
  SimulationCommand,
  SimulationEvent,
  SimReadyPayload,
} from "./simulationProtocol";
import type {
  CommandAck,
  MissionCommand,
  MissionSnapshot,
  TerminalTouchdownEvent,
} from "@/simulation/runtime/types";

export interface AgcWorkerClientOptions {
  pauseOnHidden?: boolean;
  /** For tests. Provide an object that behaves like Worker + postMessage. */
  workerFactory?: () => AgcWorkerLike;
}

export interface AgcWorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", handler: (ev: MessageEvent<W2CEnvelope>) => void): void;
  addEventListener(type: "error", handler: (ev: unknown) => void): void;
  removeEventListener?: (type: string, handler: (...args: unknown[]) => void) => void;
  terminate(): void;
}

export interface AgcWorkerClientListeners {
  onReady?: (payload: ReadyPayload) => void;
  /** M3.3A2-P4: fires with the extension-identity announcement that follows
   *  every `ready`. Separate from `onReady` so the frozen M2 readiness
   *  shape is untouched for legacy consumers. */
  onExtensionReady?: (msg: import("./protocol").AgcExtensionReadyMessage) => void;
  onSnapshot?: (snapshot: StateSnapshot) => void;
  onDsky?: (lamps: number, missionTimeUs: number) => void;
  onDskyDecoded?: (decoded: import("./dsky/DskyTypes").DecodedDsky, missionTimeUs: number, tickIndex: number) => void;
  onInputAccepted?: (ev: import("./protocol").InputAcceptedEvent) => void;
  onChannelUpdate?: (ev: import("./protocol").ChannelEventLite) => void;
  /** Fires for every AGC-namespace event. Existing consumers stay
   *  narrowly typed to AgcEvent; sim events flow through `onSimEvent`. */
  onEvent?: (ev: AgcEvent) => void;
  onDiagnostics?: (d: Diagnostics) => void;
  onFatalError?: (code: string, message: string) => void;
  // ---- M3.2 simulation-namespace listeners --------------------------
  onSimEvent?: (ev: SimulationEvent) => void;
  onSimReady?: (payload: SimReadyPayload) => void;
  onSimSnapshot?: (snapshot: MissionSnapshot) => void;
  onSimCommandAck?: (ack: CommandAck) => void;
  onSimTerminalTouchdown?: (ev: TerminalTouchdownEvent) => void;
}

interface PendingRequest {
  resolve: (env: W2CEnvelope) => void;
  reject: (err: Error) => void;
  requestId: string;
}

let instanceCounter = 0;

export class AgcWorkerClient {
  private worker: AgcWorkerLike;
  private seq = 0;
  private readonly instanceId: string;
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private listeners: AgcWorkerClientListeners = {};
  private supplementaryListeners = new Set<AgcWorkerClientListeners>();
  private disposed = false;
  private visibilityHandler: ((ev?: unknown) => void) | null = null;
  private readonly pauseOnHidden: boolean;
  private lastReady: ReadyPayload | null = null;

  constructor(opts: AgcWorkerClientOptions = {}) {
    this.instanceId = `agc-${++instanceCounter}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
    this.pauseOnHidden = Boolean(opts.pauseOnHidden);
    this.worker = (opts.workerFactory ?? defaultWorkerFactory)();
    this.worker.addEventListener("message", (ev: MessageEvent<W2CEnvelope>) => this.onMessage(ev));
    this.worker.addEventListener("error", (ev: unknown) => {
      const message =
        typeof ev === "object" && ev && "message" in ev
          ? String((ev as { message: unknown }).message)
          : "worker error";
      this.handleFatal("worker-error", message);
    });

    if (this.pauseOnHidden && typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "hidden") this.pause();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  setListeners(l: AgcWorkerClientListeners): void {
    this.listeners = l;
  }

  /** Attach a supplementary listener without displacing the primary. Returns
   *  an unsubscribe function. Multiple call sites (e.g. Dsky component and a
   *  LessonHost) may each register their own listener bag on the same client. */
  addListener(l: AgcWorkerClientListeners): () => void {
    this.supplementaryListeners.add(l);
    return () => { this.supplementaryListeners.delete(l); };
  }

  crossOriginIsolated(): boolean {
    return typeof globalThis !== "undefined" &&
      typeof (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === "boolean"
      ? Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)
      : false;
  }

  ready(): ReadyPayload | null {
    return this.lastReady;
  }

  // ------- fire-and-forget commands (no reply expected) -------

  private post(cmd: AgcCommand, requestId?: string): void {
    if (this.disposed) return;
    const env: C2WEnvelope = makeEnvelope("c2w", ++this.seq, cmd, { requestId });
    this.worker.postMessage(env);
  }

  /** M3.2: post a sim-namespace command through the same envelope so the
   *  Worker's FIFO command queue serializes AGC and sim commands together. */
  private postSim(cmd: SimulationCommand, requestId?: string): void {
    if (this.disposed) return;
    const env: C2WEnvelope = makeEnvelope("c2w", ++this.seq, cmd, { requestId });
    this.worker.postMessage(env);
  }

  // ---- M3.2 simulation namespace API -------------------------------
  queryMissionReady(): void { this.postSim({ type: "sim:queryReady" }); }
  enqueueMissionCommand(command: MissionCommand): void {
    this.postSim({ type: "sim:enqueue", command });
  }
  forceMissionSnapshot(): void { this.postSim({ type: "sim:forceSnapshot" }); }

  initialize(wasmUrl: string): void { this.post({ type: "initialize", wasmUrl }); }
  loadRope(ropeId: RopeId, ropeUrl: string, manifestUrl: string): void {
    this.post({ type: "loadRope", ropeId, ropeUrl, manifestUrl });
  }
  start(): void { this.post({ type: "start" }); }
  pause(): void { this.post({ type: "pause" }); }
  resume(timeScale?: number): void { this.post({ type: "resume", timeScale }); }
  reset(): void { this.post({ type: "reset" }); }
  setTimeScale(scale: number): void { this.post({ type: "setTimeScale", timeScale: scale }); }
  dskyKeyDown(keyCode: number): void { this.post({ type: "dskyKeyDown", keyCode }); }
  dskyKeyUp(keyCode: number): void { this.post({ type: "dskyKeyUp", keyCode }); }
  proceedKey(pressed: boolean): void { this.post({ type: "proceedKey", pressed }); }
  stepSimulation(ticks?: number): void { this.post({ type: "stepSimulation", ticks }); }
  stepAgcDebug(steps: number): void { this.post({ type: "stepAgcDebug", steps }); }
  requestSnapshot(): void { this.post({ type: "requestSnapshot" }); }
  configure(erasableBase?: number, erasableLength?: number): void {
    this.post({ type: "configure", erasableBase, erasableLength });
  }

  // ------- request-reply -------

  requestDiagnostics(): Promise<Diagnostics> {
    return this.request({ type: "requestDiagnostics" }, (env) => {
      if (env.message.type !== "diagnostics") throw new Error("expected diagnostics reply");
      return env.message.payload;
    });
  }

  /**
   * Ask the Worker to allocate a fresh boundary id from the shared eventId
   * counter. Every input and channel event emitted after the Worker sends
   * the reply is guaranteed to carry an eventId > boundaryEventId. Lesson
   * attempts MUST open on this reply — never on a snapshot's
   * channelEventCount, which is a different namespace.
   */
  requestEventBoundary(): Promise<EventBoundaryPayload> {
    return this.request({ type: "requestEventBoundary" }, (env) => {
      if (env.message.type !== "eventBoundary")
        throw new Error("expected eventBoundary reply");
      return env.message.payload;
    });
  }

  /** Request a deterministic, epoch-scoped event-log payload from the
   *  Worker. Deterministic given the same session, rope, emulator
   *  commit, protocol version, and event sequence. The caller wraps
   *  this payload with `buildEventLogExport` to produce the versioned
   *  file schema. */
  requestEventLogExport(): Promise<EventLogExportPayload> {
    return this.request({ type: "requestEventLogExport" }, (env) => {
      if (env.message.type !== "eventLogExport")
        throw new Error("expected eventLogExport reply");
      return env.message.payload;
    });
  }


  private request<T>(cmd: AgcCommand, extract: (env: W2CEnvelope) => T): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("AgcWorkerClient disposed"));
    const requestId = `${this.instanceId}-r${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        requestId,
        resolve: (env) => {
          try { resolve(extract(env)); } catch (e) { reject(e as Error); }
        },
        reject,
      });
      this.post(cmd, requestId);
    });
  }

  private onMessage(ev: MessageEvent<W2CEnvelope>): void {
    const env = ev.data;
    if (!env || env.protocol !== PROTOCOL_VERSION || env.dir !== "w2c") return;

    // Reply routing.
    if (env.requestId) {
      const pending = this.pending.get(env.requestId);
      if (pending) {
        this.pending.delete(env.requestId);
        if (env.message.type === "fatalError") {
          pending.reject(new Error(env.message.payload.message));
        } else {
          pending.resolve(env);
        }
      }
    }

    const msg = env.message;
    const fanout = <K extends keyof AgcWorkerClientListeners>(
      key: K,
      call: (l: AgcWorkerClientListeners) => void,
    ): void => {
      const primary = this.listeners[key];
      if (primary) call(this.listeners);
      for (const sup of this.supplementaryListeners) {
        if (sup[key]) {
          try { call(sup); } catch { /* isolate listener errors */ }
        }
      }
    };
    switch (msg.type) {
      case "ready":
        this.lastReady = msg.payload;
        fanout("onReady", (l) => l.onReady?.(msg.payload));
        break;
      case "stateSnapshot":
        fanout("onSnapshot", (l) => l.onSnapshot?.(msg.payload));
        break;
      case "dskyUpdate":
        fanout("onDsky", (l) => l.onDsky?.(msg.payload.lamps, msg.payload.missionTimeUs));
        break;
      case "dskyDecoded":
        fanout("onDskyDecoded", (l) => l.onDskyDecoded?.(msg.payload.decoded, msg.payload.missionTimeUs, msg.payload.tickIndex));
        break;
      case "channelUpdate":
        fanout("onChannelUpdate", (l) => l.onChannelUpdate?.(msg.payload));
        break;
      case "inputAccepted":
        fanout("onInputAccepted", (l) => l.onInputAccepted?.(msg.payload));
        break;
      case "diagnostics":
        fanout("onDiagnostics", (l) => l.onDiagnostics?.(msg.payload));
        break;
      case "fatalError":
        this.handleFatal(msg.payload.code, msg.payload.message);
        break;
      // ---- M3.2 simulation-namespace fanout ------------------------
      case "sim:ready":
        fanout("onSimReady", (l) => l.onSimReady?.(msg.payload));
        break;
      case "sim:snapshot":
        fanout("onSimSnapshot", (l) => l.onSimSnapshot?.(msg.payload));
        break;
      case "sim:commandAck":
        fanout("onSimCommandAck", (l) => l.onSimCommandAck?.(msg.payload));
        break;
      case "sim:terminalTouchdown":
        fanout("onSimTerminalTouchdown", (l) => l.onSimTerminalTouchdown?.(msg.payload));
        break;
    }
    // Route to onEvent (AGC) vs onSimEvent (sim). Discriminate on the
    // `sim:` prefix so existing consumers stay narrowly typed and
    // cannot accidentally receive sim payloads they don't handle.
    if (msg.type.startsWith("sim:")) {
      const simMsg = msg as SimulationEvent;
      this.listeners.onSimEvent?.(simMsg);
      for (const sup of this.supplementaryListeners) {
        try { sup.onSimEvent?.(simMsg); } catch { /* isolate */ }
      }
    } else {
      const agcMsg = msg as AgcEvent;
      this.listeners.onEvent?.(agcMsg);
      for (const sup of this.supplementaryListeners) {
        try { sup.onEvent?.(agcMsg); } catch { /* isolate */ }
      }
    }
  }

  private handleFatal(code: string, message: string): void {
    // Reject every pending request cleanly.
    for (const p of this.pending.values()) {
      p.reject(new Error(`AGC worker fatal: ${code}: ${message}`));
    }
    this.pending.clear();
    this.listeners.onFatalError?.(code, message);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Try graceful dispose; then terminate.
    try { this.post({ type: "dispose" }); } catch { /* ignore */ }
    for (const p of this.pending.values()) {
      p.reject(new Error("AgcWorkerClient disposed"));
    }
    this.pending.clear();
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    try { this.worker.terminate(); } catch { /* ignore */ }
  }
}

function defaultWorkerFactory(): AgcWorkerLike {
  return new Worker(new URL("./AgcWorker.ts", import.meta.url), { type: "module" }) as unknown as AgcWorkerLike;
}
