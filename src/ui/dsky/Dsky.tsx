// SPDX-License-Identifier: GPL-2.0-or-later
// Milestone-0 DSKY: authentic keys wired to the real emulator, lamps driven
// by real channels 011 + 0163. Register 7-segment decoding is deliberately
// deferred to Milestone 2 — the raw channel-010 relay stream is shown in a
// diagnostic strip so the emulator's output is visible without pretending
// to render segments that aren't decoded yet.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgcCoreAdapter, type ChannelEvent } from "@/sim/agc/AgcCoreAdapter";
import { AGC_WASM_URL, ropeById, type RopeImage } from "@/sim/agc/roms";
import { AGC_CHANNELS, DSKY_KEYS, DSKY_LAMPS } from "@/sim/agc/AgcChannelRegistry";

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

type Phase = "idle" | "loading-wasm" | "loading-rom" | "resetting" | "ready" | "error";

interface Status {
  version: string;
  ropeSha: string;
  ropeExpected: string;
  ropeMatch: boolean;
  bytes: number;
  running: boolean;
  steps: number;
  channelEvents: number;
}

async function tapKeys(a: AgcCoreAdapter, codes: number[], delayMs = 120) {
  for (const c of codes) {
    a.keyPress(c);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function Dsky({ rope }: { rope: RopeImage }) {
  const adapterRef = useRef<AgcCoreAdapter | null>(null);
  const [lamps, setLamps] = useState(0);
  const [ch, setCh] = useState<Record<number, number>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [erasableBase, setErasableBase] = useState(0o20);
  const [erasableView, setErasableView] = useState<number[]>([]);
  const [events, setEvents] = useState<ChannelEvent[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<number>(0o10);
  const [attempt, setAttempt] = useState(0);
  const [ch010Rate, setCh010Rate] = useState(0);
  const ch010LastRef = useRef<{ t: number; count: number }>({ t: 0, count: 0 });

  const boot = useCallback(async () => {
    setError(null);
    setPhase("loading-wasm");
    const adapter = new AgcCoreAdapter({
      onDskyLampsUpdate: (bits) => setLamps(bits),
      onChannelUpdate: (channel, value) =>
        setCh((prev) => (prev[channel] === value ? prev : { ...prev, [channel]: value })),
    });
    adapterRef.current = adapter;
    try {
      await adapter.init(AGC_WASM_URL);
      setPhase("loading-rom");
      const info = await adapter.loadRom(rope.url);
      setPhase("resetting");
      adapter.reset();
      adapter.oscillate(1);
      setPhase("ready");
      setStatus({
        version: adapter.version() || "unknown",
        ropeSha: info.sha256,
        ropeExpected: rope.sha256,
        ropeMatch: info.sha256 === rope.sha256,
        bytes: info.bytes,
        running: adapter.running(),
        steps: adapter.totalCpuSteps(),
        channelEvents: adapter.totalChannelEvents(),
      });
    } catch (e) {
      console.error("AGC init failed", e);
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [rope.url, rope.sha256]);

  useEffect(() => {
    void boot();
    return () => {
      adapterRef.current?.stopOscillator();
      adapterRef.current = null;
    };
  }, [boot, attempt]);

  // Periodic UI refresh (status + erasable + events + ch010 rate meter).
  useEffect(() => {
    const t = setInterval(() => {
      const a = adapterRef.current;
      if (!a) return;
      const era = a.erasable();
      const window = Array.from({ length: 16 }, (_, i) => era[erasableBase + i] ?? 0);
      setErasableView(window);
      setEvents(a.recentEvents(24));

      const totalEv = a.totalChannelEvents();
      const now = performance.now();
      const last = ch010LastRef.current;
      if (last.t) {
        const dt = (now - last.t) / 1000;
        if (dt > 0.4) {
          setCh010Rate((totalEv - last.count) / dt);
          ch010LastRef.current = { t: now, count: totalEv };
        }
      } else {
        ch010LastRef.current = { t: now, count: totalEv };
      }

      setStatus((s) =>
        s
          ? { ...s, steps: a.totalCpuSteps(), running: a.running(), channelEvents: totalEv }
          : s,
      );
    }, 250);
    return () => clearInterval(t);
  }, [erasableBase, phase]);

  const sendKey = useCallback((code: number | "PRO") => {
    const a = adapterRef.current;
    if (!a) return;
    if (code === "PRO") {
      a.proceedKey(true);
      setTimeout(() => a.proceedKey(false), 120);
    } else {
      a.keyPress(code);
    }
  }, []);

  // Keyboard bindings for a technical audience.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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

  // Run / Pause / Reset / Single step
  const controls = useMemo(() => ({
    run: () => adapterRef.current?.oscillate(1),
    pause: () => adapterRef.current?.stopOscillator(),
    reset: () => {
      const a = adapterRef.current;
      if (!a) return;
      a.stopOscillator();
      a.reset();
      a.oscillate(1);
      setLamps(0);
      setCh({});
      setEvents([]);
    },
    step: () => adapterRef.current?.singleStep(1),
    step100: () => adapterRef.current?.singleStep(100),
    lampTest: async () => {
      const a = adapterRef.current; if (!a) return;
      await tapKeys(a, [DSKY_KEYS.VERB, DSKY_KEYS.THREE, DSKY_KEYS.FIVE, DSKY_KEYS.ENTR]);
    },
    metDisplay: async () => {
      // V16 N65 E — MONITOR (V16) DISPLAY MISSION ELAPSED TIME (N65).
      // Success is visible via lamps + a rising channel-010 (relay) event rate.
      const a = adapterRef.current; if (!a) return;
      await tapKeys(a, [
        DSKY_KEYS.VERB, DSKY_KEYS.ONE, DSKY_KEYS.SIX,
        DSKY_KEYS.NOUN, DSKY_KEYS.SIX, DSKY_KEYS.FIVE,
        DSKY_KEYS.ENTR,
      ]);
    },
  }), []);

  const selectedDoc = AGC_CHANNELS.find((c) => c.channel === selectedChannel);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      {/* Left: lamps + register/diagnostic strip */}
      <div className="rounded border border-neutral-800 bg-neutral-950 p-3 shadow-inner">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">DSKY</h3>
          <span
            className={
              "rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest " +
              (phase === "ready"
                ? "border-emerald-600 bg-emerald-950/50 text-emerald-300"
                : phase === "error"
                  ? "border-red-600 bg-red-950/40 text-red-300"
                  : "border-amber-600 bg-amber-950/40 text-amber-300")
            }
            title="Source of DSKY data"
          >
            {phase === "ready" ? "AUTHENTIC · driven by yaAGC I/O" : phase.toUpperCase()}
          </span>
        </div>

        {phase !== "ready" && phase !== "error" && (
          <div className="mb-3 flex items-center gap-2 rounded border border-neutral-800 bg-black/40 px-2 py-2 text-xs text-neutral-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            {phase === "loading-wasm" && "Compiling yaAGC WebAssembly…"}
            {phase === "loading-rom" && `Loading rope image ${rope.id}…`}
            {phase === "resetting" && "Resetting AGC and starting clock…"}
            {phase === "idle" && "Preparing…"}
          </div>
        )}

        {phase === "error" && (
          <div className="mb-3 rounded border border-red-800 bg-red-950/40 px-2 py-2 text-xs text-red-300">
            <div className="font-mono">Failed to start AGC.</div>
            <div className="mt-1 text-red-400/80">{error}</div>
            <div className="mt-1 text-red-500/80">
              Check that <code>/agc/yaAGC.wasm</code> and <code>{rope.url}</code> are served with
              the correct MIME type on this deployment.
            </div>
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
              <div key={name} className={`${base} ${cls}`} aria-label={`${label} lamp ${on ? "on" : "off"}`}>
                {label}
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap gap-1">
          {[
            { label: "Run", onClick: controls.run },
            { label: "Pause", onClick: controls.pause },
            { label: "Reset", onClick: controls.reset },
            { label: "Step 1", onClick: controls.step },
            { label: "Step 100", onClick: controls.step100 },
            { label: "V35 E · lamp test", onClick: controls.lampTest },
            { label: "V16 N65 E · MET", onClick: controls.metDisplay },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.onClick}
              disabled={phase !== "ready"}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 hover:bg-neutral-800 disabled:opacity-40"
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* Watched channels */}
        <div className="mt-3 grid gap-1 font-mono text-xs text-neutral-400">
          {WATCH_CHANNELS.map((c) => {
            const v = ch[c] ?? 0;
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
                  title="Watch this channel"
                >
                  CH 0{c.toString(8)}
                </button>
                <span className="text-emerald-400">{v.toString(2).padStart(15, "0")}</span>
                <span className="ml-2 text-neutral-600">0{v.toString(8).padStart(5, "0")}</span>
              </div>
            );
          })}
        </div>

        {/* Selected channel meta */}
        {selectedDoc && (
          <div className="mt-2 rounded border border-neutral-800 bg-black/40 px-2 py-1 text-[11px] text-neutral-400">
            <span className="text-neutral-500">selected 0{selectedChannel.toString(8)} · {selectedDoc.direction}: </span>
            <span className="text-neutral-200">{selectedDoc.name}</span>
            <div className="text-neutral-500">{selectedDoc.notes}</div>
          </div>
        )}

        {/* Erasable memory inspector */}
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
            <span className="text-neutral-600">
              (TIME1=0o25, TIME2=0o24 — LGC MET counter)
            </span>
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

        {/* Recent channel events log */}
        <div className="mt-3 rounded border border-neutral-800 bg-black/50 p-2 font-mono text-[11px]">
          <div className="mb-1 flex items-center justify-between text-neutral-500 uppercase tracking-widest">
            <span>Recent channel events</span>
            <span className="text-neutral-600 lowercase tracking-normal">
              ch 0{selectedChannel.toString(8)} · ~{Math.round(ch010Rate)} evt/s total
            </span>
          </div>
          <div className="max-h-32 overflow-auto">
            {events.map((e) => (
              <div key={e.seq} className={e.channel === selectedChannel ? "text-emerald-300" : "text-neutral-500"}>
                #{e.seq.toString().padStart(6, "0")} · 0{e.channel.toString(8)} ← 0{e.value.toString(8).padStart(5, "0")}
              </div>
            ))}
            {events.length === 0 && <div className="text-neutral-600">No events yet.</div>}
          </div>
        </div>

        {/* Status footer */}
        <div className="mt-3 space-y-1 text-[11px] text-neutral-500">
          {status && (
            <>
              <div>yaAGC commit: <span className="text-neutral-300">{status.version || "(unreported)"}</span></div>
              <div>rope: {rope.id} ({status.bytes.toLocaleString()} bytes)</div>
              <div>
                rope SHA-256:{" "}
                <span className={status.ropeMatch ? "text-emerald-400" : "text-red-400"}>
                  {status.ropeMatch ? "match" : "MISMATCH"}
                </span>
                <span className="ml-2 text-neutral-600">{status.ropeSha.slice(0, 16)}…</span>
              </div>
              <div>
                CPU steps: {status.steps.toLocaleString()} · channel events: {status.channelEvents.toLocaleString()} · {status.running ? "running" : "paused"}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: authentic key pad */}
      <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
        <div className="grid w-64 grid-cols-4 gap-1">
          {KEY_LAYOUT.map(({ label, code }) => (
            <button
              key={label}
              onClick={() => sendKey(code)}
              disabled={phase !== "ready"}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-3 font-mono text-xs text-neutral-100 hover:border-emerald-500 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-neutral-500">
          Keyboard: 0–9, V, N, +, −, Enter, C, R, K, P (PRO). All key events
          are injected into AGC input channel 0o15 (or 0o32 for PROCEED).
        </p>
      </div>
    </div>
  );
}

export function LampTestButton({ rope: _rope }: { rope: RopeImage }) {
  // Retained as an alias for the header slot; delegates to a keydown so the
  // same path exercised by users is used.
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
