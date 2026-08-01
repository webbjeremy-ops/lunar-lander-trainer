// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Orbital-operations HUD.
//
// Presentation only. All physics is SI inside the kernel; the units system
// converts for display and never for computation.

import { useAppSettings } from "@/settings/SettingsProvider";
import { formatDistance, formatMass, formatSpeed } from "@/settings/units";
import {
  DANGER_PERIAPSIS_M,
  IMPACT_TRAJECTORY_LABEL,
  closingRateMps,
  type ManeuverNode,
  type OrbitOpsDerived,
  type OrbitOpsState,
  type OrbitScenario,
} from "@/simulation/orbitOps";

function fmtTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</dt>
      <dd className={`font-mono text-xs ${tone ?? "text-neutral-100"}`}>{value}</dd>
    </div>
  );
}

export function OrbitHud({
  scenario,
  state,
  derived,
  node,
  deltaVAvailableMps,
  plannedBurnSeconds,
  massKg,
  activeObjective,
}: {
  scenario: OrbitScenario;
  state: OrbitOpsState;
  derived: OrbitOpsDerived;
  node: ManeuverNode | null;
  deltaVAvailableMps: number;
  plannedBurnSeconds: number | null;
  massKg: number;
  activeObjective: string;
}) {
  const units = useAppSettings().units;
  const el = derived.elements;
  const rel = derived.relative;
  const impact = el.periapsisAltitudeM < 0;
  const danger = !impact && el.periapsisAltitudeM < DANGER_PERIAPSIS_M;

  return (
    <section
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="orbit-hud"
      aria-label="Orbital operations instruments"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
          Orbital instruments
        </span>
        <span className="ml-auto font-mono text-[10px] text-neutral-500" data-testid="orbit-met">
          MET {(state.lm.missionTimeUs / 1_000_000).toFixed(1)} s
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Row label="Altitude" value={formatDistance(el.altitudeM, units, 0)} />
        <Row label="Inertial speed" value={formatSpeed(el.speedMps, units)} />
        <Row label="Radial speed" value={formatSpeed(el.radialSpeedMps, units)} />
        <Row label="Tangential speed" value={formatSpeed(el.tangentialSpeedMps, units)} />
        <Row
          label="Flight-path angle"
          value={`${((el.flightPathAngleRad * 180) / Math.PI).toFixed(2)}°`}
        />
        <Row
          label="Periapsis"
          value={impact ? IMPACT_TRAJECTORY_LABEL : formatDistance(el.periapsisAltitudeM, units, 0)}
          tone={impact ? "text-rose-400" : danger ? "text-amber-300" : "text-neutral-100"}
        />
        <Row
          label="Apoapsis"
          value={el.apoapsisAltitudeM === null ? "—" : formatDistance(el.apoapsisAltitudeM, units, 0)}
        />
        <Row label="Period" value={el.orbitalPeriodS === null ? "—" : fmtTime(el.orbitalPeriodS)} />
        <Row label="To periapsis" value={fmtTime(el.timeToPeriapsisS)} />
        <Row label="To apoapsis" value={fmtTime(el.timeToApoapsisS)} />
        <Row label="Propellant" value={formatMass(state.lm.ascentPropellantKg, units, 1)} />
        <Row label="Delta-v available" value={`${deltaVAvailableMps.toFixed(1)} m/s`} />
        <Row
          label="Planned burn"
          value={node ? `${node.deltaVMps.toFixed(1)} m/s ${node.direction}` : "—"}
        />
        <Row
          label="Planned duration"
          value={plannedBurnSeconds === null ? "—" : `${plannedBurnSeconds.toFixed(1)} s`}
        />
        <Row label="Total mass" value={formatMass(massKg, units, 0)} />
        {rel && (
          <>
            <Row label="Range to CSM" value={formatDistance(rel.rangeM, units, 0)} />
            <Row label="Range rate" value={formatSpeed(rel.rangeRateMps, units)} />
            <Row
              label="Closing rate"
              value={formatSpeed(closingRateMps(rel), units)}
            />
            <Row
              label="Phase angle"
              value={`${((rel.phaseAngleRad * 180) / Math.PI).toFixed(2)}°`}
            />
            <Row label="Closest approach" value={formatDistance(rel.closestApproachM, units, 0)} />
            <Row label="Time to CA" value={fmtTime(rel.timeToClosestApproachS)} />
          </>
        )}
      </dl>

      {impact && (
        <p
          className="mt-2 rounded border border-rose-800 bg-rose-950/40 px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-rose-300"
          data-testid="orbit-impact-warning"
        >
          {IMPACT_TRAJECTORY_LABEL} — periapsis is below the surface
        </p>
      )}

      <p className="mt-2 text-[11px] text-neutral-400" data-testid="orbit-active-objective">
        <span className="text-neutral-500">Objective:</span> {activeObjective}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
        {scenario.fidelityClassification} · SI internally, {units} on screen
      </p>
    </section>
  );
}
