// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Moon-centred orbit visualisation.
//
// Draws the lunar surface, the target orbit, the predicted coast conic, the
// apsis markers and the vehicle. Pure presentation: it renders the state it is
// handed and never commands anything.

import { useMemo } from "react";
import type { LunarFlightState, LunarOrbitalValues } from "@/simulation/lunar2d";
import { MOON_MEAN_RADIUS_M } from "@/simulation/lunar2d/LunarMissionConstants";
import type { ConicSample, TargetOrbit } from "@/game/ascent";

const SIZE = 460;

export function OrbitVisualizer({
  flight,
  orbit,
  target,
  coastArc,
  recommendedPitchRad,
  showCue,
}: {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  target: TargetOrbit;
  coastArc: readonly ConicSample[];
  recommendedPitchRad: number;
  showCue: boolean;
}) {
  const R = MOON_MEAN_RADIUS_M;

  // World extent: whatever is largest of the target orbit, the coast conic and
  // the current radius, with a small margin.
  const extentM = useMemo(() => {
    let max = R + target.apoapsisAltitudeM;
    for (const p of coastArc) {
      const r = Math.hypot(p.x, p.y);
      if (r > max) max = r;
    }
    if (orbit.radiusM > max) max = orbit.radiusM;
    return Math.min(max * 1.08, R * 6);
  }, [R, target.apoapsisAltitudeM, coastArc, orbit.radiusM]);

  const scale = SIZE / 2 / extentM;
  const px = (v: number) => v * scale;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  // Screen: x right, y up (SVG y is flipped).
  const sx = (x: number) => cx + px(x);
  const sy = (y: number) => cy - px(y);

  const arcPath = useMemo(() => {
    if (coastArc.length < 2) return "";
    return coastArc
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
      .join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coastArc, scale]);

  const vx = flight.positionM[0];
  const vy = flight.positionM[1];
  const ang = Math.atan2(vy, vx);

  // Apsis marker positions in the inertial frame.
  const apsis = useMemo(() => {
    const e = orbit.eccentricity;
    if (!(e >= 0) || orbit.semiMajorAxisM === null) return null;
    const p = orbit.periapsisRadiusM;
    const cosNu = e > 1e-9 ? (orbit.semiMajorAxisM * (1 - e * e)) / orbit.radiusM - 1 : 0;
    const nu0 =
      (orbit.radialSpeedMps >= 0 ? 1 : -1) *
      Math.acos(Math.min(1, Math.max(-1, e > 1e-9 ? cosNu / e : 0)));
    const omega = orbit.centralAngleRad - nu0;
    const a = orbit.apoapsisRadiusM;
    return {
      peri: { x: p * Math.cos(omega), y: p * Math.sin(omega) },
      apo:
        a === null
          ? null
          : { x: a * Math.cos(omega + Math.PI), y: a * Math.sin(omega + Math.PI) },
    };
  }, [orbit]);

  const bodyAngle = ang + Math.PI / 2 - flight.attitudeRad;
  const cueAngle = ang + Math.PI / 2 - recommendedPitchRad;
  const armLen = Math.max(16, px(R * 0.06));

  return (
    <div
      className="rounded border border-neutral-800 bg-black"
      data-testid="orbit-visualizer"
      aria-label="Moon-centred orbit view"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full">
        <defs>
          <radialGradient id="moonFill" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor="#18181b" />
          </radialGradient>
        </defs>

        {/* Target orbit — drawn as a circle band between peri and apo radius. */}
        <circle
          cx={cx}
          cy={cy}
          r={px(R + target.apoapsisAltitudeM)}
          fill="none"
          stroke="#0891b2"
          strokeDasharray="4 5"
          strokeWidth={1}
        />
        <circle
          cx={cx}
          cy={cy}
          r={px(R + target.periapsisAltitudeM)}
          fill="none"
          stroke="#0891b2"
          strokeDasharray="2 6"
          strokeWidth={1}
        />

        {/* Predicted coast conic */}
        {arcPath && (
          <path
            d={arcPath}
            fill="none"
            stroke="#34d399"
            strokeWidth={1.4}
            strokeOpacity={0.9}
            data-testid="coast-arc"
          />
        )}

        {/* The Moon */}
        <circle cx={cx} cy={cy} r={px(R)} fill="url(#moonFill)" stroke="#52525b" />

        {/* Apsis markers */}
        {apsis && (
          <>
            <circle
              cx={sx(apsis.peri.x)}
              cy={sy(apsis.peri.y)}
              r={3}
              fill={orbit.periapsisAltitudeM < 0 ? "#f87171" : "#fbbf24"}
              data-testid="marker-periapsis"
            />
            {apsis.apo && (
              <circle
                cx={sx(apsis.apo.x)}
                cy={sy(apsis.apo.y)}
                r={3}
                fill="#38bdf8"
                data-testid="marker-apoapsis"
              />
            )}
          </>
        )}

        {/* Advisory attitude cue */}
        {showCue && (
          <line
            x1={sx(vx)}
            y1={sy(vy)}
            x2={sx(vx) + armLen * Math.cos(cueAngle)}
            y2={sy(vy) - armLen * Math.sin(cueAngle)}
            stroke="#fbbf24"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            data-testid="pitch-cue"
          />
        )}

        {/* Vehicle and its thrust axis */}
        <line
          x1={sx(vx)}
          y1={sy(vy)}
          x2={sx(vx) + armLen * Math.cos(bodyAngle)}
          y2={sy(vy) - armLen * Math.sin(bodyAngle)}
          stroke={flight.mainEngine === "ascent" ? "#f97316" : "#e5e5e5"}
          strokeWidth={2}
        />
        <circle cx={sx(vx)} cy={sy(vy)} r={3.5} fill="#e5e5e5" data-testid="vehicle-marker" />

        {/* Jettisoned descent stage, parked on the surface */}
        {flight.separatedDescentStage && (
          <circle
            cx={sx(flight.separatedDescentStage.positionM[0])}
            cy={sy(flight.separatedDescentStage.positionM[1])}
            r={2.5}
            fill="#a3a3a3"
            data-testid="descent-stage-marker"
          />
        )}
      </svg>

      <div className="flex flex-wrap gap-3 border-t border-neutral-800 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-neutral-500">
        <Legend color="#34d399">coast arc</Legend>
        <Legend color="#0891b2">target orbit</Legend>
        <Legend color="#fbbf24">periapsis</Legend>
        <Legend color="#38bdf8">apoapsis</Legend>
        <span className="ml-auto">scale-accurate · Moon-centred inertial</span>
      </div>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
