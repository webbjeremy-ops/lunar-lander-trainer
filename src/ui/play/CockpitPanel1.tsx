// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.35 — LM Main Panel 1, the commander's console immediately right of the
// forward window.
//
// Layout follows the flown panel: MISSION/EVENT timers along the top, the
// X-pointer (lateral/forward velocity cross-pointer) upper left, the blue
// LUNAR CONTACT lamp, the DPS THRUST / TEMP / PRESS tape trio, the FDAI well
// with its roll and yaw rate tapes, the ALT / ALT RATE tapes, the T/W column,
// the guidance selector stack, the ABORT and guarded ABORT STAGE buttons, and
// the ENG ARM / THRUST CONT switch banks below.
//
// Pure presentation: it paints flight state and raises the abort the crew
// presses; it never mutates the kernel.

import type { LunarFlightState, LunarOrbitalValues } from "@/simulation/lunar2d";

export interface CockpitPanel1Props {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  /** Commanded throttle fraction, 0-1. */
  throttle: number;
  engineOn: boolean;
  engineArmed?: boolean;
  contactLight: boolean;
  descentPropellantFraction: number;
  missionElapsedSec: number;
  sinceIgnitionSec: number;
  aborted?: boolean;
  onAbortStage?: () => void;
}

const FT = 3.280839895;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hms(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  return {
    h: String(Math.floor(s / 3600)).padStart(2, "0"),
    m: String(Math.floor((s % 3600) / 60)).padStart(2, "0"),
    s: String(s % 60).padStart(2, "0"),
  };
}

function Screws({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const pts: [number, number][] = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  return (
    <>
      {pts.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" fill="var(--lm1-screw)" />
      ))}
    </>
  );
}

function Legend({
  x,
  y,
  children,
  size = 6.5,
  anchor = "middle",
}: {
  x: number;
  y: number;
  children: string;
  size?: number;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      letterSpacing="0.6"
      fill="var(--lm1-legend)"
    >
      {children}
    </text>
  );
}

/** Vertical tape meter with a moving band, as on the DPS gauge cluster. */
function TapeGauge({
  x,
  y,
  w,
  h,
  fraction,
  band,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fraction: number;
  band?: string;
  label: string;
}) {
  const f = clamp(fraction, 0, 1);
  const fill = h * f;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="var(--lm1-face)" stroke="#2a3238" />
      {band && (
        <rect x={x + w - 5} y={y + h * 0.12} width={3} height={h * 0.4} fill={band} opacity="0.85" />
      )}
      <rect x={x + 2} y={y + h - fill} width={w - 9} height={fill} fill="var(--lm1-scale)" opacity="0.9" />
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={i}
          x1={x}
          y1={y + (h * i) / 5}
          x2={x + 6}
          y2={y + (h * i) / 5}
          stroke="var(--lm1-scale)"
          strokeWidth="0.7"
        />
      ))}
      <text
        x={x + w / 2}
        y={y - 3}
        textAnchor="middle"
        fontSize="5.5"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="var(--lm1-legend)"
      >
        {label}
      </text>
    </g>
  );
}

/** Two-axis toggle cluster drawn as a real panel switch. */
function Toggle({
  x,
  y,
  up,
  label,
  upLabel,
  downLabel,
}: {
  x: number;
  y: number;
  up: boolean;
  label: string;
  upLabel?: string;
  downLabel?: string;
}) {
  return (
    <g>
      <circle cx={x} cy={y} r="5.2" fill="var(--lm1-panel-dark)" stroke="#4d5b65" strokeWidth="0.8" />
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={up ? y - 9 : y + 9}
        stroke="#c9d3d9"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={x} cy={up ? y - 9 : y + 9} r="2.6" fill="#b0453a" />
      <Legend x={x} y={y - 13} size={5}>
        {upLabel ?? ""}
      </Legend>
      <Legend x={x} y={y + 20} size={5}>
        {downLabel ?? ""}
      </Legend>
      <Legend x={x} y={y + 28} size={5.5}>
        {label}
      </Legend>
    </g>
  );
}

export function CockpitPanel1({
  flight,
  orbit,
  throttle,
  engineOn,
  engineArmed = false,
  contactLight,
  descentPropellantFraction,
  missionElapsedSec,
  sinceIgnitionSec,
  aborted = false,
  onAbortStage,
}: CockpitPanel1Props) {
  const met = hms(missionElapsedSec);
  const evt = hms(Math.max(0, sinceIgnitionSec));
  const altFt = orbit.altitudeM * FT;
  const altRateFps = orbit.radialSpeedMps * FT;
  // X-pointer: forward (down-range) velocity vertical, lateral velocity
  // horizontal. The planar kernel has no lateral axis, so that needle rests.
  const forward = clamp(orbit.tangentialSpeedMps / 60, -1, 1);
  const thrustPct = clamp(throttle, 0, 1);

  return (
    <section
      data-testid="cockpit-panel-1"
      aria-label="Lunar Module main panel 1"
      className="overflow-hidden rounded"
      style={{ backgroundColor: "var(--lm1-panel)" }}
    >
      <svg viewBox="0 0 300 420" className="block h-auto w-full" role="img" aria-label="LM main panel 1">
        <defs>
          <linearGradient id="lm1-face-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
          </linearGradient>
          <pattern id="lm1-hazard" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="var(--lm1-hazard)" />
            <rect width="5" height="10" fill="#20262a" />
          </pattern>
        </defs>

        <rect width="300" height="420" fill="var(--lm1-panel)" />
        <rect width="300" height="420" fill="url(#lm1-face-sheen)" />

        {/* Timers */}
        <rect x="10" y="8" width="130" height="26" rx="2" fill="var(--lm1-panel-light)" stroke="var(--lm1-panel-dark)" />
        <rect x="150" y="8" width="140" height="26" rx="2" fill="var(--lm1-panel-light)" stroke="var(--lm1-panel-dark)" />
        <Legend x={75} y={6} size={5.5}>MISSION TIMER</Legend>
        <Legend x={220} y={6} size={5.5}>EVENT TIMER</Legend>
        <text
          x={75}
          y={26}
          textAnchor="middle"
          fontSize="13"
          fontFamily="ui-monospace, monospace"
          fill="#101416"
          data-testid="panel1-met"
        >
          {`${met.h} ${met.m} ${met.s}`}
        </text>
        <text
          x={220}
          y={26}
          textAnchor="middle"
          fontSize="13"
          fontFamily="ui-monospace, monospace"
          fill="#101416"
        >
          {`${evt.m} ${evt.s}`}
        </text>

        {/* X-pointer cross-pointer meter */}
        <rect x="14" y="52" width="86" height="76" rx="2" fill="#e9edee" stroke="var(--lm1-panel-dark)" />
        <line x1="57" y1="56" x2="57" y2="124" stroke="#5b6a72" strokeWidth="0.7" />
        <line x1="18" y1="90" x2="96" y2="90" stroke="#5b6a72" strokeWidth="0.7" />
        <line
          x1="18"
          x2="96"
          y1={90 - forward * 30}
          y2={90 - forward * 30}
          stroke="#1d2529"
          strokeWidth="1.6"
          data-testid="panel1-xpointer-forward"
        />
        <line x1="57" x2="57" y1="56" y2="124" stroke="#1d2529" strokeWidth="1.6" />
        <Legend x={57} y={138} size={5.5}>X-POINTER SCALE</Legend>

        {/* LUNAR CONTACT lamp */}
        <Legend x={168} y={50} size={6}>LUNAR CONTACT</Legend>
        <circle
          cx={168}
          cy={68}
          r="13"
          fill={contactLight ? "var(--lm1-contact)" : "#2b3a46"}
          stroke="#1b2429"
          strokeWidth="2"
          data-testid="panel1-contact-lamp"
        >
          {contactLight && <animate attributeName="opacity" values="1;0.82;1" dur="1.1s" repeatCount="indefinite" />}
        </circle>

        {/* DPS THRUST / TEMP / PRESS cluster */}
        <rect x="196" y="46" width="92" height="86" rx="2" fill="var(--lm1-panel-light)" stroke="var(--lm1-panel-dark)" />
        <Legend x={210} y={44} size={5.5}>THRUST</Legend>
        <Legend x={242} y={44} size={5.5}>TEMP</Legend>
        <Legend x={274} y={44} size={5.5}>PRESS</Legend>
        <TapeGauge x={202} y={56} w={20} h={68} fraction={thrustPct} label="%" band="#f0c419" />
        <TapeGauge x={234} y={56} w={20} h={68} fraction={engineOn ? 0.62 : 0.24} label="°F" band="#5fbf6a" />
        <TapeGauge x={266} y={56} w={20} h={68} fraction={descentPropellantFraction} label="PSIA" band="#5fbf6a" />

        {/* FDAI well */}
        <polygon
          points="26,150 122,150 140,168 140,244 122,262 26,262 8,244 8,168"
          fill="var(--lm1-panel-dark)"
          stroke="#5a6a74"
        />
        <circle cx="74" cy="206" r="40" fill="#eef1f1" stroke="#2b343a" strokeWidth="2" />
        <path d="M34 206 A40 40 0 0 1 114 206 Z" fill="#cdd6da" />
        <line x1="34" y1="206" x2="114" y2="206" stroke="var(--lm1-needle)" strokeWidth="1.6" />
        <line x1="74" y1="166" x2="74" y2="246" stroke="var(--lm1-needle)" strokeWidth="1.2" />
        <circle cx="74" cy="206" r="4" fill="none" stroke="var(--lm1-needle)" strokeWidth="1.6" />
        <Legend x={74} y={158} size={5}>ROLL RATE</Legend>
        <Legend x={74} y={258} size={5}>YAW RATE</Legend>

        {/* ALT / ALT RATE tapes */}
        <rect x="150" y="150" width="70" height="112" rx="2" fill="var(--lm1-face)" stroke="#2a3238" />
        <Legend x={168} y={162} size={5}>FT</Legend>
        <Legend x={204} y={162} size={5}>FPS</Legend>
        <text
          x={168}
          y={210}
          textAnchor="middle"
          fontSize="11"
          fontFamily="ui-monospace, monospace"
          fill="var(--lm1-scale)"
          data-testid="panel1-altitude-ft"
        >
          {Math.round(altFt).toLocaleString()}
        </text>
        <text
          x={204}
          y={210}
          textAnchor="middle"
          fontSize="11"
          fontFamily="ui-monospace, monospace"
          fill="var(--lm1-scale)"
          data-testid="panel1-alt-rate-fps"
        >
          {altRateFps >= 0 ? `+${altRateFps.toFixed(0)}` : altRateFps.toFixed(0)}
        </text>
        <Legend x={185} y={274} size={5.5}>ALT / ALT RATE</Legend>

        {/* T/W column */}
        <rect x="232" y="150" width="26" height="112" rx="2" fill="var(--lm1-face)" stroke="#2a3238" />
        <Legend x={245} y={146} size={5.5}>T/W</Legend>
        {Array.from({ length: 7 }, (_, i) => (
          <text
            key={i}
            x={252}
            y={258 - i * 17}
            textAnchor="middle"
            fontSize="5"
            fontFamily="ui-monospace, monospace"
            fill="var(--lm1-scale)"
          >
            {i}
          </text>
        ))}
        <polygon
          points={`234,${258 - clamp(thrustPct * 5.5, 0, 6) * 17} 240,${
            255 - clamp(thrustPct * 5.5, 0, 6) * 17
          } 234,${252 - clamp(thrustPct * 5.5, 0, 6) * 17}`}
          fill="var(--lm1-needle)"
        />

        {/* Guidance selector stack */}
        <Legend x={278} y={152} size={5.5}>GUID CONT</Legend>
        <Toggle x={278} y={170} up label="" upLabel="PGNS" downLabel="AGS" />
        <Legend x={278} y={214} size={5.5}>MODE SEL</Legend>
        <Toggle x={278} y={232} up label="" upLabel="LDG RDR" downLabel="AGS" />

        {/* ABORT / ABORT STAGE */}
        <g
          role="button"
          tabIndex={0}
          onClick={() => onAbortStage?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onAbortStage?.();
          }}
          style={{ cursor: onAbortStage ? "pointer" : "default" }}
          data-testid="panel1-abort-stage"
        >
          <rect x="212" y="286" width="74" height="52" fill="url(#lm1-hazard)" />
          <rect x="220" y="292" width="58" height="40" rx="3" fill="#7fa8c9" stroke="#22303a" strokeWidth="1.5" />
          <text x="249" y="309" textAnchor="middle" fontSize="8" fontFamily="ui-sans-serif, sans-serif" fill="#0f1a20">
            ABORT
          </text>
          <text x="249" y="322" textAnchor="middle" fontSize="8" fontFamily="ui-sans-serif, sans-serif" fill="#0f1a20">
            STAGE
          </text>
          {aborted && <rect x="220" y="292" width="58" height="40" rx="3" fill="#b0453a" opacity="0.55" />}
        </g>
        <circle cx="176" cy="312" r="24" fill="#14191c" stroke="#2c3740" strokeWidth="3" />
        <text x="176" y="315" textAnchor="middle" fontSize="8.5" fontFamily="ui-sans-serif, sans-serif" fill="#e6eaec">
          ABORT
        </text>

        {/* ENG ARM / THRUST CONT banks */}
        <rect
          x="10"
          y="286"
          width="150"
          height="58"
          rx="2"
          fill="none"
          stroke="var(--lm1-legend)"
          strokeWidth="0.7"
          opacity="0.65"
        />
        <Legend x={85} y={282} size={5.5}>ENGINE THRUST CONT</Legend>
        <Toggle x={34} y={308} up={engineArmed} label="ENG ARM" upLabel="DES" downLabel="OFF" />
        <Toggle x={86} y={308} up={engineOn} label="THR CONT" upLabel="AUTO" downLabel="MAN" />
        <Toggle x={136} y={308} up label="MAN THROT" upLabel="CDR" downLabel="SE" />

        {/* Lower attitude-control bank */}
        <rect x="10" y="356" width="278" height="54" rx="2" fill="var(--lm1-panel-dark)" opacity="0.35" />
        <Legend x={149} y={368} size={5.5}>ATTITUDE CONTROL</Legend>
        <Toggle x={60} y={384} up label="ROLL" upLabel="MODE CONT" />
        <Toggle x={149} y={384} up label="PITCH" upLabel="MODE CONT" />
        <Toggle x={238} y={384} up label="YAW" upLabel="MODE CONT" />

        <Screws x={6} y={6} w={288} h={408} />
      </svg>
    </section>
  );
}
