// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.37 — Commander's station: the photographic LM cockpit console with the
// live out-the-window scene painted through its triangular pane.
//
// The console artwork is a single PNG whose window aperture is transparent
// (the etched LPD ticks and reticle survive the key and stay on the glass).
// The canvas sits behind it, so the real frame, rivets and panel switches
// occlude the scene exactly as structure does in the vehicle. Two live
// overlays sit on top: the MISSION TIMER LED readout and the attitude ball
// in its octagonal well. Pure presentation.

import consoleArt from "@/assets/cdr-console2.png.asset.json";
import { displayPitchRad } from "@/game/play/descentPhase";
import { CockpitWindowView, type CockpitWindowViewProps } from "@/ui/play/CockpitWindowView";

/** Aperture bounding box, measured from the console artwork (896x1195). */
const APERTURE = { left: 12.72, top: 24.27, right: 63.84, bottom: 72.14 };
/** MISSION TIMER LED window. */
const LED = { left: 77.6, top: 20.6, width: 15.7, height: 2.7 };
/** Attitude-ball well: centre and radius as a share of the artwork width. */
const BALL = { cx: 78.13, cy: 53.97, r: 5.0 };

export interface CockpitStationProps extends CockpitWindowViewProps {
  missionElapsedSec: number;
}

/** MISSION TIMER columns: hours, minutes, seconds. */
function timerText(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(3, "0")} ${String(m).padStart(2, "0")} ${String(
    s % 60,
  ).padStart(2, "0")}`;
}

/** Minimal 8-ball face: pitch ladder scrolls with attitude, whole ball rolls. */
function StationBall({ pitchDeg, rollDeg }: { pitchDeg: number; rollDeg: number }) {
  const R = 50;
  const rows: number[] = [];
  for (let d = -180; d <= 180; d += 15) rows.push(d);
  return (
    <svg
      viewBox="-60 -60 120 120"
      className="h-full w-full"
      data-testid="station-ball"
      data-pitch={pitchDeg.toFixed(1)}
      data-roll={rollDeg.toFixed(1)}
    >
      <defs>
        <clipPath id="station-ball-clip">
          <circle cx="0" cy="0" r={R} />
        </clipPath>
        <radialGradient id="station-ball-shade" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="65%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
        </radialGradient>
      </defs>
      <g clipPath="url(#station-ball-clip)">
        <g transform={`rotate(${-rollDeg})`}>
          <g transform={`translate(0 ${(pitchDeg * R) / 90})`}>
            <rect x="-140" y="-400" width="280" height="400" fill="#d6d3cd" />
            <rect x="-140" y="0" width="280" height="400" fill="#1d1f22" />
            <line x1="-140" y1="0" x2="140" y2="0" stroke="#8a5a2b" strokeWidth="2" />
            {rows.map((d) => {
              const y = (-d * R) / 90;
              const major = d % 45 === 0;
              const half = major ? 18 : 9;
              return (
                <g key={d}>
                  <line
                    x1={-half}
                    y1={y}
                    x2={half}
                    y2={y}
                    stroke={d > 0 ? "#3a3d42" : "#c9c6c0"}
                    strokeWidth="1"
                    opacity="0.8"
                  />
                </g>
              );
            })}
            {[-60, -30, 0, 30, 60].map((mx) => (
              <line
                key={mx}
                x1={(mx * R) / 90}
                y1={-400}
                x2={(mx * R) / 90}
                y2={400}
                stroke="#6f7276"
                strokeWidth="0.7"
                opacity="0.7"
              />
            ))}
          </g>
        </g>
        <circle cx="0" cy="0" r={R} fill="url(#station-ball-shade)" />
      </g>
      {/* Fixed vehicle symbol. */}
      <g stroke="#f5c542" strokeWidth="2" fill="none">
        <line x1="-22" y1="0" x2="-8" y2="0" />
        <line x1="8" y1="0" x2="22" y2="0" />
        <circle cx="0" cy="0" r="2.5" fill="#f5c542" />
      </g>
    </svg>
  );
}

export function CockpitStation({ missionElapsedSec, ...view }: CockpitStationProps) {
  const pitchDeg =
    (displayPitchRad(view.flight.attitudeRad, view.orbit.altitudeM, view.manual, {
      p64Selected: view.p64Selected,
    }) *
      180) /
    Math.PI;

  return (
    <div
      data-testid="cockpit-station"
      className="relative w-full overflow-hidden rounded border border-neutral-800 bg-black"
      style={{ aspectRatio: "896 / 1195" }}
    >
      <div
        className="absolute"
        style={{
          left: `${APERTURE.left}%`,
          top: `${APERTURE.top}%`,
          width: `${APERTURE.right - APERTURE.left}%`,
          height: `${APERTURE.bottom - APERTURE.top}%`,
        }}
      >
        <CockpitWindowView {...view} bare className="h-full w-full bg-black" />
      </div>

      <img
        src={consoleArt.url}
        alt="Commander's station: LM forward window and main instrument console"
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
        draggable={false}
      />

      {/* Live MISSION TIMER over the console's LED readout window. */}
      <div
        className="pointer-events-none absolute flex items-center justify-center"
        style={{
          left: `${LED.left}%`,
          top: `${LED.top}%`,
          width: `${LED.width}%`,
          height: `${LED.height}%`,
          background: "#050705",
        }}
      >
        <span
          data-testid="station-mission-timer"
          className="font-mono tabular-nums leading-none"
          style={{
            fontSize: "clamp(8px, 1.5vw, 18px)",
            letterSpacing: "0.04em",
            color: "#5cff62",
            textShadow: "0 0 6px rgba(92,255,98,0.6)",
          }}
        >
          {timerText(missionElapsedSec)}
        </span>
      </div>

      {/* Live attitude ball in the console's gimbal well. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: `${BALL.cx - BALL.r}%`,
          top: `calc(${BALL.cy}% - ${BALL.r}% * 896 / 1195)`,
          width: `${BALL.r * 2}%`,
          aspectRatio: "1 / 1",
        }}
      >
        <StationBall pitchDeg={pitchDeg} rollDeg={view.rollDeg ?? 0} />
      </div>
    </div>
  );
}
