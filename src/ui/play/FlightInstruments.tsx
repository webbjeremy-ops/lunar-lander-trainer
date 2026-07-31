// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Flight instrument cluster (presentation only).

import type { LunarFlightState, LunarGuidanceCue, LunarOrbitalValues } from "@/simulation/lunar2d";
import type { AssistanceLevel, LandingLimits } from "@/game/play";

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
  const tiltDeg = (flight.attitudeRad * 180) / Math.PI;
  const fuelFraction = initialPropellantKg > 0 ? flight.descentPropellantKg / initialPropellantKg : 0;

  return (
    <div className="space-y-2" data-testid="play-instruments">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Readout
          label="Altitude"
          value={orbit.altitudeM >= 1000 ? (orbit.altitudeM / 1000).toFixed(2) : orbit.altitudeM.toFixed(0)}
          unit={orbit.altitudeM >= 1000 ? "km" : "m"}
          testid="inst-altitude"
        />
        <Readout
          label="Sink rate"
          value={sink.toFixed(1)}
          unit="m/s"
          tone={sink > limits.verticalSpeedMps && orbit.altitudeM < 60 ? "danger" : sink > 25 ? "warn" : "normal"}
          testid="inst-sink"
        />
        <Readout
          label="Lateral"
          value={lateral.toFixed(1)}
          unit="m/s"
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
          value={Math.abs(downrangeM) >= 1000 ? (downrangeM / 1000).toFixed(2) : downrangeM.toFixed(0)}
          unit={Math.abs(downrangeM) >= 1000 ? "km" : "m"}
          tone={Math.abs(downrangeM) < limits.landingZoneRadiusM ? "good" : "normal"}
          testid="inst-range"
        />
        <Readout label="Vehicle mass" value={massKg.toFixed(0)} unit="kg" />
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
            target sink {(-guidance.targetRadialSpeedMps).toFixed(1)} m/s · throttle{" "}
            {(guidance.recommendedThrottle * 100).toFixed(0)}% · pitch{" "}
            {((guidance.recommendedAttitudeRad * 180) / Math.PI).toFixed(0)}°
          </div>
        )}
      </div>

      <div className="rounded border border-neutral-800 bg-black/40 px-2 py-1.5 text-[10px] text-neutral-500">
        Gear limits ({assistance}): ≤ {limits.verticalSpeedMps} m/s vertical, ≤{" "}
        {limits.horizontalSpeedMps} m/s lateral, ≤{" "}
        {((limits.tiltRad * 180) / Math.PI).toFixed(0)}° tilt.
      </div>
    </div>
  );
}
