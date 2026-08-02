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

/** Mean lunar radius, metres. */
export const MOON_RADIUS_M = 1_737_400;

/**
 * Angle by which the true horizon lies below the local level plane, radians.
 *
 * On a sphere the visible limb drops as you climb: acos(R / (R + h)). At the
 * high gate (~2.3 km) that is about 3 deg, and at PDI altitude (~15 km) close
 * to 5 deg — enough that black sky shows above the limb when the vehicle is
 * pitched well back early in the descent.
 */
export function horizonDipRad(altitudeM: number): number {
  const alt = Math.max(0, altitudeM);
  return Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + alt));
}

/** Screen y of the horizon for the current pitch, in window pixels. */
export function horizonY(p: WindowProjection): number {
  const halfFov = p.halfFovRad ?? DEFAULT_HALF_FOV;
  const focal = p.width / 2 / Math.tan(halfFov);
  // The limb sits `dip` below level, so it enters the frame like extra pitch.
  const theta = p.pitchRad + horizonDipRad(p.altitudeM);
  const forward = Math.sin(theta);
  if (forward <= 1e-3) return -1e6;
  return p.height / 2 + (-Math.cos(theta) / forward) * focal;
}


// ---------------------------------------------------------------------------
// Shadow and dust envelopes
// ---------------------------------------------------------------------------

/** Altitude below which the LM's own shadow is discernible (m ≈ 400 ft).
 *  Buzz first called the shadow around 260 ft and said in debrief he could
 *  probably have picked it up near 400 ft — so that is where it fades in. */
export const SHADOW_ONSET_M = 122;
/** Altitude at which the shadow is unmistakable (m ≈ 260 ft). */
export const SHADOW_CLEAR_M = 79;
/** Altitude below which surface dust begins to stream (m ≈ 100 ft). */
export const DUST_ONSET_M = 30;

/** Sun elevation at Tranquility Base during the landing (10.65 deg). */
export const SUN_ELEVATION_RAD = 10.65 * (Math.PI / 180);
/** Height of the cabin/descent-stage mass above the footpads (m). */
const VEHICLE_HEIGHT_M = 6.4;
/** Eagle was yawed ~13 deg left, throwing the shadow toward the right side. */
const YAW_LEFT_RAD = 13 * (Math.PI / 180);

export interface ShadowEnvelope {
  /** 0 = invisible, 1 = fully resolved at touchdown. */
  readonly intensity: number;
  /** Distance from the vehicle's ground point to the shadow centre, metres.
   *  Sun behind and low, so the shadow lies ahead, along the flight path. */
  readonly offsetM: number;
  /** Lateral displacement of the shadow, positive = right of track (m). */
  readonly lateralM: number;
  /** Apparent shadow radius on the surface, metres. */
  readonly radiusM: number;
}

/**
 * The LM shadow.
 *
 * With the Sun only 10.65 deg above the eastern horizon and Eagle flying west,
 * the light came from behind: the shadow lies *ahead* of the vehicle at roughly
 * `cot(10.65 deg) ≈ 5.32` times the height of whatever casts it, and sweeps
 * back toward the LM as it settles. It never collapses to nothing at contact —
 * the cabin and descent stage keep throwing a long shadow across the surface.
 */
export function shadowEnvelope(
  altitudeM: number,
  options: { readonly sunElevationRad?: number } = {},
): ShadowEnvelope {
  const alt = Math.max(0, altitudeM);
  if (alt > SHADOW_ONSET_M) {
    return { intensity: 0, offsetM: 0, lateralM: 0, radiusM: 0 };
  }
  const sunElevation = options.sunElevationRad ?? SUN_ELEVATION_RAD;
  const cot = 1 / Math.tan(sunElevation);

  // Faint from 400 ft, clearly usable by 260 ft, dominant in the last 40 ft.
  const fade = Math.min(1, (SHADOW_ONSET_M - alt) / (SHADOW_ONSET_M - SHADOW_CLEAR_M));
  const near = Math.max(0, Math.min(1, 1 - alt / SHADOW_CLEAR_M));
  const intensity = Math.min(1, 0.18 * fade + 0.82 * near * near);

  // The whole vehicle casts the shadow, so the throw never reaches zero.
  const offsetM = cot * (alt + VEHICLE_HEIGHT_M);
  return {
    intensity,
    offsetM,
    lateralM: offsetM * Math.sin(YAW_LEFT_RAD),
    radiusM: 4.6 + (alt + VEHICLE_HEIGHT_M) * 0.35,
  };
}


/** Dust density in [0, 1]; zero above the onset altitude, 1 at contact. */
export function dustDensity(altitudeM: number, throttle: number): number {
  const alt = Math.max(0, altitudeM);
  if (alt > DUST_ONSET_M) return 0;
  const height = 1 - alt / DUST_ONSET_M;
  return Math.max(0, Math.min(1, height * height * Math.max(0.15, throttle)));
}

// ---------------------------------------------------------------------------
// Near-field ground texture
// ---------------------------------------------------------------------------

function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Small pocks and stones tiled around the vehicle's current ground point.
 *
 * The seeded landmark table gives the crew recognisable features; this gives
 * the regolith immediately below the window enough texture to read as moving
 * even in a hover, and it is a pure function of the world cell indices, so the
 * same patch of ground always looks the same.
 */
export function nearFieldPocks(
  rangeToGoM: number,
  options: { readonly spanM?: number; readonly cellM?: number } = {},
): readonly SurfaceLandmark[] {
  const cell = options.cellM ?? 22;
  const span = options.spanM ?? 420;
  const out: SurfaceLandmark[] = [];
  const first = Math.floor((rangeToGoM - span) / cell);
  const last = Math.ceil((rangeToGoM + span) / cell);
  for (let i = first; i <= last; i += 1) {
    for (let j = -8; j <= 8; j += 1) {
      const r = hash2(i, j);
      if (r < 0.45) continue;
      out.push({
        id: `pock-${i}-${j}`,
        kind: r > 0.93 ? "boulder-field" : "crater",
        trackRangeM: (i + hash2(i, j + 91)) * cell,
        lateralM: (j + hash2(i + 17, j)) * cell,
        radiusM: 1.5 + hash2(i + 5, j + 5) * (r > 0.93 ? 4 : 9),
        albedo: 0.25 + hash2(i, j + 3) * 0.5,
      });
    }
  }
  out.sort((a, b) => b.trackRangeM - a.trackRangeM);
  return out;
}
