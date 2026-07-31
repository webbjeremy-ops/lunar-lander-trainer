// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Lightweight interactive teaching diagrams.
//
// Hand-written SVG + a single range input each. No charting dependency, no
// canvas, no WebGL. Every diagram is EDUCATIONAL VISUALIZATION: schematic,
// not to scale, and never a source of simulator behaviour.

import { useId, useState } from "react";

const LABEL =
  "rounded-sm border border-amber-500 px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest text-amber-300";

function Frame({
  title,
  children,
  control,
}: {
  title: string;
  children: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <figure
      className="mt-4 rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="lesson-diagram"
    >
      <figcaption className="mb-2 flex flex-wrap items-center gap-2">
        <span className={LABEL}>Educational visualization</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
          {title}
        </span>
      </figcaption>
      {children}
      <div className="mt-2">{control}</div>
    </figure>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  readout,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  readout: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-emerald-500"
      />
      <output htmlFor={id} className="w-28 text-right font-mono text-[10px] text-emerald-300">
        {readout}
      </output>
    </div>
  );
}

const G_MOON = 1.62;
const MAX_THRUST_N = 45_040;

/** Thrust and gravity vectors against throttle. */
export function ThrustGravityDiagram() {
  const [throttlePct, setThrottle] = useState(54);
  const massKg = 15_000;
  const weightN = massKg * G_MOON;
  const thrustN = (throttlePct / 100) * MAX_THRUST_N;
  const accel = thrustN / massKg - G_MOON;
  const thrustLen = Math.min(90, (thrustN / weightN) * 45);
  const weightLen = 45;
  return (
    <Frame
      title="Thrust versus weight"
      control={
        <Slider
          label="Throttle"
          value={throttlePct}
          min={0}
          max={100}
          step={1}
          onChange={setThrottle}
          readout={`${throttlePct}% · ${accel >= 0 ? "+" : ""}${accel.toFixed(2)} m/s²`}
        />
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Thrust arrow length reflects ${throttlePct} percent throttle against a fixed weight arrow`}>
        <rect x="102" y="62" width="36" height="26" className="fill-neutral-800 stroke-neutral-600" />
        <line x1="120" y1="62" x2="120" y2={62 - thrustLen} className="stroke-emerald-400" strokeWidth="3" />
        <polygon points={`120,${62 - thrustLen - 8} 115,${62 - thrustLen} 125,${62 - thrustLen}`} className="fill-emerald-400" />
        <line x1="120" y1="88" x2="120" y2={88 + weightLen} className="stroke-sky-400" strokeWidth="3" />
        <polygon points={`120,${88 + weightLen + 8} 115,${88 + weightLen} 125,${88 + weightLen}`} className="fill-sky-400" />
        <text x="130" y="30" className="fill-emerald-300 font-mono text-[8px]">thrust {(thrustN / 1000).toFixed(1)} kN</text>
        <text x="130" y="130" className="fill-sky-300 font-mono text-[8px]">weight {(weightN / 1000).toFixed(1)} kN</text>
      </svg>
      <p className="font-mono text-[10px] text-neutral-400">
        {accel > 0.02
          ? "Net acceleration is upward — sink rate is being reduced."
          : accel < -0.02
            ? "Net acceleration is downward — still accelerating toward the surface."
            : "Hover: thrust balances weight."}
      </p>
    </Frame>
  );
}

/** Velocity vector decomposition. */
export function VelocityVectorDiagram() {
  const [horizontal, setHorizontal] = useState(40);
  const vertical = 20;
  const speed = Math.hypot(horizontal, vertical);
  const hx = Math.min(120, horizontal * 1.6);
  return (
    <Frame
      title="Velocity components"
      control={
        <Slider
          label="Horizontal"
          value={horizontal}
          min={0}
          max={80}
          step={1}
          onChange={setHorizontal}
          readout={`${horizontal} m/s · |v| ${speed.toFixed(1)}`}
        />
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Velocity triangle with ${horizontal} metres per second horizontal and 20 vertical`}>
        <line x1="0" y1="120" x2="240" y2="120" className="stroke-neutral-700" />
        <line x1="40" y1="40" x2={40 + hx} y2="40" className="stroke-amber-400" strokeWidth="3" />
        <line x1="40" y1="40" x2="40" y2="90" className="stroke-sky-400" strokeWidth="3" />
        <line x1="40" y1="40" x2={40 + hx} y2="90" className="stroke-emerald-400" strokeWidth="2" strokeDasharray="4 3" />
        <text x={44 + hx} y="38" className="fill-amber-300 font-mono text-[8px]">horizontal</text>
        <text x="44" y="86" className="fill-sky-300 font-mono text-[8px]">descent 20 m/s</text>
        <text x={44 + hx / 2} y="106" className="fill-emerald-300 font-mono text-[8px]">|v| {speed.toFixed(1)} m/s</text>
      </svg>
      <p className="font-mono text-[10px] text-neutral-400">
        {horizontal > 30
          ? "Most of the remaining speed is sideways — brake before you flare."
          : "Horizontal speed is nearly gone; the problem is now vertical."}
      </p>
    </Frame>
  );
}

/** Trajectory curvature against speed. */
export function TrajectoryCurvatureDiagram() {
  const [speed, setSpeed] = useState(900);
  // Schematic: higher speed flattens the fall path.
  const drop = Math.max(6, 110 - speed / 12);
  const path = `M 10 30 Q 120 ${30 + drop * 0.6} 230 ${Math.min(125, 30 + drop)}`;
  return (
    <Frame
      title="Speed against curvature"
      control={
        <Slider
          label="Horizontal speed"
          value={speed}
          min={0}
          max={1700}
          step={10}
          onChange={setSpeed}
          readout={`${speed} m/s`}
        />
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Flight path curvature at ${speed} metres per second`}>
        <path d="M -20 150 Q 120 105 260 150" className="fill-none stroke-neutral-600" strokeWidth="2" />
        <path d={path} className="fill-none stroke-emerald-400" strokeWidth="2" />
        <circle cx="10" cy="30" r="3" className="fill-amber-300" />
        <text x="14" y="26" className="fill-neutral-400 font-mono text-[8px]">now</text>
      </svg>
      <p className="font-mono text-[10px] text-neutral-400">
        {speed > 1600
          ? "At orbital speed the surface curves away as fast as you fall — you never arrive."
          : speed > 600
            ? "Still fast: the path is shallow and long. Most thrust should oppose velocity."
            : "Slow: the path is steep and short. The flight is now essentially vertical."}
      </p>
    </Frame>
  );
}

/** Mass ratio against available delta-v. */
export function MassDeltaVDiagram() {
  const [propellantKg, setPropellant] = useState(8_000);
  const dryKg = 7_000;
  const isp = 311;
  const deltaV = isp * 9.80665 * Math.log((dryKg + propellantKg) / dryKg);
  const barW = Math.min(210, (deltaV / 2500) * 210);
  return (
    <Frame
      title="Mass ratio against delta-v"
      control={
        <Slider
          label="Propellant"
          value={propellantKg}
          min={0}
          max={12_000}
          step={100}
          onChange={setPropellant}
          readout={`${propellantKg} kg · ${deltaV.toFixed(0)} m/s`}
        />
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Delta-v of ${deltaV.toFixed(0)} metres per second for ${propellantKg} kilograms of propellant`}>
        <rect x="15" y="40" width="210" height="18" className="fill-neutral-800" />
        <rect x="15" y="40" width={barW} height="18" className="fill-emerald-500/70" />
        <text x="15" y="34" className="fill-neutral-400 font-mono text-[8px]">Δv = Isp·g₀·ln(m₀/m₁)</text>
        <text x="15" y="76" className="fill-emerald-300 font-mono text-[9px]">{deltaV.toFixed(0)} m/s</text>
        <text x="15" y="94" className="fill-neutral-400 font-mono text-[8px]">
          mass ratio {(1 + propellantKg / dryKg).toFixed(2)} · dry {dryKg} kg
        </text>
        <text x="15" y="112" className="fill-neutral-500 font-mono text-[8px]">diminishing returns: doubling propellant does not double Δv</text>
      </svg>
    </Frame>
  );
}

/** Periapsis / apoapsis. */
export function OrbitApsidesDiagram() {
  const [apoapsisKm, setApoapsis] = useState(110);
  const [periapsisKm, setPeriapsis] = useState(15);
  const rx = 60 + apoapsisKm * 0.35;
  const ry = 40 + periapsisKm * 0.35;
  const belowSurface = periapsisKm <= 0;
  return (
    <Frame
      title="Periapsis and apoapsis"
      control={
        <div className="space-y-1">
          <Slider label="Apoapsis" value={apoapsisKm} min={20} max={200} step={1} onChange={setApoapsis} readout={`${apoapsisKm} km`} />
          <Slider label="Periapsis" value={periapsisKm} min={-10} max={120} step={1} onChange={setPeriapsis} readout={`${periapsisKm} km`} />
        </div>
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Orbit with apoapsis ${apoapsisKm} kilometres and periapsis ${periapsisKm} kilometres`}>
        <circle cx="120" cy="70" r="34" className="fill-neutral-800 stroke-neutral-600" />
        <ellipse cx="120" cy="70" rx={rx} ry={ry} className={`fill-none ${belowSurface ? "stroke-red-400" : "stroke-emerald-400"}`} strokeWidth="1.5" />
        <circle cx={120 - rx} cy="70" r="3" className="fill-amber-300" />
        <circle cx={120 + rx} cy="70" r="3" className="fill-sky-300" />
        <text x="6" y="62" className="fill-amber-300 font-mono text-[8px]">apo</text>
        <text x="222" y="62" className="fill-sky-300 font-mono text-[8px]">peri</text>
      </svg>
      <p className="font-mono text-[10px] text-neutral-400">
        {belowSurface
          ? "Periapsis is below the surface — this trajectory intersects the Moon."
          : "Both apsides clear the surface — this is a closed, coasting orbit."}
      </p>
    </Frame>
  );
}

/** Landing energy at contact. */
export function LandingEnergyDiagram() {
  const [sinkMps, setSink] = useState(2.0);
  const limit = 3.05;
  const massKg = 7_300;
  const energyKJ = (0.5 * massKg * sinkMps * sinkMps) / 1000;
  const frac = Math.min(1.4, sinkMps / limit);
  const w = Math.min(210, frac * 150);
  const over = sinkMps > limit;
  return (
    <Frame
      title="Contact energy against the gear limit"
      control={
        <Slider
          label="Sink rate"
          value={sinkMps}
          min={0}
          max={6}
          step={0.05}
          onChange={setSink}
          readout={`${sinkMps.toFixed(2)} m/s`}
        />
      }
    >
      <svg viewBox="0 0 240 140" className="h-40 w-full" role="img" aria-label={`Contact energy bar at ${sinkMps.toFixed(2)} metres per second sink rate against a 3.05 limit`}>
        <rect x="15" y="46" width="210" height="20" className="fill-neutral-800" />
        <rect x="15" y="46" width={w} height="20" className={over ? "fill-red-500/70" : "fill-emerald-500/70"} />
        <line x1={15 + 150} y1="38" x2={15 + 150} y2="74" className="stroke-amber-300" strokeWidth="2" />
        <text x={15 + 150 - 6} y="34" className="fill-amber-300 font-mono text-[8px]">3.05 m/s gear limit</text>
        <text x="15" y="94" className={`font-mono text-[9px] ${over ? "fill-red-300" : "fill-emerald-300"}`}>
          {energyKJ.toFixed(1)} kJ absorbed at contact
        </text>
        <text x="15" y="112" className="fill-neutral-500 font-mono text-[8px]">
          energy scales with the square of sink rate — halve the rate, quarter the damage
        </text>
      </svg>
    </Frame>
  );
}

export const LESSON_DIAGRAMS: Readonly<Record<string, () => React.JSX.Element>> = {
  "thrust-gravity-vectors": ThrustGravityDiagram,
  "velocity-vectors": VelocityVectorDiagram,
  "trajectory-curvature": TrajectoryCurvatureDiagram,
  "mass-delta-v": MassDeltaVDiagram,
  "orbit-apsides": OrbitApsidesDiagram,
  "landing-energy": LandingEnergyDiagram,
};

export function LessonDiagram({ id }: { id: string }) {
  const Cmp = LESSON_DIAGRAMS[id];
  if (!Cmp) return null;
  return <Cmp />;
}
