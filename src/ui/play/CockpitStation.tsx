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

import consoleArt from "@/assets/cdr-console7.png.asset.json";
import { CockpitWindowView, type CockpitWindowViewProps } from "@/ui/play/CockpitWindowView";
import { wrapDeg } from "@/ui/play/FdaiBall";

/** Aperture bounding box, measured from the console artwork (1086x1448). */
const APERTURE = { left: 12.62, top: 23.07, right: 62.34, bottom: 71.82 };
/** MISSION TIMER LED window. */
const LED = { left: 79.0, top: 17.1, width: 14.6, height: 2.8 };
/** Attitude-ball well: centre and radius as a share of the artwork width. */
const BALL = { cx: 79.19, cy: 52.49, r: 5.52 };
/** Pane outline inside the aperture box, traced from the artwork's alpha hole. */
const PANE_CLIP =
  "polygon(94.5% 0%, 99.8% 2%, 94.3% 23.5%, 90.2% 37.6%, 82.1% 65.9%, 73.2% 94.2%, 68% 100%, 61% 98.4%, 56.4% 94.2%, 28.1% 65.9%, 0.7% 37.6%, 0% 32.7%, 10% 23.5%)";


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
            <rect x="-140" y="-400" width="280" height="400" fill="#111318" />
            <rect x="-140" y="0" width="280" height="400" fill="#e8e6e0" />
            <line x1="-140" y1="0" x2="140" y2="0" stroke="#8a8681" strokeWidth="2" />

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
                    stroke={y < 0 ? "#6f7480" : "#9a968f"}
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
  // Same drive signal as the FDAI card so both balls read identically in real
  // time. The kernel signs attitude negative for retrograde (braking) tilt, so
  // it is negated into the display convention where + is pitched back.
  const pitchDeg = wrapDeg((-view.flight.attitudeRad * 180) / Math.PI);

  const rollDeg = wrapDeg(view.rollDeg ?? 0);

  return (
    <div
      data-testid="cockpit-station"
      className="relative w-full overflow-hidden rounded border border-neutral-800 bg-black"
      style={{ aspectRatio: "1086 / 1448" }}
    >
      {/* The console PNG's glass is not fully transparent, so the live scene
          sits ABOVE the artwork and is clipped to the pane outline instead.
          The frame, rivets and sill still read as structure around it. */}
      <div
        className="pointer-events-none absolute z-10"
        style={{
          left: `${APERTURE.left}%`,
          top: `${APERTURE.top}%`,
          width: `${APERTURE.right - APERTURE.left}%`,
          height: `${APERTURE.bottom - APERTURE.top}%`,
          clipPath: PANE_CLIP,
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
          top: `${BALL.cy - BALL.r * (1086 / 1448)}%`,
          width: `${BALL.r * 2}%`,
          height: `${BALL.r * 2 * (1086 / 1448)}%`,
        }}
      >
        <StationBall pitchDeg={pitchDeg} rollDeg={rollDeg} />
      </div>
    </div>
  );
}
