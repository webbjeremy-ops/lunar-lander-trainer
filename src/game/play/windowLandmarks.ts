// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.34 — Commander's-window terrain model (pure presentation math).
//
// The out-the-window first-person view needs three things that are not part of
// the flight kernel and must never be:
//
//   * a deterministic set of surface landmarks along the ground track, so the
//     same mission always flies over the same craters and boulder fields;
//   * a pinhole projection from (range ahead, lateral offset) on the surface to
//     window coordinates for the current altitude and pitch;
//   * the LM-shadow and dust envelopes that appear in the last few hundred feet.
//
// Everything here is a pure function of its inputs. No clocks, no randomness at
// call time (the landmark table is seeded), no side effects.

export type LandmarkKind = "crater" | "boulder-field" | "rille";

export interface SurfaceLandmark {
  readonly id: string;
  readonly kind: LandmarkKind;
  /** Distance along the ground track, measured from the landing zone (m).
   *  Positive = uprange of the LZ, i.e. crossed before arrival. */
  readonly trackRangeM: number;
  /** Lateral offset from the ground track, positive = right of track (m). */
  readonly lateralM: number;
  /** Characteristic radius on the surface (m). */
  readonly radiusM: number;
  /** Relative brightness of the rim/ejecta, [0, 1]. */
  readonly albedo: number;
}

// ---------------------------------------------------------------------------
// Deterministic landmark table
// ---------------------------------------------------------------------------

/** Mulberry32 — small, fast, fully deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a mission id, so each mission has its own terrain. */
export function seedForMission(missionId: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < missionId.length; i += 1) {
    h ^= missionId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Landmarks along the last stretch of the ground track.
 *
 * Placed from the LZ backwards so the field the crew sees on final approach is
 * identical no matter how long the braking phase actually ran. West Crater —
 * the boulder field Armstrong flew past — is always seeded just uprange of the
 * landing zone.
 */
export function buildLandmarks(
  missionId: string,
  options: { readonly count?: number; readonly maxRangeM?: number } = {},
): readonly SurfaceLandmark[] {
  const count = options.count ?? 42;
  const maxRangeM = options.maxRangeM ?? 12_000;
  const rand = mulberry32(seedForMission(missionId));

  const marks: SurfaceLandmark[] = [
    // The boulder-strewn crater Armstrong overflew on the way to Tranquility.
    {
      id: "west-crater",
      kind: "boulder-field",
      trackRangeM: 620,
      lateralM: -40,
      radiusM: 90,
      albedo: 0.85,
    },
  ];

  for (let i = 0; i < count; i += 1) {
    const t = (i + rand() * 0.8) / count;
    const trackRangeM = 140 + t * maxRangeM;
    const spread = 300 + trackRangeM * 0.35;
    const kindRoll = rand();
    const kind: LandmarkKind =
      kindRoll > 0.9 ? "rille" : kindRoll > 0.72 ? "boulder-field" : "crater";
    marks.push({
      id: `lm-${i}`,
      kind,
      trackRangeM,
      lateralM: (rand() * 2 - 1) * spread,
      radiusM:
        kind === "rille"
          ? 120 + rand() * 400
          : kind === "boulder-field"
            ? 25 + rand() * 60
            : 15 + rand() * 170,
      albedo: 0.35 + rand() * 0.6,
    });
  }

  marks.sort((a, b) => b.trackRangeM - a.trackRangeM);
  return marks;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface WindowProjection {
  /** Window width and height in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Altitude above the surface, metres. */
  readonly altitudeM: number;
  /** Pitch from local vertical, radians (0 = upright, thrust straight down). */
  readonly pitchRad: number;
  /** Roll about the thrust axis, radians (0 = windows up). */
  readonly rollRad?: number;
  /** Half the horizontal field of view, radians. */
  readonly halfFovRad?: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** Slant distance from the vehicle, metres. */
  readonly distanceM: number;
  /** Metres-per-pixel scale at that point, for sizing surface features. */
  readonly scale: number;
  /** False when the point is behind the camera or above the horizon. */
  readonly visible: boolean;
}

const DEFAULT_HALF_FOV = 32 * (Math.PI / 180);

/**
 * Project a point on the surface into window coordinates.
 *
 * The commander looks out along the vehicle's +Z window axis. With the vehicle
 * pitched back by `pitchRad` from local vertical, the look direction is tilted
 * that far from straight down: at 0 the crew stares at the surface directly
 * below, near 90 deg they look at the horizon.
 *
 * `aheadM` is distance along the ground track ahead of the vehicle, `rightM`
 * lateral offset (positive right of track).
 */
export function projectSurfacePoint(
  aheadM: number,
  rightM: number,
  p: WindowProjection,
): ProjectedPoint {
  const alt = Math.max(1, p.altitudeM);
  const halfFov = p.halfFovRad ?? DEFAULT_HALF_FOV;
  const roll = p.rollRad ?? 0;

  // Camera frame: look direction pitched `pitchRad` off nadir, toward +ahead.
  const pitch = p.pitchRad;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // Vehicle-relative vector to the surface point, in a frame where
  // x = right, y = down (toward the surface), z = along the ground track.
  const vx = rightM;
  const vy = alt;
  const vz = aheadM;

  // Rotate into camera axes: forward = (0, cp, sp), up = (0, sp, -cp).
  const forward = vy * cp + vz * sp;
  const up = vy * sp - vz * cp;
  const right = vx;

  const distanceM = Math.hypot(vx, vy, vz);
  if (forward <= 1) {
    return { x: 0, y: 0, distanceM, visible: false, scale: 0 };
  }

  const focal = p.width / 2 / Math.tan(halfFov);
  let sx = (right / forward) * focal;
  let sy = (up / forward) * focal;

  if (roll !== 0) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const rx = sx * cr - sy * sr;
    const ry = sx * sr + sy * cr;
    sx = rx;
    sy = ry;
  }

  return {
    x: p.width / 2 + sx,
    y: p.height / 2 + sy,
    distanceM,
    scale: focal / forward,
    visible: true,
  };
}

/** Screen y of the horizon for the current pitch, in window pixels. */
export function horizonY(p: WindowProjection): number {
  const halfFov = p.halfFovRad ?? DEFAULT_HALF_FOV;
  const focal = p.width / 2 / Math.tan(halfFov);
  // Horizon direction is level: forward component sin(pitch), up cos(pitch).
  const forward = Math.sin(p.pitchRad);
  if (forward <= 1e-3) return -1e6;
  return p.height / 2 + (-Math.cos(p.pitchRad) / forward) * focal;
}

// ---------------------------------------------------------------------------
// Shadow and dust envelopes
// ---------------------------------------------------------------------------

/** Altitude below which the LM's own shadow is discernible (m ≈ 150 ft). */
export const SHADOW_ONSET_M = 46;
/** Altitude below which surface dust begins to stream (m ≈ 100 ft). */
export const DUST_ONSET_M = 30;

export interface ShadowEnvelope {
  /** 0 = invisible, 1 = fully resolved at touchdown. */
  readonly intensity: number;
  /** Distance from the vehicle's ground point to the shadow centre, metres. */
  readonly offsetM: number;
  /** Apparent shadow radius on the surface, metres. */
  readonly radiusM: number;
}

/**
 * The LM shadow: with the sun low behind and to the left, the shadow lies out
 * ahead of the ground point at high altitude and slides in to meet the vehicle
 * as it settles — the cue the crews used for the last few feet.
 */
export function shadowEnvelope(
  altitudeM: number,
  options: { readonly sunElevationRad?: number } = {},
): ShadowEnvelope {
  const alt = Math.max(0, altitudeM);
  if (alt > SHADOW_ONSET_M) return { intensity: 0, offsetM: 0, radiusM: 0 };
  const sunElevation = options.sunElevationRad ?? 12 * (Math.PI / 180);
  const t = 1 - alt / SHADOW_ONSET_M; // 0 at onset, 1 at contact
  return {
    intensity: t * t,
    offsetM: alt / Math.tan(sunElevation),
    radiusM: 4.6 + alt * 0.02,
  };
}

/** Dust density in [0, 1]; zero above the onset altitude, 1 at contact. */
export function dustDensity(altitudeM: number, throttle: number): number {
  const alt = Math.max(0, altitudeM);
  if (alt > DUST_ONSET_M) return 0;
  const height = 1 - alt / DUST_ONSET_M;
  return Math.max(0, Math.min(1, height * height * Math.max(0.15, throttle)));
}
