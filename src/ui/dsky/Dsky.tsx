// SPDX-License-Identifier: GPL-2.0-or-later
// Milestone-0 DSKY: authentic keys wired to the real emulator, lamps driven
// by real channels 011 + 0163. Register 7-segment decoding is deliberately
// deferred to Milestone 2 — the raw channel-010 relay stream is shown in a
// diagnostic strip so the emulator's output is visible without pretending
// to render segments that aren't decoded yet.

import { useEffect, useRef, useState } from "react";
import { AgcCoreAdapter } from "@/sim/agc/AgcCoreAdapter";
import { AGC_WASM_URL, ropeById, type RopeImage } from "@/sim/agc/roms";
import { DSKY_KEYS, DSKY_LAMPS } from "@/sim/agc/AgcChannelRegistry";

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

interface Status {
  version: string;
  ropeSha: string;
  ropeExpected: string;
  ropeMatch: boolean;
  bytes: number;
  running: boolean;
  steps: number;
}

export function Dsky({ rope }: { rope: RopeImage }) {
  const adapterRef = useRef<AgcCoreAdapter | null>(null);
  const [lamps, setLamps] = useState(0);
  const [ch, setCh] = useState<Record<number, number>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [erasablePeek, setErasablePeek] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    const adapter = new AgcCoreAdapter({
      onDskyLampsUpdate: (bits) => setLamps(bits),
      onChannelUpdate: (channel, value) =>
        setCh((prev) => (prev[channel] === value ? prev : { ...prev, [channel]: value })),
    });
    adapterRef.current = adapter;

    (async () => {
      try {
        await adapter.init(AGC_WASM_URL);
        const info = await adapter.loadRom(rope.url);
        adapter.reset();
        adapter.oscillate(1);

        // Read a known erasable location (0o25 = TIME1, low half of MET counter)
        // as proof-of-life for erasable access. Refreshed on a slow tick.
        const tick = setInterval(() => {
          if (cancelled) return;
          const era = adapter.erasable();
          const time1 = era[0o25] ?? 0;
          const time2 = era[0o24] ?? 0;
          setErasablePeek(
            `TIME1(0o25)=${time1.toString(8).padStart(5, "0")} TIME2(0o24)=${time2.toString(8).padStart(5, "0")}`,
          );
          setStatus((s) => (s ? { ...s, steps: adapter.totalCpuSteps(), running: adapter.running() } : s));
        }, 250);

        if (cancelled) {
          clearInterval(tick);
          return;
        }

        setStatus({
          version: adapter.version() || "unknown",
          ropeSha: info.sha256,
          ropeExpected: rope.sha256,
          ropeMatch: info.sha256 === rope.sha256,
          bytes: info.bytes,
          running: adapter.running(),
          steps: adapter.totalCpuSteps(),
        });

        // Clean up interval on unmount
        return () => clearInterval(tick);
      } catch (e) {
        console.error("AGC init failed", e);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      adapter.stopOscillator();
    };
  }, [rope.url, rope.sha256]);

  // Keyboard bindings for a technical audience — no on-screen hints beyond
  // the labeled buttons.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const a = adapterRef.current;
      if (!a) return;
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
      if (code === "PRO") {
        a.proceedKey(true);
        setTimeout(() => a.proceedKey(false), 120);
      } else {
        a.keyPress(code);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function sendKey(code: number | "PRO") {
    const a = adapterRef.current;
    if (!a) return;
    if (code === "PRO") {
      a.proceedKey(true);
      setTimeout(() => a.proceedKey(false), 120);
    } else {
      a.keyPress(code);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      {/* Left: lamps + register/diagnostic strip */}
      <div className="rounded border border-neutral-800 bg-neutral-950 p-3 shadow-inner">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
          DSKY (real emulator output)
        </h3>

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

        <div className="mt-3 grid gap-2 font-mono text-xs text-neutral-400">
          <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
            <span className="text-neutral-500">CH 010 (relay word) </span>
            <span className="text-emerald-400">{(ch[0o10] ?? 0).toString(2).padStart(15, "0")}</span>
          </div>
          <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
            <span className="text-neutral-500">CH 011 (lamps+eng) </span>
            <span className="text-emerald-400">{(ch[0o11] ?? 0).toString(2).padStart(15, "0")}</span>
          </div>
          <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
            <span className="text-neutral-500">CH 013 (misc)      </span>
            <span className="text-emerald-400">{(ch[0o13] ?? 0).toString(2).padStart(15, "0")}</span>
          </div>
          <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
            <span className="text-neutral-500">CH 0163 (blinking) </span>
            <span className="text-emerald-400">{(ch[0o163] ?? 0).toString(2).padStart(15, "0")}</span>
          </div>
          <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1">
            <span className="text-neutral-500">erasable peek </span>
            <span className="text-emerald-400">{erasablePeek}</span>
          </div>
        </div>

        <div className="mt-3 space-y-1 text-[11px] text-neutral-500">
          {error && <div className="text-red-400">Error: {error}</div>}
          {status && (
            <>
              <div>yaAGC commit: <span className="text-neutral-300">{status.version}</span></div>
              <div>rope: {rope.id} ({status.bytes.toLocaleString()} bytes)</div>
              <div>
                rope SHA-256:{" "}
                <span className={status.ropeMatch ? "text-emerald-400" : "text-red-400"}>
                  {status.ropeMatch ? "match" : "MISMATCH"}
                </span>
                <span className="ml-2 text-neutral-600">{status.ropeSha.slice(0, 16)}…</span>
              </div>
              <div>CPU steps: {status.steps.toLocaleString()} — {status.running ? "running" : "paused"}</div>
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
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-3 font-mono text-xs text-neutral-100 hover:border-emerald-500 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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

export function LampTestButton({ rope }: { rope: RopeImage }) {
  return (
    <button
      className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-1 text-xs font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/40"
      onClick={() => {
        // V35E — the DSKY lamp test verb. Real AGC handles this; the UI does
        // not fake it. We type it via the same key-injection path as a human
        // operator would use.
        const ev = new KeyboardEvent("keydown", { key: "V" });
        window.dispatchEvent(ev);
        setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" })), 200);
        setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "5" })), 400);
        setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })), 600);
      }}
    >
      Run lamp test (V35E)
    </button>
  );
}

// Re-export so /sim can use it without threading the type through props.
export type { RopeImage };
export { ropeById };
