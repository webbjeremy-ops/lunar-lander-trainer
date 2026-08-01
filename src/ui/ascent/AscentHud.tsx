// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Orbital HUD for the lunar-ascent cockpit.
//
// Every number here is derived from the deterministic planar kernel. No AGC
// value is displayed as a flight quantity, and nothing here commands anything.

import type { LunarFlightState, LunarOrbitalValues } from "@/simulation/lunar2d";
import type {
  AscentGuidanceCue,
  AscentMissionDefinition,
  AssistanceLevel,
  TargetOrbit,
  TargetOrbitError,
} from "@/game/ascent";

const NMI_M = 1852;

export function AscentHud({
  flight,
  orbit,
  guidance,
  target,
  targetError,
  massKg,
  deltaVRemainingMps,
  timeToApoapsisS,
  assistance,
  mission,
  burnElapsedS,
}: {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  guidance: AscentGuidanceCue;
  target: TargetOrbit;
  targetError: TargetOrbitError;
  massKg: number;
  deltaVRemainingMps: number;
  timeToApoapsisS: number | null;
  assistance: AssistanceLevel;
  mission: AscentMissionDefinition;
  burnElapsedS: number;
}) {
  // Commander suppresses the derived guidance numbers, never the raw flight
  // instruments — Armstrong had instruments too.
  const showCue = assistance !== "commander";
  const pitchDeg = (flight.attitudeRad * 180) / Math.PI;
  const fpaDeg =
    (Math.atan2(orbit.radialSpeedMps, orbit.tangentialSpeedMps) * 180) / Math.PI;
  const propFraction =
    mission.ascentPropellantKg > 0
      ? flight.ascentPropellantKg / mission.ascentPropellantKg
      : 0;
  const periSafe = orbit.periapsisAltitudeM >= mission.safePeriapsisAltitudeM;

  return (
    <div
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="ascent-hud"
      aria-label="Orbital HUD"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Orbital HUD
        </span>
        <span
          data-testid="ascent-phase"
          className="rounded border border-neutral-700 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-neutral-300"
        >
          {guidance.phase.replace(/-/g, " ")}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-600">
          burn {burnElapsedS.toFixed(1)} s
        </span>
        <span
          data-testid="ascent-config"
          className="ml-auto rounded border border-neutral-700 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-neutral-400"
        >
          {flight.configuration === "ascent-stage" ? "ascent stage" : "complete LM"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        <Cell testid="hud-altitude" label="Altitude" value={alt(orbit.altitudeM)} unit={altUnit} />
        <Cell label="Inertial speed" value={spd(orbit.speedMps)} unit={speedUnit} />
        <Cell
          label="Radial speed"
          value={spd(orbit.radialSpeedMps)}
          unit={speedUnit}
          tone={orbit.radialSpeedMps < -1 ? "warn" : "normal"}
        />
        <Cell
          testid="hud-tangential"
          label="Tangential speed"
          value={spd(orbit.tangentialSpeedMps)}
          unit={speedUnit}
        />
        <Cell label="Pitch from vertical" value={pitchDeg.toFixed(1)} unit="°" />
        <Cell label="Flight-path angle" value={fpaDeg.toFixed(1)} unit="°" />
        <Cell
          testid="hud-apoapsis"
          label="Apoapsis"
          value={orbit.apoapsisAltitudeM === null ? "—" : alt(orbit.apoapsisAltitudeM)}
          unit={altUnit}
        />
        <Cell
          testid="hud-periapsis"
          label="Periapsis"
          value={alt(orbit.periapsisAltitudeM)}
          unit={altUnit}
          tone={periSafe ? "good" : "warn"}
        />
        <Cell
          label="Time to apoapsis"
          value={timeToApoapsisS === null ? "—" : timeToApoapsisS.toFixed(0)}
          unit="s"
        />
        <Cell
          testid="hud-propellant"
          label="APS propellant"
          value={mass(flight.ascentPropellantKg)}
          unit={`${massUnit} · ${(propFraction * 100).toFixed(0)}%`}
          tone={propFraction < 0.1 ? "warn" : "normal"}
        />
        <Cell label="Remaining Δv" value={spd(deltaVRemainingMps, 0)} unit={speedUnit} />
        <Cell label="Vehicle mass" value={mass(massKg)} unit={massUnit} />
      </div>


      <div className="mt-2 grid gap-1.5 md:grid-cols-2">
        <div className="rounded border border-cyan-900/60 bg-cyan-950/20 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-widest text-cyan-600">
            Target · {target.label}
          </div>
          <div className="font-mono text-[11px] text-cyan-200" data-testid="target-error">
            peri {signedKm(targetError.periapsisErrorM)} km ·{" "}
            apo{" "}
            {targetError.apoapsisErrorM === null
              ? "—"
              : `${signedKm(targetError.apoapsisErrorM)} km`}{" "}
            · match {(targetError.quality * 100).toFixed(0)}%
          </div>
          <div className="font-mono text-[9px] text-cyan-700">
            {(target.periapsisAltitudeM / NMI_M).toFixed(0)} ×{" "}
            {(target.apoapsisAltitudeM / NMI_M).toFixed(0)} nmi ·{" "}
            {target.classification}
          </div>
        </div>

        <div
          className={
            "rounded border px-2 py-1.5 " +
            (showCue
              ? "border-amber-900/60 bg-amber-950/20"
              : "border-neutral-800 bg-black/40")
          }
          data-testid="ascent-advisory"
        >
          <div className="text-[9px] uppercase tracking-widest text-amber-600">
            Instructor cue · advisory only
          </div>
          {showCue ? (
            <>
              <div className="text-[11px] leading-snug text-amber-100">
                {guidance.advisory}
              </div>
              <div className="font-mono text-[9px] text-amber-700/90">
                cue pitch {((guidance.recommendedPitchRad * 180) / Math.PI).toFixed(0)}° ·
                error {((guidance.pitchErrorRad * 180) / Math.PI).toFixed(0)}° · target
                radial {guidance.targetRadialSpeedMps.toFixed(1)} m/s
              </div>
            </>
          ) : (
            <div className="text-[11px] text-neutral-500">
              Commander: numeric cues suppressed. Fly the instruments.
            </div>
          )}
        </div>
      </div>

      {!periSafe && flight.mainEngine !== "ascent" && orbit.altitudeM > 100 && (
        <div
          className="mt-2 rounded border border-red-800 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-200"
          data-testid="impact-warning"
        >
          Trajectory intersects the Moon: periapsis {km(orbit.periapsisAltitudeM)} km is
          below the {km(mission.safePeriapsisAltitudeM)} km safe floor. A high apoapsis
          does not make an orbit — the low point has to clear the surface.
        </div>
      )}
    </div>
  );
}

function km(m: number): string {
  return (m / 1000).toFixed(1);
}
function signedKm(m: number): string {
  const v = m / 1000;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function Cell({
  label,
  value,
  unit,
  tone = "normal",
  testid,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "normal" | "good" | "warn";
  testid?: string;
}) {
  const color =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-neutral-100";
  return (
    <div className="rounded border border-neutral-800 bg-black/50 px-2 py-1" data-testid={testid}>
      <div className="text-[9px] uppercase tracking-widest text-neutral-600">{label}</div>
      <div className={`font-mono text-sm ${color}`}>
        {value} <span className="text-[9px] text-neutral-500">{unit}</span>
      </div>
    </div>
  );
}
