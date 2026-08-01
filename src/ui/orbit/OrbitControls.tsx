// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Time and exercise controls for the orbital-operations cockpit.

import { ORBIT_TIME_SCALES } from "@/simulation/orbitOps";
import type { OrbitAssistance } from "./useOrbitSession";

export function OrbitControls({
  running,
  timeScale,
  maxTimeScale,
  timeScaleReason,
  assistance,
  complete,
  onRunning,
  onTimeScale,
  onRestart,
  onEnd,
  onAssistance,
}: {
  running: boolean;
  timeScale: number;
  maxTimeScale: number;
  timeScaleReason: string | null;
  assistance: OrbitAssistance;
  complete: boolean;
  onRunning: (v: boolean) => void;
  onTimeScale: (v: number) => void;
  onRestart: () => void;
  onEnd: () => void;
  onAssistance: (a: OrbitAssistance) => void;
}) {
  return (
    <section
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="orbit-controls"
      aria-label="Exercise controls"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onRunning(!running)}
          disabled={complete}
          data-testid="orbit-run-toggle"
          className="rounded border border-emerald-700 bg-emerald-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
        >
          {running ? "Pause" : "Run"}
        </button>
        <button
          type="button"
          onClick={onRestart}
          data-testid="orbit-restart"
          className="rounded border border-neutral-700 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={onEnd}
          data-testid="orbit-end"
          className="rounded border border-neutral-700 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
        >
          End exercise
        </button>
      </div>

      <div className="mt-2">
        <span className="block text-[9px] uppercase tracking-widest text-neutral-500">
          Time acceleration
        </span>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Time acceleration">
          {ORBIT_TIME_SCALES.filter((s) => s > 0).map((s) => {
            const blocked = s > maxTimeScale;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onTimeScale(s)}
                disabled={blocked}
                aria-pressed={timeScale === s}
                data-testid={`orbit-time-${s}`}
                className={`rounded border px-2 py-[2px] font-mono text-[10px] ${
                  timeScale === s
                    ? "border-emerald-500 bg-emerald-950/50 text-emerald-300"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                } disabled:opacity-30`}
              >
                {s}×
              </button>
            );
          })}
        </div>
        {timeScaleReason && (
          <p
            className="mt-1 font-mono text-[10px] text-amber-300"
            data-testid="orbit-time-guard"
          >
            {timeScaleReason}
          </p>
        )}
      </div>

      <div className="mt-2">
        <span className="block text-[9px] uppercase tracking-widest text-neutral-500">
          Assistance
        </span>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Assistance level">
          {(["instructor", "pilot", "commander"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onAssistance(a)}
              aria-pressed={assistance === a}
              data-testid={`orbit-assist-${a}`}
              className={`rounded border px-2 py-[2px] font-mono text-[10px] uppercase tracking-widest ${
                assistance === a
                  ? "border-emerald-500 bg-emerald-950/50 text-emerald-300"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">
          Instructor shows cues and pauses near a node; it never flies for you.
        </p>
      </div>
    </section>
  );
}
