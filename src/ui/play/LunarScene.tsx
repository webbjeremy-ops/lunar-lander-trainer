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

export function LunarScene({
  flight,
  orbit,
  downrangeM,
  mission,
  limits,
  manual,
}: {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  downrangeM: number;
  mission: MissionDefinition;
  limits: LandingLimits;
  manual: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h, { flight, orbit, downrangeM, mission, limits, manual });
  }, [flight, orbit, downrangeM, mission, limits, manual]);

  return (
    <canvas
      ref={ref}
      data-testid="play-scene"
      className="h-[380px] w-full rounded border border-neutral-800 bg-black"
      aria-label="Lunar module out-the-window view and descent profile"
    />
  );
}

interface DrawArgs {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  downrangeM: number;
  mission: MissionDefinition;
  limits: LandingLimits;
  manual: boolean;
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
  { flight, orbit, downrangeM, mission, limits }: DrawArgs,
) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // Sky (lunar black) and the pitch-driven horizon.
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, w, h);

  const pitch = flight.attitudeRad; // 0 = thrust up = looking level-ish
  const horizonY = h * 0.36 + pitch * h * 0.35;

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

function drawProfile(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  { flight, orbit, downrangeM, limits }: DrawArgs,
) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = "#07090c";
  ctx.fillRect(0, 0, w, h);

  const pad = 26;
  const groundLine = h - pad;
  const altSpan = Math.max(60, orbit.altitudeM * 1.35);
  const rangeSpan = Math.max(120, Math.abs(downrangeM) * 1.6);

  const yFor = (altM: number) => groundLine - (altM / altSpan) * (groundLine - pad);
  const xFor = (rangeM: number) => w / 2 - (rangeM / rangeSpan) * (w / 2 - pad);

  // Surface.
  ctx.strokeStyle = "#6b6255";
  ctx.beginPath();
  ctx.moveTo(0, groundLine);
  ctx.lineTo(w, groundLine);
  ctx.stroke();

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
  ctx.rotate(flight.attitudeRad);
  ctx.fillStyle = "#d6d3d1";
  ctx.fillRect(-7, -6, 14, 10);
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

  // Velocity vector.
  ctx.strokeStyle = "#60a5fa";
  ctx.beginPath();
  ctx.moveTo(vx, vy);
  ctx.lineTo(
    vx + Math.max(-60, Math.min(60, orbit.tangentialSpeedMps * 0.8)),
    vy - Math.max(-60, Math.min(60, orbit.radialSpeedMps * 0.8)),
  );
  ctx.stroke();

  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("DESCENT PROFILE", 10, 16);
  ctx.fillText(`${orbit.altitudeM.toFixed(0)} m`, 10, 30);
  ctx.restore();
}
