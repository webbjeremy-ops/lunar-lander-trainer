// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Flight instrument cluster (presentation only).

import type { LunarFlightState, LunarGuidanceCue, LunarOrbitalValues } from "@/simulation/lunar2d";
import type { AssistanceLevel, LandingLimits } from "@/game/play";
import { useAppSettings } from "@/settings/SettingsProvider";
import { formatDistance, formatMass, speedUnitLabel, M_PER_FT } from "@/settings/units";


function Readout({
  label,
  value,
  unit,
  tone = "normal",
  testid,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "normal" | "warn" | "danger" | "good";
  testid?: string;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "good"
          ? "text-emerald-300"
          : "text-neutral-100";
  return (
    <div className="rounded border border-neutral-800 bg-black/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className={`font-mono text-lg leading-tight ${toneCls}`} data-testid={testid}>
        {value}
        {unit && <span className="ml-1 text-[10px] text-neutral-500">{unit}</span>}
      </div>
    </div>
  );
}

function Bar({ label, fraction, tone }: { label: string; fraction: number; tone: string }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-widest text-neutral-500">
        <span>{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full rounded bg-neutral-900">
        <div className={`h-2 rounded ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function FlightInstruments({
  flight,
  orbit,
  guidance,
  massKg,
  downrangeM,
  throttle,
  limits,
  assistance,
  initialPropellantKg,
}: {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  guidance: LunarGuidanceCue;
  massKg: number;
  downrangeM: number;
  throttle: number;
  limits: LandingLimits;
  assistance: AssistanceLevel;
  initialPropellantKg: number;
}) {
  const sink = -orbit.radialSpeedMps;
  const lateral = Math.abs(orbit.tangentialSpeedMps);
  const tiltDeg = (-flight.attitudeRad * 180) / Math.PI;
  const fuelFraction = initialPropellantKg > 0 ? flight.descentPropellantKg / initialPropellantKg : 0;

  const units = useAppSettings().units;
  const speedUnit = speedUnitLabel(units);
  const conv = (mps: number) => (units === "apollo" ? mps / M_PER_FT : mps);

  return (
    <div className="space-y-2" data-testid="play-instruments">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Readout
          label="Altitude"
          value={formatDistance(orbit.altitudeM, units, 0)}
          testid="inst-altitude"
        />
        <Readout
          label="Sink rate"
          value={conv(sink).toFixed(1)}
          unit={speedUnit}
          tone={sink > limits.verticalSpeedMps && orbit.altitudeM < 60 ? "danger" : sink > 25 ? "warn" : "normal"}
          testid="inst-sink"
        />
        <Readout
          label="Lateral"
          value={conv(lateral).toFixed(1)}
          unit={speedUnit}
          tone={lateral > limits.horizontalSpeedMps && orbit.altitudeM < 60 ? "danger" : "normal"}
          testid="inst-lateral"
        />
        <Readout
          label="Attitude"
          value={`${tiltDeg >= 0 ? "+" : ""}${tiltDeg.toFixed(1)}`}
          unit="° from vertical"
          tone={Math.abs(tiltDeg) > 60 ? "warn" : "normal"}
        />
        <Readout
          label="Range to LZ"
          value={formatDistance(downrangeM, units, 0)}
          tone={Math.abs(downrangeM) < limits.landingZoneRadiusM ? "good" : "normal"}
          testid="inst-range"
        />
        <Readout label="Vehicle mass" value={formatMass(massKg, units, 0)} />
      </div>

      <div className="grid gap-2 rounded border border-neutral-800 bg-black/40 px-2 py-2">
        <Bar
          label="Descent propellant"
          fraction={fuelFraction}
          tone={fuelFraction < 0.08 ? "bg-red-500" : fuelFraction < 0.2 ? "bg-amber-500" : "bg-emerald-500"}
        />
        <Bar label="Throttle" fraction={throttle} tone="bg-sky-500" />
      </div>

      <div className="rounded border border-neutral-800 bg-black/40 px-2 py-1.5 text-[11px]">
        <div className="text-[9px] uppercase tracking-widest text-neutral-500">
          Guidance cue · advisory only ({assistance})
        </div>
        <div className="font-mono text-emerald-300">{guidance.advisory}</div>
        {assistance !== "commander" && (
          <div className="mt-1 font-mono text-neutral-400">
            target sink {conv(-guidance.targetRadialSpeedMps).toFixed(1)} {speedUnit} · throttle{" "}
            {(guidance.recommendedThrottle * 100).toFixed(0)}% · pitch{" "}
            {((guidance.recommendedAttitudeRad * 180) / Math.PI).toFixed(0)}°
          </div>
        )}
      </div>

      <div className="rounded border border-neutral-800 bg-black/40 px-2 py-1.5 text-[10px] text-neutral-400">
        Gear limits ({assistance}): ≤ {conv(limits.verticalSpeedMps).toFixed(1)} {speedUnit}{" "}
        vertical, ≤ {conv(limits.horizontalSpeedMps).toFixed(1)} {speedUnit} lateral, ≤{" "}
        {((limits.tiltRad * 180) / Math.PI).toFixed(0)}° tilt.
      </div>

    </div>
  );
}
