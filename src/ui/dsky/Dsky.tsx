// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone-1 DSKY: talks to the AGC exclusively through AgcWorkerClient. No
// emulator instance lives in this component or anywhere else on the main
// thread. Snapshots arrive at ~25 Hz real-time; DSKY lamp changes bypass the
// snapshot throttle and arrive as their own events.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import { agcWasmUrl, type RopeImage, ropeById } from "@/sim/agc/roms";
import { AGC_CHANNELS, DSKY_KEYS, DSKY_LAMPS } from "@/sim/agc/AgcChannelRegistry";
import type { ReadyPayload, StateSnapshot } from "@/agc/protocol";
import { TIME_SCALES } from "@/agc/protocol";
import type { DecodedDsky, DskyRegister } from "@/agc/dsky/DskyTypes";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";

type LampName = keyof typeof DSKY_LAMPS;

const LAMP_LAYOUT: readonly { name: LampName; label: string; color: string }[] = [
  { name: "UPLINK_ACTY", label: "UPLINK ACTY", color: "amber" },
  { name: "TEMP", label: "TEMP", color: "amber" },
  { name: "AGC_WARN", label: "GIMBAL LOCK", color: "amber" },
  { name: "COMP_ACTY", label: "COMP ACTY", color: "green" },
  { name: "STBY", label: "STBY", color: "amber" },
  { name: "KEY_REL", label: "KEY REL", color: "amber" },
  { name: "OPER_ERR", label: "OPR ERR", color: "amber" },
  { name: "RESTART", label: "RESTART", color: "amber" },
  { name: "VERB_NOUN_FLASH", label: "VERB/NOUN FLASH", color: "green" },
  { name: "EL_OFF", label: "EL OFF", color: "amber" },
];

const KEY_LAYOUT: readonly { label: string; code: number | "PRO" }[] = [
  { label: "VERB", code: DSKY_KEYS.VERB },
  { label: "NOUN", code: DSKY_KEYS.NOUN },
  { label: "+", code: DSKY_KEYS.PLUS },
  { label: "-", code: DSKY_KEYS.MINUS },
  { label: "0", code: DSKY_KEYS.ZERO },
  { label: "7", code: DSKY_KEYS.SEVEN },
  { label: "8", code: DSKY_KEYS.EIGHT },
  { label: "9", code: DSKY_KEYS.NINE },
  { label: "4", code: DSKY_KEYS.FOUR },
  { label: "5", code: DSKY_KEYS.FIVE },
  { label: "6", code: DSKY_KEYS.SIX },
  { label: "CLR", code: DSKY_KEYS.CLR },
  { label: "1", code: DSKY_KEYS.ONE },
  { label: "2", code: DSKY_KEYS.TWO },
  { label: "3", code: DSKY_KEYS.THREE },
  { label: "PRO", code: "PRO" },
  { label: "KEY\u00A0REL", code: DSKY_KEYS.KEY_REL },
  { label: "ENTR", code: DSKY_KEYS.ENTR },
  { label: "RSET", code: DSKY_KEYS.RSET },
];

const WATCH_CHANNELS = [0o10, 0o11, 0o13, 0o15, 0o32, 0o163] as const;

type Phase = "idle" | "booting-worker" | "loading-wasm" | "loading-rom" | "ready" | "error";

function tapKeys(client: AgcWorkerClient, codes: number[], delayMs = 120) {
  codes.forEach((code, i) => {
    setTimeout(() => client.dskyKeyDown(code), i * delayMs);
  });
}

export function Dsky({ rope, onClient, onSnapshot, onReady, disabled = false, sharedClient = null, sharedReady = null, onKeyPress, compact = false }: {
  rope: RopeImage;
  onClient?: (client: AgcWorkerClient | null) => void;
  onSnapshot?: (snap: StateSnapshot) => void;
  onReady?: (ready: ReadyPayload) => void;
  /** When true, ALL user input into this DSKY is suppressed — the pointer
   *  keys are disabled and the global keyboard listener returns early.
   *  Used by /learn to gate typing until the Worker has minted an attempt
   *  boundary, preventing races where a keypress carries an eventId that
   *  precedes the boundary the lesson attempt is scoped to. */
  disabled?: boolean;
  /** Opt-in: attach to an externally-owned AgcWorkerClient (e.g. from the
   *  shared AgcSessionProvider). When provided, Dsky does NOT create, init,
   *  loadRope, or dispose the client — it only registers a supplementary
   *  listener via `client.addListener(...)`. Set `sharedReady` to the
   *  external ready payload so the phase can settle immediately. */
  sharedClient?: AgcWorkerClient | null;
  sharedReady?: ReadyPayload | null;
  /** Observer for accepted key presses. Fires AFTER the key has been handed
   *  to the AGC worker, so observers can never alter what the AGC sees.
   *  Used by /play to drive the DSKY procedure state machine. */
  onKeyPress?: (code: number | "PRO") => void;
  /** Hide the laboratory diagnostics (channel watch, erasable dump, event
   *  log, provenance) and leave only the DSKY face + keypad. */
  compact?: boolean;
}) {

  const clientRef = useRef<AgcWorkerClient | null>(null);
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [lamps, setLamps] = useState(0);
  const [decoded, setDecoded] = useState<DecodedDsky>(() => makeEmptyDecodedDsky());
  const [ready, setReady] = useState<ReadyPayload | null>(sharedReady);
  const [phase, setPhase] = useState<Phase>(sharedClient ? (sharedReady ? "ready" : "loading-rom") : "idle");
  const [error, setError] = useState<string | null>(null);
  const [erasableBase, setErasableBase] = useState(0o20);
  const [selectedChannel, setSelectedChannel] = useState<number>(0o10);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScaleState] = useState<number>(1);

  // ------- Shared-client mode: attach as supplementary listener only. -------
  useEffect(() => {
    if (!sharedClient) return;
    clientRef.current = sharedClient;
    onClient?.(sharedClient);
    if (typeof window !== "undefined") {
      const w = window as unknown as { __agcTest?: Record<string, unknown> };
      const t = (w.__agcTest ??= { snapshots: 0, workerBoots: 0 });
      t.client = sharedClient;
    }
    // Seed from cached ready if the shared client already booted.
    const cachedReady = sharedReady ?? sharedClient.ready();
    if (cachedReady) {
      setReady(cachedReady);
      setPhase("ready");
    }
    const unsub = sharedClient.addListener({
      onReady: (payload) => {
        setReady(payload);
        onReady?.(payload);
        setPhase("ready");
        if (typeof window !== "undefined") {
          const w = window as unknown as { __agcTest?: Record<string, unknown> };
          if (w.__agcTest) w.__agcTest.ready = payload;
        }
      },
      onSnapshot: (snap) => {
        setSnapshot(snap);
        onSnapshot?.(snap);
        setLamps(snap.lamps);
        setPaused(!snap.running);
        setTimeScaleState(snap.timeScale);
        if (snap.decodedDsky) setDecoded(snap.decodedDsky);
        if (typeof window !== "undefined") {
          const w = window as unknown as { __agcTest?: Record<string, unknown> };
          const t = w.__agcTest;
          if (t) {
            t.snapshot = snap;
            t.snapshots = ((t.snapshots as number) ?? 0) + 1;
          }
        }
      },
      onDsky: (l) => setLamps(l),
      onDskyDecoded: (d) => setDecoded(d),
      onFatalError: (code, message) => {
        setError(`${code}: ${message}`);
        setPhase("error");
      },
    });
    // Ask the worker for a fresh snapshot so late-attached mirrors do not
    // wait for the next coalesced 25 Hz tick to show current state.
    try { sharedClient.requestSnapshot(); } catch { /* ignore */ }
    return () => {
      unsub();
      onClient?.(null);
      clientRef.current = null;
    };
  }, [sharedClient, sharedReady, onClient, onSnapshot, onReady]);

  // ------- Standalone mode: own the client end-to-end. -------
  useEffect(() => {
    if (sharedClient) return;
    setPhase("booting-worker");
    let client: AgcWorkerClient;
    try {
      client = new AgcWorkerClient();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return;
    }
    clientRef.current = client;
    onClient?.(client);
    if (typeof window !== "undefined") {
      const w = window as unknown as { __agcTest?: Record<string, unknown> };
      const t = (w.__agcTest ??= { snapshots: 0, workerBoots: 0 });
      t.workerBoots = ((t.workerBoots as number) ?? 0) + 1;
      t.client = client;
    }
    client.setListeners({
      onReady: (payload) => {
        setReady(payload);
        onReady?.(payload);
        setPhase("ready");
        if (typeof window !== "undefined") {
          const w = window as unknown as { __agcTest?: Record<string, unknown> };
          if (w.__agcTest) w.__agcTest.ready = payload;
        }
      },
      onSnapshot: (snap) => {
        setSnapshot(snap);
        onSnapshot?.(snap);
        setLamps(snap.lamps);
        setPaused(!snap.running);
        setTimeScaleState(snap.timeScale);
        if (snap.decodedDsky) setDecoded(snap.decodedDsky);
        if (typeof window !== "undefined") {
          const w = window as unknown as { __agcTest?: Record<string, unknown> };
          const t = w.__agcTest;
          if (t) {
            t.snapshot = snap;
            t.snapshots = ((t.snapshots as number) ?? 0) + 1;
          }
        }
      },
      onDsky: (l) => setLamps(l),
      onDskyDecoded: (d) => setDecoded(d),
      onFatalError: (code, message) => {
        setError(`${code}: ${message}`);
        setPhase("error");
      },
    });
    setPhase("loading-wasm");
    client.initialize(agcWasmUrl());
    setPhase("loading-rom");
    client.loadRope(rope.id, rope.url, rope.manifestUrl);
    return () => {
      onClient?.(null);
      client.dispose();
      clientRef.current = null;
    };
  }, [sharedClient, rope.id, rope.url, rope.manifestUrl, attempt, onClient, onSnapshot, onReady]);


  // Push erasable-base changes to the worker.
  useEffect(() => {
    clientRef.current?.configure(erasableBase, 16);
  }, [erasableBase]);

  // Test-only atomic published-DSKY identity. Every time the value that
  // renders the visible register digits changes, we bump a monotonic sequence
  // AFTER commit and publish the paired decoded object. Playwright reads the
  // sequence, then the DOM, then the sequence again — retrying if it changed
  // — so it can compare visible+aria state against the exact snapshot that
  // produced them, without artificial latching.
  const publishedSeqRef = useRef(0);
  const dskyRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    publishedSeqRef.current += 1;
    const seq = publishedSeqRef.current;
    if (dskyRootRef.current) {
      dskyRootRef.current.setAttribute("data-snapshot-seq", String(seq));
    }
    if (typeof window !== "undefined") {
      const w = window as unknown as { __agcTest?: Record<string, unknown> };
      const t = w.__agcTest;
      if (t) {
        t.publishedDsky = {
          sequence: seq,
          tickIndex: (t.snapshot as { tickIndex?: number } | undefined)?.tickIndex ?? null,
          decodedDsky: decoded,
        };
      }
    }
  }, [decoded]);


  const onKeyPressRef = useRef(onKeyPress);
  useEffect(() => { onKeyPressRef.current = onKeyPress; }, [onKeyPress]);

  const sendKey = useCallback((code: number | "PRO") => {
    const c = clientRef.current;
    if (!c) return;
    if (code === "PRO") {
      c.proceedKey(true);
      setTimeout(() => c.proceedKey(false), 120);
    } else {
      c.dskyKeyDown(code);
    }
    // Observers run only after the AGC has the keystroke.
    onKeyPressRef.current?.(code);
  }, []);


  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabledRef.current) return;
      const k = e.key.toUpperCase();
      const map: Record<string, number | "PRO"> = {
        "0": DSKY_KEYS.ZERO, "1": DSKY_KEYS.ONE, "2": DSKY_KEYS.TWO, "3": DSKY_KEYS.THREE,
        "4": DSKY_KEYS.FOUR, "5": DSKY_KEYS.FIVE, "6": DSKY_KEYS.SIX, "7": DSKY_KEYS.SEVEN,
        "8": DSKY_KEYS.EIGHT, "9": DSKY_KEYS.NINE,
        "V": DSKY_KEYS.VERB, "N": DSKY_KEYS.NOUN,
        "+": DSKY_KEYS.PLUS, "-": DSKY_KEYS.MINUS,
        "ENTER": DSKY_KEYS.ENTR, "C": DSKY_KEYS.CLR,
        "R": DSKY_KEYS.RSET, "K": DSKY_KEYS.KEY_REL,
        "P": "PRO",
      };
      const code = map[k];
      if (code === undefined) return;
      e.preventDefault();
      sendKey(code);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendKey]);

  const controls = useMemo(() => ({
    run: () => clientRef.current?.resume(),
    pause: () => clientRef.current?.pause(),
    reset: () => clientRef.current?.reset(),
    step: () => clientRef.current?.stepSimulation(1),
    step100: () => clientRef.current?.stepAgcDebug(100),
    lampTest: () => {
      const c = clientRef.current; if (!c) return;
      tapKeys(c, [DSKY_KEYS.VERB, DSKY_KEYS.THREE, DSKY_KEYS.FIVE, DSKY_KEYS.ENTR]);
    },
    metDisplay: () => {
      const c = clientRef.current; if (!c) return;
      tapKeys(c, [
        DSKY_KEYS.VERB, DSKY_KEYS.ONE, DSKY_KEYS.SIX,
        DSKY_KEYS.NOUN, DSKY_KEYS.SIX, DSKY_KEYS.FIVE,
        DSKY_KEYS.ENTR,
      ]);
    },
  }), []);

  const selectedDoc = AGC_CHANNELS.find((c) => c.channel === selectedChannel);
  const channels = snapshot?.channels ?? {};
  const events = snapshot?.recentEvents ?? [];
  const erasableView = snapshot?.erasableWindow ?? [];

  return (
    <div
      ref={dskyRootRef}
      className={
        compact
          ? "grid gap-3"
          : "grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
      }
      data-testid="agc-dsky"
    >
      <div className="rounded border border-neutral-800 bg-neutral-950 p-3 shadow-inner">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">DSKY</h3>
          <span
            data-testid="dsky-phase"
            className={
              "rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest " +
              (phase === "ready"
                ? paused
                  ? "border-amber-500 bg-amber-950/40 text-amber-200"
                  : "border-emerald-600 bg-emerald-950/50 text-emerald-300"
                : phase === "error"
                  ? "border-red-600 bg-red-950/40 text-red-300"
                  : "border-amber-600 bg-amber-950/40 text-amber-300")
            }
          >
            {phase === "ready" ? (paused ? "PAUSED · worker" : "AUTHENTIC · worker") : phase.toUpperCase()}
          </span>
        </div>

        {phase !== "ready" && phase !== "error" && (
          <div className="mb-3 flex items-center gap-2 rounded border border-neutral-800 bg-black/40 px-2 py-2 text-xs text-neutral-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            {phase === "booting-worker" && "Starting AGC worker…"}
            {phase === "loading-wasm" && "Compiling yaAGC WebAssembly (in worker)…"}
            {phase === "loading-rom" && `Loading & verifying rope image ${rope.id}…`}
            {phase === "idle" && "Preparing…"}
          </div>
        )}

        {phase === "error" && (
          <div className="mb-3 rounded border border-red-800 bg-red-950/40 px-2 py-2 text-xs text-red-300">
            <div className="font-mono">AGC worker failed to start.</div>
            <div className="mt-1 text-red-400/80">{error}</div>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2 rounded border border-red-600 bg-red-900/40 px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-red-200 hover:bg-red-800/40"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 md:grid-cols-5">
          {LAMP_LAYOUT.map(({ name, label, color }) => {
            const on = (lamps & DSKY_LAMPS[name]) !== 0;
            const base = "rounded border px-2 py-1 text-center text-[10px] font-mono uppercase tracking-wider transition-colors";
            const cls = on
              ? color === "green"
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-amber-500 bg-amber-500/20 text-amber-200"
              : "border-neutral-800 bg-neutral-900 text-neutral-600";
            return (
              <div key={name} data-testid={`lamp-${name}`} data-on={on ? "1" : "0"} className={`${base} ${cls}`} aria-label={`${label} lamp ${on ? "on" : "off"}`}>
                {label}
              </div>
            );
          })}
        </div>

        <RegistersPanel decoded={decoded} />

        <div className={compact ? "hidden" : undefined}>
        <div className="mt-3 flex flex-wrap items-center gap-1">

          {[
            { label: "Run", onClick: controls.run, testid: "ctl-run" },
            { label: "Pause", onClick: controls.pause, testid: "ctl-pause" },
            { label: "Reset", onClick: controls.reset, testid: "ctl-reset" },
            { label: "Step tick", onClick: controls.step, testid: "ctl-step" },
            { label: "Step 100 AGC", onClick: controls.step100, testid: "ctl-step100" },
            { label: "V35 E · lamp test", onClick: controls.lampTest, testid: "ctl-lamp-test" },
            { label: "V16 N65 E · MET", onClick: controls.metDisplay, testid: "ctl-met" },
          ].map((b) => (
            <button
              key={b.label}
              data-testid={b.testid}
              onClick={b.onClick}
              disabled={phase !== "ready"}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 hover:bg-neutral-800 disabled:opacity-40"
            >
              {b.label}
            </button>
          ))}
          <label htmlFor="tscale" className="ml-2 text-[10px] uppercase tracking-widest text-neutral-500">Time scale</label>
          <select
            id="tscale"
            data-testid="ctl-timescale"
            value={timeScale}
            disabled={phase !== "ready"}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTimeScaleState(v);
              clientRef.current?.setTimeScale(v);
            }}
            className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-[11px] text-neutral-200"
          >
            {TIME_SCALES.map((s) => (
              <option key={s} value={s}>{s === 0 ? "PAUSE" : `${s}×`}</option>
            ))}
          </select>
        </div>


        <div className="mt-3 grid gap-1 font-mono text-xs text-neutral-400">
          {WATCH_CHANNELS.map((c) => {
            const v = channels[c] ?? 0;
            return (
              <div
                key={c}
                className={
                  "rounded border px-2 py-1 " +
                  (c === selectedChannel
                    ? "border-emerald-700 bg-emerald-950/30"
                    : "border-neutral-800 bg-black/50")
                }
              >
                <button
                  onClick={() => setSelectedChannel(c)}
                  className="mr-2 text-neutral-500 hover:text-neutral-200"
                >
                  CH 0{c.toString(8)}
                </button>
                <span className="text-emerald-400">{v.toString(2).padStart(15, "0")}</span>
                <span className="ml-2 text-neutral-600">0{v.toString(8).padStart(5, "0")}</span>
              </div>
            );
          })}
        </div>

        {selectedDoc && (
          <div className="mt-2 rounded border border-neutral-800 bg-black/40 px-2 py-1 text-[11px] text-neutral-400">
            <span className="text-neutral-500">selected 0{selectedChannel.toString(8)} · {selectedDoc.direction}: </span>
            <span className="text-neutral-200">{selectedDoc.name}</span>
            <div className="text-neutral-500">{selectedDoc.notes}</div>
          </div>
        )}

        <div className="mt-3 rounded border border-neutral-800 bg-black/50 p-2 font-mono text-[11px] text-neutral-400">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-neutral-500 uppercase tracking-widest">Erasable memory</span>
            <label htmlFor="erabase" className="text-neutral-500">base</label>
            <input
              id="erabase"
              type="number"
              min={0}
              max={2032}
              step={16}
              value={erasableBase}
              onChange={(e) => setErasableBase(Math.max(0, Math.min(2032, Number(e.target.value) | 0)))}
              className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-neutral-200"
            />
            <span className="text-neutral-600">(TIME1=0o25, TIME2=0o24)</span>
          </div>
          <div className="grid grid-cols-8 gap-x-2 gap-y-0.5">
            {erasableView.map((w, i) => (
              <div key={i}>
                <span className="text-neutral-600">0{(erasableBase + i).toString(8).padStart(4, "0")}</span>{" "}
                <span className="text-emerald-400">0{w.toString(8).padStart(5, "0")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded border border-neutral-800 bg-black/50 p-2 font-mono text-[11px]">
          <div className="mb-1 text-neutral-500 uppercase tracking-widest">Recent channel events</div>
          <div className="max-h-32 overflow-auto">
            {events.map((e) => (
              <div key={e.seq} className={e.channel === selectedChannel ? "text-emerald-300" : "text-neutral-500"}>
                #{e.seq.toString().padStart(6, "0")} · 0{e.channel.toString(8)} ← 0{e.value.toString(8).padStart(5, "0")}
              </div>
            ))}
            {events.length === 0 && <div className="text-neutral-600">No events yet.</div>}
          </div>
        </div>

        <div className="mt-3 space-y-1 text-[11px] text-neutral-500">
          {ready && (
            <>
              <div>emulator: <span className="text-neutral-300">{ready.emulatorRepo}@{ready.emulatorCommit.slice(0, 10)}</span> ({ready.emulatorVersionString || "no version"})</div>
              <div>rope: {ready.ropeId} ({ready.ropeByteLength.toLocaleString()} bytes)</div>
              <div>rope source commit: <span className="text-neutral-400">{ready.ropeSourceCommit.slice(0, 10) || "unknown"}</span></div>
              <div>rope SHA-256: <span className="text-emerald-400">match</span> <span className="ml-2 text-neutral-600">{ready.ropeSha256.slice(0, 16)}…</span></div>
              <div data-testid="agc-met">MET µs: <span className="text-neutral-300">{snapshot?.missionTimeUs ?? 0}</span> · steps: {(snapshot?.totalAgcSteps ?? 0).toLocaleString()} · scale: {snapshot?.timeScale ?? 1}× · {snapshot?.running ? "running" : "paused"}</div>
            </>
          )}
        </div>
        </div>
      </div>


      <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
        <div className="grid w-64 grid-cols-4 gap-1" onPointerLeave={releaseAll} onBlur={releaseAll}>
          {KEY_LAYOUT.map(({ label, code }) => (
            <button
              key={label}
              data-testid={`dsky-key-${label.replace(/\s/g, "").toUpperCase()}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                sendKey(code);
              }}
              onPointerUp={(e) => {
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
                if (code === "PRO") clientRef.current?.proceedKey(false);
              }}
              onPointerCancel={releaseAll}
              disabled={phase !== "ready" || disabled}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-3 font-mono text-xs text-neutral-100 hover:border-emerald-500 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-neutral-500">
          Keyboard: 0–9, V, N, +, −, Enter, C, R, K, P (PRO). All key events
          are forwarded to the AGC worker over the typed protocol.
        </p>
        <DskyLiveRegion decoded={decoded} />
      </div>
    </div>
  );
}

function releaseAll(this: unknown) {
  // No-op safety net; the pointerdown handler manages its own capture. Used to
  // stop stateful keys (PRO) if the pointer leaves the keypad mid-press.
}

function seg7Path(seg: number): string {
  // Compact 7-segment SVG for a 22×36 digit cell.
  const S = (bit: number, d: string) => ((seg & (1 << bit)) ? d : "");
  return [
    S(0, "M4 3 H18 L16 5 H6 Z"),        // A
    S(1, "M19 4 L19 17 L17 15 L17 6 Z"),// B
    S(2, "M19 19 L19 32 L17 30 L17 21 Z"),// C
    S(3, "M4 33 H18 L16 31 H6 Z"),      // D
    S(4, "M3 19 L5 21 L5 30 L3 32 Z"),  // E
    S(5, "M3 4 L5 6 L5 15 L3 17 Z"),    // F
    S(6, "M4 18 H18 L16 20 H6 L4 18 Z"),// G
  ].join(" ");
}

function DigitCell({ seg, blank }: { seg: number; blank?: boolean }) {
  return (
    <svg viewBox="0 0 22 36" width="18" height="30" aria-hidden="true">
      <rect x="0" y="0" width="22" height="36" fill="transparent" />
      <path d={seg7Path(seg)} fill={blank ? "#1a1a1a" : "#8fff8f"} />
    </svg>
  );
}

function Register({ label, reg, testid }: { label: string; reg: DskyRegister; testid: string }) {
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <span className="w-10 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">{label}</span>
      {reg.sign && (
        <span
          data-testid={`${testid}-sign`}
          className="w-3 text-center font-mono text-sm"
          style={{ color: reg.sign.plus || reg.sign.minus ? "#8fff8f" : "#333" }}
        >
          {reg.sign.plus && reg.sign.minus ? "±" : reg.sign.plus ? "+" : reg.sign.minus ? "−" : "·"}
        </span>
      )}
      {reg.digits.map((d, i) => (
        <DigitCell key={i} seg={d.segments} blank={d.value === null} />
      ))}
    </div>
  );
}

function RegistersPanel({ decoded }: { decoded: DecodedDsky }) {
  return (
    <div className="mt-3 rounded border border-neutral-800 bg-black p-3" data-testid="dsky-registers">
      <div className="grid gap-1.5">
        <div className="flex gap-4">
          <Register label="PROG" reg={decoded.program} testid="reg-prog" />
          <Register label="VERB" reg={decoded.verb} testid="reg-verb" />
          <Register label="NOUN" reg={decoded.noun} testid="reg-noun" />
        </div>
        <Register label="R1" reg={decoded.r1} testid="reg-r1" />
        <Register label="R2" reg={decoded.r2} testid="reg-r2" />
        <Register label="R3" reg={decoded.r3} testid="reg-r3" />
      </div>
    </div>
  );
}

function DskyLiveRegion({ decoded }: { decoded: DecodedDsky }) {
  // Consolidated ARIA live region — the only accessible mirror of DSKY output.
  // MUST derive from the SAME `decoded` value in the SAME React commit as the
  // visible register digits, so screen-reader text and rendered digits never
  // describe different published snapshots. aria-live="polite" already lets the
  // screen reader coalesce naturally; we do not throttle here (throttling let
  // the text and the digits drift onto different snapshots).
  const digits = (r: DskyRegister) =>
    r.digits.map((d) => (d.value === null ? "_" : String(d.value))).join("");
  const sign = (r: DskyRegister) =>
    r.sign?.plus && r.sign?.minus ? "±" : r.sign?.plus ? "+" : r.sign?.minus ? "-" : "";
  const on = Object.entries(decoded.annunciators)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "none";
  const text =
    `Program ${digits(decoded.program)}, Verb ${digits(decoded.verb)}, Noun ${digits(decoded.noun)}. ` +
    `R1 ${sign(decoded.r1)}${digits(decoded.r1)}. R2 ${sign(decoded.r2)}${digits(decoded.r2)}. R3 ${sign(decoded.r3)}${digits(decoded.r3)}. ` +
    `Indicators: ${on}.`;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="dsky-live"
      className="sr-only"
    >
      {text}
    </div>
  );
}


export function LampTestButton({ rope: _rope }: { rope: RopeImage }) {
  return (
    <button
      className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-1 text-xs font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/40"
      onClick={() => {
        const keys = ["V", "3", "5", "Enter"];
        keys.forEach((k, i) =>
          setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })), i * 180),
        );
      }}
    >
      Run lamp test (V35E)
    </button>
  );
}

export type { RopeImage };
export { ropeById };
