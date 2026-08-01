// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Orbital-operations debrief.

import type {
  DebriefEntry,
  OrbitScenario,
  OrbitScore,
} from "@/simulation/orbitOps";
import {
  INTERCEPT_COMPLETE_LABEL,
  INTERCEPT_CONTINUES_LABEL,
} from "@/simulation/orbitOps";

export function OrbitDebrief({
  scenario,
  score,
  entries,
  banner,
  traceChecksum,
  onRestart,
}: {
  scenario: OrbitScenario;
  score: OrbitScore | null;
  entries: readonly DebriefEntry[];
  banner: readonly string[] | null;
  traceChecksum: number;
  onRestart: () => void;
}) {
  return (
    <section
      className="rounded border border-neutral-700 bg-neutral-950 p-4"
      data-testid="orbit-debrief"
      aria-label="Exercise debrief"
    >
      <h2 className="font-mono text-xs uppercase tracking-widest text-emerald-300">
        Debrief · {scenario.title}
      </h2>

      {banner && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="orbit-terminal-banner">
          {banner.map((b) => (
            <span
              key={b}
              className={`rounded-sm border px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest ${
                b === INTERCEPT_COMPLETE_LABEL
                  ? "border-emerald-500 text-emerald-300"
                  : b === INTERCEPT_CONTINUES_LABEL
                    ? "border-sky-600 text-sky-300"
                    : "border-neutral-600 text-neutral-300"
              }`}
            >
              {b}
            </span>
          ))}
        </div>
      )}

      {score && (
        <>
          <p
            className="mt-3 font-mono text-sm text-neutral-100"
            data-testid="orbit-score"
          >
            {score.total}/{score.maxTotal} points · grade {score.grade} ·{" "}
            {score.passed ? "passed" : "not passed"}
          </p>
          <ul className="mt-2 space-y-1">
            {score.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[11px] text-neutral-300">{l.label}</span>
                <span className="font-mono text-[11px] text-emerald-300">
                  {l.points}/{l.maxPoints}
                </span>
                <span className="text-[11px] text-neutral-500">{l.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {entries.length > 0 && (
        <div className="mt-4 space-y-2">
          {entries.map((e) => (
            <article key={e.heading} className="rounded border border-neutral-800 p-2">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-neutral-300">
                {e.heading}
              </h3>
              <p className="mt-1 text-[12px] leading-snug text-neutral-400">{e.body}</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
                {e.classification}
              </p>
            </article>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRestart}
          data-testid="orbit-debrief-restart"
          className="rounded border border-emerald-700 bg-emerald-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
        >
          Fly it again
        </button>
        <span
          className="font-mono text-[9px] uppercase tracking-widest text-neutral-600"
          data-testid="orbit-trace-checksum"
        >
          trace checksum {traceChecksum.toString(16).padStart(8, "0")}
        </span>
      </div>
    </section>
  );
}
