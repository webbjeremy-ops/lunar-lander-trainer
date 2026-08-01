// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Manoeuvre planning panel.
//
// The planner is advisory. Nothing in this panel changes the vehicle state
// except the explicit IGNITE / CUTOFF buttons, which the player must press.

import { useMemo } from "react";
import type {
  GuidedSolution,
  ImpulsivePreview,
  ManeuverNode,
  OrbitScenario,
  PhasingRecommendation,
} from "@/simulation/orbitOps";
import { EDUCATIONAL_MANEUVER_LABEL } from "@/simulation/orbitOps";
import type { OrbitAssistance, OrbitNodeDraft } from "./useOrbitSession";

const DIRECTIONS: readonly { id: ManeuverNode["direction"]; label: string }[] = [
  { id: "prograde", label: "Prograde" },
  { id: "retrograde", label: "Retrograde" },
  { id: "radial-out", label: "Radial out" },
  { id: "radial-in", label: "Radial in" },
];

function km(m: number | null): string {
  return m === null || !Number.isFinite(m) ? "—" : `${(m / 1000).toFixed(2)} km`;
}

export function ManeuverPlannerPanel({
  scenario,
  assistance,
  draft,
  node,
  preview,
  guided,
  phasing,
  burning,
  missionTimeUs,
  onDraft,
  onCommit,
  onClear,
  onAdopt,
  onIgnite,
  onCutoff,
}: {
  scenario: OrbitScenario;
  assistance: OrbitAssistance;
  draft: OrbitNodeDraft;
  node: ManeuverNode | null;
  preview: ImpulsivePreview | null;
  guided: readonly GuidedSolution[];
  phasing: PhasingRecommendation | null;
  burning: boolean;
  missionTimeUs: number;
  onDraft: (d: Partial<OrbitNodeDraft>) => void;
  onCommit: () => void;
  onClear: () => void;
  onAdopt: (s: GuidedSolution) => void;
  onIgnite: () => void;
  onCutoff: () => void;
}) {
  const showGuided = assistance !== "commander";
  const showPhasing =
    showGuided && scenario.availableControls.includes("phasing-planner");

  const countdownS = useMemo(
    () => (node === null ? null : (node.ignitionTimeUs - missionTimeUs) / 1_000_000),
    [node, missionTimeUs],
  );

  return (
    <section
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="maneuver-planner"
      aria-label="Manoeuvre planner"
    >
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
        Manoeuvre planner
      </h3>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-neutral-500">
            Ignition in (s)
          </span>
          <input
            type="number"
            min={0}
            step={5}
            value={draft.leadSeconds}
            onChange={(e) => onDraft({ leadSeconds: Number(e.target.value) })}
            data-testid="node-lead"
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100"
          />
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-neutral-500">
            Direction
          </span>
          <select
            value={draft.direction}
            onChange={(e) =>
              onDraft({ direction: e.target.value as ManeuverNode["direction"] })
            }
            data-testid="node-direction"
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100"
          >
            {DIRECTIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-neutral-500">
            Delta-v (m/s)
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={draft.deltaVMps}
            onChange={(e) => onDraft({ deltaVMps: Number(e.target.value) })}
            data-testid="node-deltav"
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCommit}
          data-testid="node-commit"
          className="rounded border border-emerald-700 bg-emerald-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
        >
          Set node
        </button>
        <button
          type="button"
          onClick={onClear}
          data-testid="node-clear"
          className="rounded border border-neutral-700 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
        >
          Clear node
        </button>
        {!burning ? (
          <button
            type="button"
            onClick={onIgnite}
            disabled={node === null || node.deltaVMps <= 0}
            data-testid="burn-ignite"
            className="rounded border border-amber-600 bg-amber-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-900/40 disabled:opacity-40"
          >
            Ignite
          </button>
        ) : (
          <button
            type="button"
            onClick={onCutoff}
            data-testid="burn-cutoff"
            className="rounded border border-rose-600 bg-rose-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-rose-300 hover:bg-rose-900/40"
          >
            Cutoff
          </button>
        )}
        {countdownS !== null && (
          <span
            className="self-center font-mono text-[10px] uppercase tracking-widest text-neutral-400"
            data-testid="node-countdown"
          >
            T{countdownS >= 0 ? "−" : "+"}
            {Math.abs(countdownS).toFixed(0)} s to node
          </span>
        )}
      </div>

      {preview && (
        <div
          className="mt-3 rounded border border-amber-800 bg-amber-950/20 p-2"
          data-testid="impulsive-preview"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-amber-500 px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest text-amber-300">
              {preview.label}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
              {preview.note}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] sm:grid-cols-3">
            <div>
              <dt className="text-neutral-500">Periapsis change</dt>
              <dd className="text-neutral-100">{km(preview.periapsisChangeM)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Apoapsis change</dt>
              <dd className="text-neutral-100">{km(preview.apoapsisChangeM)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Period change</dt>
              <dd className="text-neutral-100">
                {preview.periodChangeS === null
                  ? "—"
                  : `${preview.periodChangeS.toFixed(1)} s`}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Propellant</dt>
              <dd className="text-neutral-100">
                {preview.estimatedPropellantKg.toFixed(1)} kg
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Burn duration</dt>
              <dd className="text-neutral-100">
                {preview.estimatedBurnSeconds.toFixed(1)} s
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Affordable</dt>
              <dd className={preview.affordable ? "text-emerald-300" : "text-rose-300"}>
                {preview.affordable ? "yes" : "no"}
              </dd>
            </div>
          </dl>
          {preview.impactRisk && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-rose-300">
              This plan puts periapsis below the surface.
            </p>
          )}
          <p className="mt-1 text-[10px] text-neutral-500">
            The preview is instantaneous. Your engine is not: the flown burn takes{" "}
            {preview.estimatedBurnSeconds.toFixed(1)} s and will differ slightly.
          </p>
        </div>
      )}

      {showGuided && guided.length > 0 && (
        <div className="mt-3" data-testid="guided-solutions">
          <h4 className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
            Guided solutions · advisory only
          </h4>
          <ul className="mt-1 space-y-1">
            {guided.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded border border-neutral-800 px-2 py-1"
              >
                <span className="font-mono text-[11px] text-neutral-200">{s.title}</span>
                <span className="font-mono text-[10px] text-neutral-500">
                  {s.node.deltaVMps.toFixed(1)} m/s {s.node.direction}
                </span>
                <span className="text-[10px] text-neutral-500">{s.rationale}</span>
                <button
                  type="button"
                  onClick={() => onAdopt(s)}
                  disabled={s.unaffordable}
                  className="ml-auto rounded border border-neutral-700 px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
                >
                  {s.unaffordable ? "Too costly" : "Load"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showPhasing && phasing && (
        <div
          className="mt-3 rounded border border-sky-900 bg-sky-950/20 p-2"
          data-testid="phasing-plan"
        >
          <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">
            Phasing planner · {phasing.confidence}
          </h4>
          {phasing.found ? (
            <p className="mt-1 font-mono text-[11px] text-neutral-200">
              {phasing.deltaVMps.toFixed(1)} m/s {phasing.direction} ·{" "}
              {phasing.revolutions} rev · intercept in{" "}
              {(phasing.timeToInterceptS / 60).toFixed(1)} min · predicted range{" "}
              {km(phasing.predictedRangeM)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11px] text-neutral-400">{phasing.note}</p>
          )}
          <p className="mt-1 text-[10px] text-neutral-500">{phasing.note}</p>
          {phasing.found && (
            <button
              type="button"
              onClick={() =>
                onDraft({
                  direction: phasing.direction,
                  deltaVMps: Number(phasing.deltaVMps.toFixed(2)),
                })
              }
              className="mt-1 rounded border border-sky-700 px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest text-sky-300 hover:bg-sky-900/30"
            >
              Copy to draft
            </button>
          )}
        </div>
      )}

      <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
        {EDUCATIONAL_MANEUVER_LABEL} · planner never fires the engine by itself
      </p>
    </section>
  );
}
