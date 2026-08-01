// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Moon-centred orbital display.
//
// Lightweight SVG in the existing visual language: no 3D, no React Three
// Fiber. Every drawn conic comes from the deterministic kernel state.

import { useMemo } from "react";
import type { ConicPoint, OrbitOpsState, OrbitOpsDerived } from "@/simulation/orbitOps";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import { pointAtTrueAnomaly } from "@/simulation/orbitOps";

const R = DEFAULT_LUNAR_FLIGHT_PARAMETERS.terrain.meanRadiusM;
const VIEW = 1000;

export function OrbitMap({
  state,
  derived,
  coastArc,
  targetArc,
  plannedArc,
  showPlanned,
}: {
  state: OrbitOpsState;
  derived: OrbitOpsDerived;
  coastArc: readonly ConicPoint[];
  targetArc: readonly ConicPoint[];
  plannedArc: readonly ConicPoint[];
  showPlanned: boolean;
}) {
  const scale = useMemo(() => {
    let maxR = R * 1.15;
    const consider = (pts: readonly ConicPoint[]) => {
      for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x, p.y));
    };
    consider(coastArc);
    consider(targetArc);
    if (showPlanned) consider(plannedArc);
    maxR = Math.max(maxR, Math.hypot(state.lm.positionM[0], state.lm.positionM[1]));
    return (VIEW / 2 - 12) / maxR;
  }, [coastArc, targetArc, plannedArc, showPlanned, state.lm.positionM]);

  const px = (x: number) => VIEW / 2 + x * scale;
  const py = (y: number) => VIEW / 2 - y * scale;
  const path = (pts: readonly ConicPoint[]) =>
    pts.length === 0
      ? ""
      : pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(" ");

  const el = derived.elements;
  const periapsisPoint = pointAtTrueAnomaly(el, 0);
  const apoapsisPoint = pointAtTrueAnomaly(el, Math.PI);

  const lm = state.lm.positionM;
  const target = state.target?.positionM ?? null;

  return (
    <figure
      className="rounded border border-neutral-800 bg-neutral-950 p-2"
      data-testid="orbit-map"
    >
      <figcaption className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-neutral-500">
        <span>Moon-centred orbital display</span>
        <span className="text-neutral-600">planar · deterministic kernel</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="h-auto w-full"
        role="img"
        aria-label="Moon-centred map of the lunar module orbit, the Command Module orbit and any planned post-burn orbit"
      >
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={R * scale}
          className="fill-neutral-800/70 stroke-neutral-600"
          strokeWidth={1}
        />
        <text
          x={VIEW / 2}
          y={VIEW / 2 + 4}
          textAnchor="middle"
          className="fill-neutral-600 font-mono"
          fontSize={18}
        >
          MOON
        </text>

        {targetArc.length > 0 && (
          <path d={path(targetArc)} fill="none" className="stroke-sky-500/70" strokeWidth={2} strokeDasharray="6 6" />
        )}
        {coastArc.length > 0 && (
          <path d={path(coastArc)} fill="none" className="stroke-emerald-400" strokeWidth={2} />
        )}
        {showPlanned && plannedArc.length > 0 && (
          <path d={path(plannedArc)} fill="none" className="stroke-amber-400" strokeWidth={2} strokeDasharray="3 5" />
        )}

        {periapsisPoint && (
          <g>
            <circle cx={px(periapsisPoint.x)} cy={py(periapsisPoint.y)} r={5} className="fill-rose-400" />
            <text x={px(periapsisPoint.x) + 8} y={py(periapsisPoint.y)} className="fill-rose-300 font-mono" fontSize={16}>
              PE
            </text>
          </g>
        )}
        {apoapsisPoint && (
          <g>
            <circle cx={px(apoapsisPoint.x)} cy={py(apoapsisPoint.y)} r={5} className="fill-indigo-300" />
            <text x={px(apoapsisPoint.x) + 8} y={py(apoapsisPoint.y)} className="fill-indigo-200 font-mono" fontSize={16}>
              AP
            </text>
          </g>
        )}

        {state.node !== null && (
          <NodeMarker state={state} px={px} py={py} />
        )}

        <line x1={VIEW / 2} y1={VIEW / 2} x2={px(lm[0])} y2={py(lm[1])} className="stroke-emerald-700" strokeWidth={1} />
        {target && (
          <>
            <line x1={VIEW / 2} y1={VIEW / 2} x2={px(target[0])} y2={py(target[1])} className="stroke-sky-800" strokeWidth={1} />
            <line
              x1={px(lm[0])}
              y1={py(lm[1])}
              x2={px(target[0])}
              y2={py(target[1])}
              className="stroke-amber-300/70"
              strokeWidth={1.5}
              strokeDasharray="2 4"
            />
            <circle cx={px(target[0])} cy={py(target[1])} r={7} className="fill-sky-400" />
            <text x={px(target[0]) + 10} y={py(target[1]) - 8} className="fill-sky-200 font-mono" fontSize={16}>
              CSM
            </text>
          </>
        )}

        <circle cx={px(lm[0])} cy={py(lm[1])} r={7} className="fill-emerald-300" data-testid="orbit-map-lm" />
        <text x={px(lm[0]) + 10} y={py(lm[1]) + 18} className="fill-emerald-200 font-mono" fontSize={16}>
          LM
        </text>
      </svg>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
        Solid green: current orbit · dashed blue: Command Module · dashed amber:
        planned post-burn orbit (impulsive preview)
      </p>
    </figure>
  );
}

function NodeMarker({
  state,
  px,
  py,
}: {
  state: OrbitOpsState;
  px: (n: number) => number;
  py: (n: number) => number;
}) {
  // The node is drawn at the vehicle's predicted position by coasting the
  // current conic; a simple radial marker is enough at this scale.
  const p = state.lm.positionM;
  return (
    <g>
      <circle
        cx={px(p[0])}
        cy={py(p[1])}
        r={14}
        fill="none"
        className="stroke-amber-400"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
    </g>
  );
}
