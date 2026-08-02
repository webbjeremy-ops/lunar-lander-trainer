// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.36 — Commander's station: the photographic LM cockpit console with the
// live out-the-window scene painted through its triangular pane.
//
// The console artwork is a single PNG whose window aperture is transparent.
// The canvas sits behind it, sized to the aperture's bounding box, so the
// real frame, rivets and panel switches occlude the scene exactly as glass
// and structure do in the vehicle. Pure presentation.

import consoleArt from "@/assets/cdr-console.png.asset.json";
import { CockpitWindowView, type CockpitWindowViewProps } from "@/ui/play/CockpitWindowView";

/** Aperture bounding box, measured from the console artwork (1086x1448). */
const APERTURE = { left: 17.31, top: 25.0, right: 72.47, bottom: 71.06 };

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

export function CockpitStation({ missionElapsedSec, ...view }: CockpitStationProps) {
  return (
    <div
      data-testid="cockpit-station"
      className="relative w-full overflow-hidden rounded border border-neutral-800 bg-black"
      style={{ aspectRatio: "1086 / 1448" }}
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

      {/* Live MISSION TIMER over the console's readout window. */}
      <div
        className="pointer-events-none absolute flex items-center justify-center"
        style={{ left: "82%", top: "20.4%", width: "17%", height: "3.4%" }}
      >
        <span
          data-testid="station-mission-timer"
          className="font-mono tabular-nums leading-none"
          style={{
            fontSize: "clamp(8px, 1.5vw, 20px)",
            color: "#5cff62",
            textShadow: "0 0 6px rgba(92,255,98,0.55)",
            background: "#050705",
            padding: "0.15em 0.25em",
          }}
        >
          {timerText(missionElapsedSec)}
        </span>
      </div>
    </div>
  );
}
