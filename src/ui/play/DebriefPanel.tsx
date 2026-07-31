// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Post-flight debrief (presentation only).

import type { FlightSummary, MissionScore, MissionDefinition } from "@/game/play";
import {
  APOLLO11_DESCENT_PHASE_ANCHORS,
  RECONSTRUCTION_DISCLAIMER,
  buildContactComparison,
} from "@/content/apollo11PoweredDescentReference";

export function DebriefPanel({
  mission,
  summary,
  score,
  onRestart,
  onChangeMission,
}: {
  mission: MissionDefinition;
  summary: FlightSummary;
  score: MissionScore;
  onRestart: () => void;
  onChangeMission: () => void;
}) {
  const td = summary.finalState.touchdown;
  const tone =
    score.outcome === "landed"
      ? "border-emerald-600 text-emerald-300"
      : score.outcome === "hard-landing"
        ? "border-amber-600 text-amber-300"
        : "border-red-700 text-red-300";

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-4" data-testid="debrief">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">
            {mission.title} · debrief
          </div>
          <h2 className={`text-xl font-semibold ${tone.split(" ")[1]}`} data-testid="debrief-headline">
            {score.headline}
          </h2>
        </div>
        <div className={`rounded border px-3 py-2 text-center ${tone}`}>
          <div className="font-mono text-3xl" data-testid="debrief-grade">{score.grade}</div>
          <div className="text-[10px] uppercase tracking-widest">
            {score.total} / {score.maxTotal}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {score.components.map((c) => (
          <div key={c.id} className="rounded border border-neutral-800 bg-black/50 px-2 py-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-300">{c.label}</span>
              <span className="font-mono text-neutral-100">
                {c.points} / {c.maxPoints}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded bg-neutral-900">
              <div
                className="h-1.5 rounded bg-emerald-500"
                style={{ width: `${(c.points / c.maxPoints) * 100}%` }}
              />
            </div>
            <div className="mt-1 font-mono text-[10px] text-neutral-500">{c.note}</div>
          </div>
        ))}
      </div>

      {td && (
        <div className="mt-3 rounded border border-neutral-800 bg-black/50 px-2 py-1.5 font-mono text-[11px] text-neutral-400">
          contact at T+{(td.missionTimeUs / 1_000_000).toFixed(1)} s ·{" "}
          {Math.abs(td.verticalSpeedMps).toFixed(2)} m/s down ·{" "}
          {Math.abs(td.horizontalSpeedMps).toFixed(2)} m/s lateral ·{" "}
          {((td.tiltRad * 180) / Math.PI).toFixed(1)}° tilt
          {td.violations.length > 0 && (
            <span className="text-red-300"> · violations: {td.violations.join(", ")}</span>
          )}
        </div>
      )}

      {summary.takeover && (
        <div className="mt-2 rounded border border-neutral-800 bg-black/50 px-2 py-1.5 font-mono text-[11px] text-neutral-400">
          manual takeover at {summary.takeover.altitudeM.toFixed(0)} m ·{" "}
          {summary.takeover.descentPropellantKg.toFixed(0)} kg remaining
          {summary.takeover.early && <span className="text-amber-300"> · early takeover</span>}
        </div>
      )}

      <div
        className="mt-3 rounded border border-sky-900/70 bg-sky-950/20 px-2 py-2"
        data-testid="debrief-historical"
      >
        <div className="text-[10px] uppercase tracking-widest text-sky-300">
          Apollo 11 comparison
        </div>
        <div className="mt-1 font-mono text-[10px] leading-tight text-neutral-500">
          {RECONSTRUCTION_DISCLAIMER}
        </div>
        <table className="mt-2 w-full font-mono text-[11px]">
          <thead>
            <tr className="text-neutral-500">
              <th className="text-left font-normal">measure</th>
              <th className="text-right font-normal">Apollo 11</th>
              <th className="text-right font-normal">you</th>
            </tr>
          </thead>
          <tbody>
            {buildContactComparison({
              descentRateMps: td?.verticalSpeedMps ?? 0,
              horizontalSpeedMps: td?.horizontalSpeedMps ?? 0,
              altitudeM: summary.takeover?.altitudeM,
            }).map((r) => (
              <tr key={r.id} className="text-neutral-300">
                <td className="py-0.5">{r.label}</td>
                <td className="py-0.5 text-right text-sky-200">{r.historical}</td>
                <td className="py-0.5 text-right text-neutral-100">{r.player}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 grid gap-1 md:grid-cols-2">
          {APOLLO11_DESCENT_PHASE_ANCHORS.map((a) => (
            <div key={a.id} className="font-mono text-[10px] text-neutral-500">
              GET {a.get} · {a.label}
              {a.altitudeFt !== undefined ? ` · ${a.altitudeFt.toLocaleString()} ft` : ""}
            </div>
          ))}
        </div>
      </div>



      <ul className="mt-3 space-y-1 text-xs text-neutral-300">
        {score.notes.map((n, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-neutral-600">▸</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onRestart}
          data-testid="debrief-retry"
          className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-emerald-200 hover:bg-emerald-900/40"
        >
          Fly it again
        </button>
        <button
          onClick={onChangeMission}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          Choose another mission
        </button>
      </div>
    </div>
  );
}
