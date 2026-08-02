// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.34 — First-person commander's-window view.
//
// A toggleable alternative to the LunarScene profile: what Armstrong saw out
// the left forward window on final approach — the LPD reticle etched on the
// glass, the surface and its landmarks sweeping past, the landing zone growing
// in the reticle, and the LM's own shadow rising to meet the vehicle.
//
// Pure presentation. Reads flight state and paints; never mutates it.

import { useEffect, useRef } from "react";
import type { LunarFlightState, LunarOrbitalValues } from "@/simulation/lunar2d";
import type { MissionDefinition } from "@/game/play";
import { displayPitchRad } from "@/game/play/descentPhase";
import {
  buildLandmarks,
  dustDensity,
  horizonY,
  nearFieldPocks,
  projectSurfacePoint,
  shadowEnvelope,
  type SurfaceLandmark,
  type WindowProjection,
} from "@/game/play/windowLandmarks";

export interface CockpitWindowViewProps {
  flight: LunarFlightState;
  orbit: LunarOrbitalValues;
  downrangeM: number;
  mission: MissionDefinition;
  manual: boolean;
  rollDeg?: number;
  p64Selected?: boolean;
}

interface DrawArgs extends Required<Omit<CockpitWindowViewProps, "mission">> {
  mission: MissionDefinition;
  landmarks: readonly SurfaceLandmark[];
}

export function CockpitWindowView(props: CockpitWindowViewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const landmarksRef = useRef<{ id: string; marks: readonly SurfaceLandmark[] }>({
    id: props.mission.id,
    marks: buildLandmarks(props.mission.id),
  });
  if (landmarksRef.current.id !== props.mission.id) {
    landmarksRef.current = {
      id: props.mission.id,
      marks: buildLandmarks(props.mission.id),
    };
  }

  const argsRef = useRef<DrawArgs>({
    ...props,
    rollDeg: props.rollDeg ?? 0,
    p64Selected: props.p64Selected ?? true,
    landmarks: landmarksRef.current.marks,
  });
  argsRef.current = {
    ...props,
    rollDeg: props.rollDeg ?? 0,
    p64Selected: props.p64Selected ?? true,
    landmarks: landmarksRef.current.marks,
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
        draw(ctx, w, h, argsRef.current);
      }
      frame = requestAnimationFrame(paint);
    };

    paint();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={ref}
      data-testid="cockpit-window-view"
      className="h-[380px] w-full rounded border border-neutral-800 bg-black"
      aria-label="First-person view from the commander's forward window"
    />
  );
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** The commander's forward window outline: the LM's triangular pane, apex
 *  outboard-low, chamfered at each corner, in normalized window-box coords. */
const WINDOW_SHAPE: readonly (readonly [number, number])[] = [
  [0.05, 0.30],
  [0.11, 0.19],
  [0.88, 0.31],
  [0.96, 0.41],
  [0.95, 0.52],
  [0.46, 0.95],
  [0.33, 0.94],
];


function windowPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  continuePath = false,
) {
  if (!continuePath) ctx.beginPath();
  WINDOW_SHAPE.forEach(([nx, ny], i) => {
    const px = x + nx * w;
    const py = y + ny * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  // Cockpit interior behind everything.
  ctx.fillStyle = "#101211";
  ctx.fillRect(0, 0, w, h);

  const panelX = Math.round(w * 0.72);
  const glassW = panelX;

  // --- Out-the-window scene, clipped to the window aperture.
  ctx.save();
  windowPath(ctx, 0, 0, glassW, h);
  ctx.clip();
  drawScene(ctx, glassW, h, a);
  ctx.restore();

  // --- Window frame: bevelled sill and rivet line.
  drawFrame(ctx, glassW, h);

  // --- Slice of the adjacent instrument panel on the right.
  drawPanelSlice(ctx, panelX, w - panelX, h, a);

  // --- Etched readouts along the sill.
  drawReadouts(ctx, glassW, h, a);
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const alt = Math.max(0, a.orbit.altitudeM);
  const pitch = displayPitchRad(a.flight.attitudeRad, alt, a.manual, {
    p64Selected: a.p64Selected,
  });
  const proj: WindowProjection = {
    width: w,
    height: h,
    altitudeM: alt,
    pitchRad: Math.max(0.02, pitch),
    rollRad: 0,
  };
  const hy = horizonY(proj);

  // Space and surface.
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, w, h);
  const top = Math.max(-h, Math.min(h, hy));
  const grad = ctx.createLinearGradient(0, top, 0, h);
  grad.addColorStop(0, "#8d8b85");
  grad.addColorStop(0.55, "#6c6a64");
  grad.addColorStop(1, "#4c4a45");
  ctx.fillStyle = grad;
  ctx.fillRect(0, top, w, h - top);

  if (hy > -h && hy < h) {
    ctx.strokeStyle = "#cfc4b0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, hy);
    ctx.lineTo(w, hy);
    ctx.stroke();
  }

  const rangeToGoM = Math.abs(a.downrangeM);

  // Near-field regolith texture, so the ground reads as moving even in a hover.
  if (alt < 3_000) {
    for (const pock of nearFieldPocks(rangeToGoM)) {
      const aheadM = rangeToGoM - pock.trackRangeM;
      const p = projectSurfacePoint(aheadM, pock.lateralM, proj);
      if (!p.visible) continue;
      const rx = pock.radiusM * p.scale;
      if (rx < 0.8 || p.x < -40 || p.x > w + 40 || p.y < top || p.y > h + 40) continue;
      drawLandmark(ctx, p.x, p.y, rx, pock);
    }
  }

  // Landmarks: far to near so nearer features overpaint.
  for (const mark of a.landmarks) {
    const aheadM = rangeToGoM - mark.trackRangeM;
    if (aheadM < -400 || aheadM > 40_000) continue;
    const p = projectSurfacePoint(aheadM, mark.lateralM, proj);
    if (!p.visible) continue;
    const rx = mark.radiusM * p.scale;
    if (rx < 0.6 || p.x < -w || p.x > 2 * w || p.y < top - 40 || p.y > h + 200) continue;
    drawLandmark(ctx, p.x, p.y, rx, mark);
  }

  // Landing zone in the reticle.
  const lz = projectSurfacePoint(rangeToGoM, 0, proj);
  if (lz.visible && lz.y > top) {
    const r = Math.max(4, 60 * lz.scale);
    ctx.strokeStyle = "#f0c56a";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(lz.x, lz.y, r * 1.6, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lz.x - r * 2.1, lz.y);
    ctx.lineTo(lz.x - r * 1.7, lz.y);
    ctx.moveTo(lz.x + r * 1.7, lz.y);
    ctx.lineTo(lz.x + r * 2.1, lz.y);
    ctx.stroke();
    ctx.fillStyle = "#f0c56a";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("LZ", lz.x, lz.y - r * 0.9);
  }

  // LM shadow — sun low behind the vehicle, so the shadow lies ahead and
  // sweeps back toward the LM (growing fast) as it settles.
  const shadow = shadowEnvelope(alt);
  if (shadow.intensity > 0) {
    const s = projectSurfacePoint(shadow.offsetM, shadow.lateralM, proj);
    if (s.visible) {
      const r = Math.max(3, shadow.radiusM * s.scale);
      const gear = Math.max(0, Math.min(1, (12 - alt) / 12));
      ctx.save();
      ctx.globalAlpha = Math.min(0.9, 0.12 + shadow.intensity * 0.78);
      ctx.fillStyle = "#050604";
      // Descent-stage body.
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * 0.9, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      // Splayed landing gear, prominent in the last forty feet.
      ctx.strokeStyle = "#050604";
      ctx.lineWidth = Math.max(1, r * (0.07 + gear * 0.09));
      for (const ang of [0.7, 2.44, 3.84, 5.58]) {
        const legX = s.x + Math.cos(ang) * r * (1.5 + gear * 0.5);
        const legY = s.y + Math.sin(ang) * r * (0.55 + gear * 0.2);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(legX, legY);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(legX, legY, r * 0.2, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }


  // Dust streaming radially outward under the engine.
  const dust = dustDensity(alt, a.flight.throttle);
  if (dust > 0) {
    ctx.save();
    const cx = w * 0.5;
    const cy = h * 0.94;
    ctx.globalAlpha = Math.min(0.6, dust * 0.7);
    ctx.strokeStyle = "#b9ad9a";
    ctx.lineWidth = 1;
    for (let i = 0; i < 46; i += 1) {
      const t = i / 46;
      const ang = Math.PI + t * Math.PI;
      const len = (0.25 + ((i * 37) % 100) / 100) * w * 0.55 * (0.4 + dust);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * w * 0.05, cy + Math.sin(ang) * h * 0.02);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.28);
      ctx.stroke();
    }
    const veil = ctx.createLinearGradient(0, h * 0.6, 0, h);
    veil.addColorStop(0, "rgba(190,178,158,0)");
    veil.addColorStop(1, `rgba(190,178,158,${(0.55 * dust).toFixed(3)})`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = veil;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    ctx.restore();
  }

  drawLpdReticle(ctx, w, h, proj);
}

function drawLandmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  mark: SurfaceLandmark,
) {
  const flat = 0.34;
  if (mark.kind === "rille") {
    ctx.strokeStyle = `rgba(52,47,40,${0.4 + mark.albedo * 0.4})`;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x, y - r * flat * 1.4, x + r, y + r * flat * 0.5);
    ctx.stroke();
    return;
  }
  if (mark.kind === "boulder-field") {
    ctx.fillStyle = `rgba(28,26,22,0.9)`;
    for (let i = 0; i < 7; i += 1) {
      const ang = (i / 7) * Math.PI * 2 + mark.trackRangeM;
      const br = Math.max(0.7, r * 0.16);
      ctx.beginPath();
      ctx.ellipse(
        x + Math.cos(ang) * r * 0.8,
        y + Math.sin(ang) * r * flat,
        br,
        br * 0.7,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(214,203,183,${0.35 + mark.albedo * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * flat, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // Crater: shadowed far wall, lit near rim.
  ctx.fillStyle = `rgba(28,28,26,${0.3 + mark.albedo * 0.3})`;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * flat, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(226,216,196,${0.35 + mark.albedo * 0.5})`;
  ctx.lineWidth = Math.max(1.1, r * 0.12);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * flat, 0, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
}

/**
 * The LPD scale etched on the commander's window: numbered degree marks the
 * crew read against the surface to see where the AGC was taking them.
 */
function drawLpdReticle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  proj: WindowProjection,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(226,232,240,0.42)";
  ctx.fillStyle = "rgba(226,232,240,0.55)";
  ctx.lineWidth = 1;
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "left";

  const focal = w / 2 / Math.tan(32 * (Math.PI / 180));
  for (let deg = 10; deg <= 70; deg += 10) {
    // Look angle measured from straight down; the scale sits on the glass.
    const ang = deg * (Math.PI / 180);
    const forward = Math.cos(ang - proj.pitchRad);
    if (forward <= 0.05) continue;
    const y = h / 2 - (Math.sin(ang - proj.pitchRad) / forward) * focal;
    if (y < 4 || y > h - 4) continue;
    ctx.beginPath();
    ctx.moveTo(w * 0.06, y);
    ctx.lineTo(w * 0.13, y);
    ctx.stroke();
    ctx.fillText(String(deg), w * 0.14, y + 3);
  }

  // Centre sight line.
  ctx.strokeStyle = "rgba(226,232,240,0.3)";
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.32);
  ctx.lineTo(w / 2, h * 0.44);
  ctx.moveTo(w / 2, h * 0.56);
  ctx.lineTo(w / 2, h * 0.68);
  ctx.moveTo(w * 0.40, h / 2);
  ctx.lineTo(w * 0.46, h / 2);
  ctx.moveTo(w * 0.54, h / 2);
  ctx.lineTo(w * 0.60, h / 2);
  ctx.stroke();
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Outer structure: everything outside the aperture is cockpit skin.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  windowPath(ctx, 0, 0, w, h, true);
  ctx.clip("evenodd");
  ctx.fillStyle = "#1b1d1c";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  ctx.save();


  // Bevelled inner sill.
  windowPath(ctx, 0, 0, w, h);
  ctx.strokeStyle = "#3a3d3b";
  ctx.lineWidth = 8;
  ctx.stroke();
  windowPath(ctx, 0, 0, w, h);
  ctx.strokeStyle = "#0a0b0a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rivet line following the lower sill.
  ctx.fillStyle = "#4c504d";
  const pts = WINDOW_SHAPE;
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[(i + 1) % pts.length]!;
    const segs = 9;
    for (let s = 0; s < segs; s += 1) {
      const t = (s + 0.5) / segs;
      const px = (ax + (bx - ax) * t) * w;
      const py = (ay + (by - ay) * t) * h;
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPanelSlice(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  h: number,
  a: DrawArgs,
) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.fillStyle = "#1b1d1c";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#0a0b0a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(1, h);
  ctx.stroke();

  // Annunciator block.
  const cols = 2;
  const rows = 3;
  const pad = 10;
  const cw = (w - pad * 2) / cols - 4;
  const chh = 16;
  const labels = ["ALT", "VEL", "GIMBAL", "DES QTY", "RCS", "ENG"];
  ctx.font = "7px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lx = pad + c * (cw + 4);
      const ly = 14 + r * (chh + 5);
      ctx.fillStyle = "#121413";
      ctx.fillRect(lx, ly, cw, chh);
      ctx.strokeStyle = "#2b2e2c";
      ctx.lineWidth = 1;
      ctx.strokeRect(lx + 0.5, ly + 0.5, cw - 1, chh - 1);
      ctx.fillStyle = "#6d726e";
      ctx.fillText(labels[r * cols + c] ?? "", lx + cw / 2, ly + 11);
    }
  }

  // Circuit-breaker rows.
  ctx.fillStyle = "#2a2d2b";
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      ctx.beginPath();
      ctx.arc(pad + 6 + c * ((w - pad * 2) / 5), h * 0.48 + r * 22, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Contact light — blue, mirrors the cockpit lamp.
  const contact = a.flight.terminalState !== null || a.orbit.altitudeM <= 1.7;
  ctx.fillStyle = contact ? "#2f6fe0" : "#141a22";
  ctx.fillRect(pad, h - 34, w - pad * 2, 22);
  ctx.strokeStyle = "#0a0b0a";
  ctx.strokeRect(pad + 0.5, h - 33.5, w - pad * 2 - 1, 21);
  ctx.fillStyle = contact ? "#eaf2ff" : "#3a4350";
  ctx.font = "8px ui-monospace, monospace";
  ctx.fillText("LUNAR CONTACT", pad + (w - pad * 2) / 2, h - 19);
  ctx.restore();
}

function drawReadouts(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const alt = Math.max(0, a.orbit.altitudeM);
  const ft = alt * 3.280839895;
  const rows: [string, string][] = [
    ["ALT", `${Math.round(ft).toLocaleString()} FT`],
    ["RATE", `${(a.orbit.radialSpeedMps * 3.280839895).toFixed(1)} FPS`],
    ["FWD", `${(a.orbit.tangentialSpeedMps * 3.280839895).toFixed(0)} FPS`],
    ["RNG", `${(Math.abs(a.downrangeM) * 3.280839895).toFixed(0)} FT`],
  ];
  ctx.save();
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "left";
  let y = h - 12;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const [k, v] = rows[i]!;
    ctx.fillStyle = "#5f6663";
    ctx.fillText(k, 10, y);
    ctx.fillStyle = "#5df2a3";
    ctx.fillText(v, 46, y);
    y -= 13;
  }
  ctx.restore();
}
