// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Commander's-window lunar scene.
//
// Two synchronized views on one canvas:
//   * the out-the-window forward view (LPD grid, horizon, landing zone), and
//   * a side-profile inset showing altitude, attitude and the descent path.
// Pure presentation: it reads flight state and draws. It never mutates it.

import { useEffect, useRef } from "react";
import type { LunarFlightState, LunarOrbitalValues } from "@/simulation/lunar2d";
import type { Hazard, LandingLimits, MissionDefinition } from "@/game/play";
import { descentPhaseFor, displayPitchRad } from "@/game/play/descentPhase";

export function LunarScene({
  flight,
  orbit,
  downrangeM,
  mission,
  limits,
  manual,
  rollDeg = 0,
  p64Selected = true,
}: {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  downrangeM: number;
  mission: MissionDefinition;
  limits: LandingLimits;
  manual: boolean;
  /** M4.8 cockpit roll: 180 = windows-down (PDI attitude), 0 = windows-up. */
  rollDeg?: number;
  /** True once the crew has taken the approach program (P64) on the DSKY. */
  p64Selected?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  // Flown path in profile coordinates (range-to-go, altitude). Sampled from
  // the props ref, capped, and reset whenever the flight clock rewinds.
  const trailRef = useRef<TrailPoint[]>([]);
  const lastTimeRef = useRef(0);
  if (flight.missionTimeUs < lastTimeRef.current) trailRef.current = [];
  lastTimeRef.current = flight.missionTimeUs;
  {
    const last = trailRef.current[trailRef.current.length - 1];
    const point = { rangeM: Math.abs(downrangeM), altitudeM: orbit.altitudeM };
    if (
      !last ||
      Math.abs(last.altitudeM - point.altitudeM) > 2 ||
      Math.abs(last.rangeM - point.rangeM) > 2
    ) {
      trailRef.current = [...trailRef.current.slice(-400), point];
    }
  }

  // M4.10 — the scene used to redraw from an effect keyed on flight state and
  // reallocated the backing store on every draw. Now the latest props live in
  // a ref and painting happens once per animation frame, so the picture tracks
  // the vehicle instead of trailing React's render work.
  const propsRef = useRef<DrawArgs>({
    flight, orbit, downrangeM, mission, limits, manual, rollDeg, p64Selected,
    trail: trailRef.current,
  });
  propsRef.current = {
    flight, orbit, downrangeM, mission, limits, manual, rollDeg, p64Selected,
    trail: trailRef.current,
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let lastW = -1;
    let lastH = -1;
    let lastDpr = -1;

    const paint = () => {
      const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        if (w !== lastW || h !== lastH || dpr !== lastDpr) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          lastW = w;
          lastH = h;
          lastDpr = dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h, propsRef.current);
      }
      frame = requestAnimationFrame(paint);
    };

    paint();
    return () => cancelAnimationFrame(frame);
  }, []);


  return (
    <canvas
      ref={ref}
      data-testid="play-scene"
      className="h-[380px] w-full rounded border border-neutral-800 bg-black"
      aria-label="Lunar module out-the-window view and descent profile"
    />
  );
}

interface TrailPoint {
  rangeM: number;
  altitudeM: number;
}

interface DrawArgs {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  downrangeM: number;
  mission: MissionDefinition;
  limits: LandingLimits;
  manual: boolean;
  rollDeg: number;
  p64Selected: boolean;
  trail: readonly TrailPoint[];
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  ctx.clearRect(0, 0, w, h);
  const splitX = Math.round(w * 0.62);
  drawWindow(ctx, 0, 0, splitX, h, a);
  ctx.save();
  ctx.beginPath();
  ctx.rect(splitX, 0, w - splitX, h);
  ctx.clip();
  drawProfile(ctx, splitX, 0, w - splitX, h, a);
  ctx.restore();

  ctx.strokeStyle = "#262626";
  ctx.beginPath();
  ctx.moveTo(splitX + 0.5, 0);
  ctx.lineTo(splitX + 0.5, h);
  ctx.stroke();
}

// -----------------------------------------------------------------------------
// Out-the-window view
// -----------------------------------------------------------------------------

function drawWindow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  { flight, orbit, downrangeM, mission, limits, manual, p64Selected }: DrawArgs,
) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // Sky (lunar black) and the pitch-driven horizon.
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, w, h);

  // Historical attitude: pitched back near 90 deg through braking (windows off
  // the surface), pitch-over at high gate, near upright at low gate.
  const phase = descentPhaseFor(orbit.altitudeM, { p64Selected });
  const pitch = displayPitchRad(flight.attitudeRad, orbit.altitudeM, manual, {
    p64Selected,
  });
  // At 90 deg from vertical the crew is looking at space: the horizon drops
  // out of the bottom of the window. Upright brings it back up.
  const horizonY = h * 0.36 + (pitch / (Math.PI / 2)) * h * 0.95;


  // Regolith.
  const grad = ctx.createLinearGradient(0, horizonY, 0, h);
  grad.addColorStop(0, "#3b3630");
  grad.addColorStop(1, "#171514");
  ctx.fillStyle = grad;
  ctx.fillRect(0, horizonY, w, h - horizonY);
  ctx.strokeStyle = "#6b6255";
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();

  // Perspective ground grid — each line is a downrange band.
  const alt = Math.max(1, orbit.altitudeM);
  ctx.strokeStyle = "rgba(140,128,110,0.28)";
  for (let i = 1; i <= 10; i++) {
    const range = i * Math.max(60, alt * 0.6);
    const y = groundY(range, alt, horizonY, h);
    if (y < horizonY + 1 || y > h) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Landing zone and hazards, positioned by downrange distance.
  const zoneY = groundY(Math.max(0, downrangeM), alt, horizonY, h);
  const scale = Math.max(0.6, (zoneY - horizonY) / Math.max(1, h - horizonY));
  const zoneW = Math.max(8, (limits.landingZoneRadiusM / Math.max(alt, 60)) * w * scale * 1.6);

  for (const hz of mission.hazards) {
    drawHazard(ctx, hz, w, zoneY, zoneW);
  }

  if (zoneY > horizonY && zoneY < h + 40) {
    ctx.strokeStyle = "#41e08a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w / 2, zoneY, zoneW, Math.max(3, zoneW * 0.35), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(65,224,138,0.10)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.fillStyle = "#41e08a";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("LANDING ZONE", w / 2 - 38, zoneY - Math.max(6, zoneW * 0.35) - 4);
  } else {
    ctx.fillStyle = "#41e08a";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(
      `LZ ${(downrangeM / 1000).toFixed(1)} km ahead`,
      w / 2 - 42,
      horizonY - 8,
    );
  }

  // LPD (landing-point designator) reticle — authentic aid, advisory only.
  ctx.strokeStyle = "rgba(190,255,210,0.45)";
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.18);
  ctx.lineTo(w / 2, h * 0.9);
  ctx.moveTo(w * 0.12, horizonY);
  ctx.lineTo(w * 0.88, horizonY);
  ctx.stroke();
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = "rgba(190,255,210,0.6)";
  for (let deg = 10; deg <= 60; deg += 10) {
    const y = horizonY + (deg / 70) * (h - horizonY);
    ctx.beginPath();
    ctx.moveTo(w / 2 - 10, y);
    ctx.lineTo(w / 2 + 10, y);
    ctx.stroke();
    ctx.fillText(String(deg), w / 2 + 14, y + 3);
  }

  // Window frame.
  ctx.strokeStyle = "#4a4a4a";
  ctx.lineWidth = 10;
  ctx.strokeRect(-5, -5, w + 10, h + 10);
  ctx.lineWidth = 1;

  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("COMMANDER'S WINDOW · LPD", 10, 16);
  ctx.fillStyle = phase.id === "braking" ? "#fbbf24" : "#41e08a";
  ctx.fillText(`${phase.label} · ${(pitch * 180) / Math.PI | 0}° FROM VERTICAL`, 10, 30);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(phase.windowView, 10, 42);
  if (horizonY > h - 4) {
    ctx.fillStyle = "#fbbf24";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText("SURFACE BELOW THE WINDOW SILL", 10, h / 2);
  }
  ctx.restore();

}

function drawHazard(
  ctx: CanvasRenderingContext2D,
  hz: Hazard,
  w: number,
  zoneY: number,
  zoneW: number,
) {
  const cx = w / 2 + (hz.angleOffsetRad * 1_737_400 * 0.02);
  const r = Math.max(4, (hz.radiusM / 120) * zoneW);
  ctx.strokeStyle = hz.kind === "crater" ? "#8a7a5f" : "#9a6a5a";
  ctx.fillStyle = hz.kind === "crater" ? "rgba(60,52,40,0.75)" : "rgba(70,45,40,0.6)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 1.4, zoneY - r * 0.5, r, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function groundY(rangeM: number, altitudeM: number, horizonY: number, h: number): number {
  // Simple perspective: closer ground is lower on the screen.
  const t = Math.atan2(altitudeM, Math.max(1, rangeM)); // 0 = far, pi/2 = below
  return horizonY + (t / (Math.PI / 2)) * (h - horizonY);
}

// -----------------------------------------------------------------------------
// Side profile inset
// -----------------------------------------------------------------------------

/** Snapped display spans, so the axes hold still while the vehicle moves. */
const SPAN_LADDER = [
  30, 60, 120, 250, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 40_000, 80_000,
];

function snapSpan(value: number, minimum: number): number {
  const want = Math.max(minimum, value);
  for (const s of SPAN_LADDER) if (s >= want) return s;
  return SPAN_LADDER[SPAN_LADDER.length - 1]!;
}

function metresLabel(m: number): string {
  return m >= 1_000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

/**
 * Reference descent profile: altitude as a function of range-to-go, anchored
 * on the published Apollo 11 gates (PDI ~8.5 nmi slant, high gate 7,600 ft at
 * ~4.5 nmi to go, low gate 500 ft at ~2,000 ft to go, touchdown at 0).
 * Advisory only — the vehicle is never steered onto it.
 */
function referenceAltitudeM(
  rangeM: number,
  initialRangeM: number,
  initialAltitudeM: number,
): number {
  const knots: [number, number][] = [
    [0, 0],
    [600, 152],
    [8_300, 2_316],
    [Math.max(9_000, initialRangeM), Math.max(2_400, initialAltitudeM)],
  ];
  const r = Math.max(0, rangeM);
  for (let i = 1; i < knots.length; i++) {
    const [r0, a0] = knots[i - 1]!;
    const [r1, a1] = knots[i]!;
    if (r <= r1) {
      const t = r1 === r0 ? 0 : (r - r0) / (r1 - r0);
      return a0 + (a1 - a0) * t;
    }
  }
  return knots[knots.length - 1]![1];
}

function rollLabel(rollDeg: number): string {
  if (rollDeg <= 5) return "WINDOWS UP \u00b7 RADAR AT SURFACE";
  if (rollDeg >= 175) return "WINDOWS DOWN \u00b7 CREW FACING SPACE";
  return `ROLLING ${rollDeg.toFixed(0)}\u00b0`;
}


function cwLabelColor(rollDeg: number): string {
  if (rollDeg <= 5) return "#41e08a";
  if (rollDeg >= 175) return "#fbbf24";
  return "#7dd3fc";
}

function drawProfile(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  {
    flight, orbit, downrangeM, mission, limits, trail, rollDeg, manual, p64Selected,
  }: DrawArgs,
) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = "#07090c";
  ctx.fillRect(0, 0, w, h);

  const padTop = 34;
  const padBottom = 26;
  const padLeft = 42;
  const groundLine = h - padBottom;

  // Snapped spans: the picture rescales in discrete steps as the vehicle
  // descends, so the altitude on screen always agrees with the readout
  // instead of the vehicle floating at a fixed height on an elastic axis.
  const altSpan = snapSpan(Math.max(orbit.altitudeM, 0) * 1.25, 30);
  const rangeSpan = snapSpan(Math.abs(downrangeM) * 1.3, 60);

  const yFor = (altM: number) =>
    groundLine - (Math.max(0, altM) / altSpan) * (groundLine - padTop);
  const xFor = (rangeM: number) => w / 2 - (rangeM / rangeSpan) * (w / 2 - padLeft * 0.6);

  // Altitude grid with labels — these are the numbers the altimeter shows.
  ctx.font = "9px ui-monospace, monospace";
  for (let i = 1; i <= 4; i++) {
    const alt = (altSpan * i) / 4;
    const y = yFor(alt);
    ctx.strokeStyle = "rgba(120,130,140,0.16)";
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - 6, y);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.fillText(metresLabel(alt), 4, y + 3);
  }

  // Range ticks along the surface.
  for (const frac of [0.5, 1]) {
    const range = rangeSpan * frac;
    const x = xFor(range);
    if (x < padLeft) continue;
    ctx.strokeStyle = "rgba(120,130,140,0.16)";
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, groundLine);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.fillText(metresLabel(range), x + 3, groundLine + 12);
  }

  // Surface.
  ctx.strokeStyle = "#6b6255";
  ctx.beginPath();
  ctx.moveTo(0, groundLine);
  ctx.lineTo(w, groundLine);
  ctx.stroke();

  // Reference descent profile (advisory), drawn across the visible range.
  ctx.strokeStyle = "rgba(96,165,250,0.45)";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const range = (rangeSpan * i) / 48;
    const alt = referenceAltitudeM(
      range,
      mission.initial.rangeToLandingZoneM,
      mission.initial.altitudeM,
    );
    const px = xFor(range);
    const py = yFor(Math.min(alt, altSpan));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Flown path.
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(65,224,138,0.55)";
    ctx.beginPath();
    trail.forEach((p, i) => {
      const px = xFor(p.rangeM);
      const py = yFor(p.altitudeM);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Landing zone marker at range 0.
  const lzX = xFor(0);
  ctx.strokeStyle = "#41e08a";
  ctx.beginPath();
  ctx.moveTo(lzX - 12, groundLine);
  ctx.lineTo(lzX + 12, groundLine);
  ctx.moveTo(lzX, groundLine);
  ctx.lineTo(lzX, groundLine - 10);
  ctx.stroke();
  ctx.fillStyle = "#41e08a";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(`±${limits.landingZoneRadiusM}m`, lzX - 16, groundLine + 12);

  // Vehicle.
  const vx = xFor(downrangeM);
  const vy = yFor(orbit.altitudeM);
  ctx.save();
  ctx.translate(vx, vy);
  // Pitch from local vertical: near 90 deg on its back through braking, then
  // pitch-over at high gate, then near upright for the landing phase.
  ctx.rotate(
    displayPitchRad(flight.attitudeRad, orbit.altitudeM, manual, { p64Selected }),
  );
  // M4.8 — roll about the thrust axis. cos(roll) = +1 windows-up (crew and
  // landing radar looking at the surface), -1 windows-down (the PDI attitude
  // Eagle flew before the windows-up roll).
  const rollRad = (rollDeg * Math.PI) / 180;
  const cw = Math.cos(rollRad);
  // Ascent-stage cabin.
  ctx.fillStyle = "#d6d3d1";
  ctx.fillRect(-7, -6, 14, 10);
  // Crew window band and the landing-radar antenna sit on opposite faces of
  // the vehicle, so the silhouette reads the roll state directly. Rolling
  // about the thrust axis never inverts the side-view silhouette; what it
  // swaps is which face looks at the surface.
  const windowY = cw > 0 ? 2.4 : -4.6; // windows-up -> band low (facing surface)
  ctx.fillStyle = "#7dd3fc";
  ctx.globalAlpha = cw > 0 ? 1 : 0.28;
  ctx.fillRect(-6, windowY, 12, 2.6);
  ctx.globalAlpha = 1;
  // Landing-radar antenna on the opposite face; solid when it can see ground.
  const radarY = cw > 0 ? -6 : 4;
  ctx.fillStyle = cw > 0 ? "#4b5563" : "#fbbf24";
  ctx.fillRect(-3.5, radarY - 1.6, 7, 1.8);
  // Descent stage.
  ctx.fillStyle = "#a8a29e";
  ctx.fillRect(-5, 4, 10, 5);

  ctx.strokeStyle = "#a8a29e";
  ctx.beginPath();
  ctx.moveTo(-6, 9); ctx.lineTo(-9, 14);
  ctx.moveTo(6, 9); ctx.lineTo(9, 14);
  ctx.stroke();
  if (flight.throttle > 0 && flight.mainEngine !== "off") {
    const len = 8 + flight.throttle * 26;
    const g = ctx.createLinearGradient(0, 9, 0, 9 + len);
    g.addColorStop(0, "rgba(255,214,150,0.95)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-4, 9);
    ctx.lineTo(4, 9);
    ctx.lineTo(0, 9 + len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Roll state caption: the vehicle starts the braking phase windows-down and
  // the player rolls it windows-up before the radar can look at the surface.
  ctx.fillStyle = cwLabelColor(rollDeg);
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(rollLabel(rollDeg), vx + 12, vy - 6);

  // Velocity vector.
  ctx.strokeStyle = "#60a5fa";
  ctx.beginPath();
  ctx.moveTo(vx, vy);
  ctx.lineTo(
    vx + Math.max(-60, Math.min(60, orbit.tangentialSpeedMps * 0.8)),
    vy - Math.max(-60, Math.min(60, orbit.radialSpeedMps * 0.8)),
  );
  ctx.stroke();

  // Header: altitude and the deviation from the reference profile, so the
  // picture and the altimeter can be read against each other directly.
  const refAlt = referenceAltitudeM(
    Math.abs(downrangeM),
    mission.initial.rangeToLandingZoneM,
    mission.initial.altitudeM,
  );
  const deviation = orbit.altitudeM - refAlt;
  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`DESCENT PROFILE · ${descentPhaseFor(orbit.altitudeM, { p64Selected }).label}`, 10, 14);
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(`ALT ${metresLabel(orbit.altitudeM)}`, 10, 26);
  ctx.fillStyle = Math.abs(deviation) < altSpan * 0.12 ? "#41e08a" : "#fbbf24";
  ctx.fillText(
    `${deviation >= 0 ? "+" : "−"}${metresLabel(Math.abs(deviation))} vs profile`,
    112,
    26,
  );
  ctx.restore();
}

