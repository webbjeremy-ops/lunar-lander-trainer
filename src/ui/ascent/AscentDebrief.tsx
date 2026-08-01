// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Post-flight debrief for the lunar-ascent game.

import {
  ASCENT_TEACHING_NOTES,
  NMI_M,
  type AscentMissionDefinition,
  type AscentScore,
  type AscentSummary,
} from "@/game/ascent";

export function AscentDebrief({
  mission,
  summary,
  score,
  onRestart,
  onChangeMission,
}: {
  mission: AscentMissionDefinition;
  summary: AscentSummary;
  score: AscentScore;
  onRestart: () => void;
  onChangeMission: () => void;
}) {
  const t = summary.target;
  const gradeColor =
    score.grade === "A" || score.grade === "B"
      ? "text-emerald-300 border-emerald-700"
      : score.grade === "F"
        ? "text-red-300 border-red-800"
        : "text-amber-300 border-amber-700";

  return (
    <section
      className="rounded border border-neutral-800 bg-neutral-950 p-4"
      data-testid="ascent-debrief"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded border px-3 py-1 font-mono text-2xl ${gradeColor}`}
          data-testid="ascent-grade"
        >
          {score.grade}
        </span>
        <div>
          <div className="text-lg text-neutral-100" data-testid="ascent-headline">
            {score.headline}
          </div>
          <div className="font-mono text-[11px] text-neutral-500">
            {mission.title} · {summary.assistance} ·{" "}
            <span data-testid="ascent-outcome">{summary.outcome}</span> ·{" "}
            {score.total.toFixed(1)} / {score.maxTotal}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onRestart}
            data-testid="ascent-restart"
            className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-emerald-200 hover:bg-emerald-900/40"
          >
            Fly again
          </button>
          <button
            onClick={onChangeMission}
            data-testid="ascent-change-mission"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
          >
            Missions
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
            Score
          </h3>
          <table className="w-full font-mono text-[11px]">
            <tbody>
              {score.components.map((c) => (
                <tr key={c.id} className="border-b border-neutral-900">
                  <td className="py-1 pr-2 text-neutral-300">{c.label}</td>
                  <td className="py-1 pr-2 text-right text-neutral-100">
                    {c.points.toFixed(1)}/{c.maxPoints}
                  </td>
                  <td className="py-1 text-[10px] leading-snug text-neutral-500">
                    {c.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
            Your orbit versus the target
          </h3>
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-neutral-600">
                <th className="text-left">Quantity</th>
                <th className="text-right">Flown</th>
                <th className="text-right">Target</th>
              </tr>
            </thead>
            <tbody className="text-neutral-200">
              <Row
                label="Periapsis"
                a={`${(summary.periapsisAltitudeM / 1000).toFixed(1)} km`}
                b={`${(t.periapsisAltitudeM / 1000).toFixed(1)} km`}
              />
              <Row
                label="Apoapsis"
                a={
                  summary.apoapsisAltitudeM === null
                    ? "unbound"
                    : `${(summary.apoapsisAltitudeM / 1000).toFixed(1)} km`
                }
                b={`${(t.apoapsisAltitudeM / 1000).toFixed(1)} km`}
              />
              <Row
                label="In nautical miles"
                a={
                  summary.apoapsisAltitudeM === null
                    ? "—"
                    : `${(summary.periapsisAltitudeM / NMI_M).toFixed(0)} × ${(summary.apoapsisAltitudeM / NMI_M).toFixed(0)}`
                }
                b={`${(t.periapsisAltitudeM / NMI_M).toFixed(0)} × ${(t.apoapsisAltitudeM / NMI_M).toFixed(0)}`}
              />
              <Row
                label="Burn duration"
                a={
                  summary.cutoffMissionTimeUs === null
                    ? "—"
                    : `${(summary.cutoffMissionTimeUs / 1_000_000).toFixed(1)} s`
                }
                b="~7 min (Apollo 11)"
              />
              <Row
                label="Cutoff altitude"
                a={
                  summary.cutoffAltitudeM === null
                    ? "—"
                    : `${(summary.cutoffAltitudeM / 1000).toFixed(1)} km`
                }
                b="—"
              />
              <Row
                label="APS propellant left"
                a={`${summary.ascentPropellantRemainingKg.toFixed(0)} kg`}
                b={`of ${summary.ascentPropellantInitialKg.toFixed(0)} kg`}
              />
              <Row
                label="Remaining Δv"
                a={`${summary.deltaVRemainingMps.toFixed(0)} m/s`}
                b="—"
              />
              <Row label="Staged" a={summary.staged ? "yes" : "no"} b="required" />
            </tbody>
          </table>
          <p className="mt-1 text-[10px] leading-snug text-neutral-600">
            The Apollo 11 comparison column is the published target orbit and burn
            duration, not a claim that this trajectory reproduces Eagle's.
          </p>
        </div>
      </div>

      {score.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {score.notes.map((n, i) => (
            <li
              key={i}
              className="rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-200/90"
            >
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <h3 className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
          What this flight taught
        </h3>
        <div className="grid gap-2 md:grid-cols-2">
          {ASCENT_TEACHING_NOTES.map((n) => (
            <details
              key={n.id}
              className="rounded border border-neutral-800 bg-black/40 px-2 py-1.5"
              data-testid={`teaching-${n.id}`}
            >
              <summary className="cursor-pointer text-[11px] text-neutral-200">
                {n.question}
              </summary>
              <p className="mt-1 text-[11px] leading-snug text-neutral-400">{n.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-b border-neutral-900">
      <td className="py-1 pr-2 text-neutral-400">{label}</td>
      <td className="py-1 pr-2 text-right">{a}</td>
      <td className="py-1 text-right text-neutral-500">{b}</td>
    </tr>
  );
}
