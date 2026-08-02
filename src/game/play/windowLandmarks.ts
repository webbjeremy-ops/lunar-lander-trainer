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
 * West Crater — the ~180 m boulder-strewn crater Armstrong overflew, deciding
 * on the way past that its blocky ejecta field was no place to set down. It is
 * always seeded just uprange of the landing zone so every mission flies the
 * same bypass the crew flew.
 */
export const WEST_CRATER: SurfaceLandmark = {
  id: "west-crater",
  kind: "crater",
  trackRangeM: 620,
  lateralM: -40,
  radiusM: 90,
  albedo: 0.9,
};

/**
 * The blocky ejecta apron around West Crater: football-to-Volkswagen sized
 * boulders scattered a crater-diameter out, which is what made the site
 * unlandable and forced the manual redesignation past it.
 */
export function westCraterBoulders(): readonly SurfaceLandmark[] {
  const out: SurfaceLandmark[] = [];
  for (let i = 0; i < 22; i += 1) {
    const r = hash2(i + 3, 71);
    const ang = (i / 22) * Math.PI * 2 + r * 0.5;
    const dist = WEST_CRATER.radiusM * (1.05 + hash2(i, 12) * 1.35);
    out.push({
      id: `west-boulder-${i}`,
      kind: "boulder-field",
      trackRangeM: WEST_CRATER.trackRangeM + Math.cos(ang) * dist,
      lateralM: WEST_CRATER.lateralM + Math.sin(ang) * dist,
      radiusM: 2.5 + hash2(i + 40, 9) * 7,
      albedo: 0.5 + hash2(i, 55) * 0.4,
    });
  }
  return out;
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

  const marks: SurfaceLandmark[] = [WEST_CRATER, ...westCraterBoulders()];


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
 * Upward cant of the commander's window boresight from the vehicle's forward
 * axis, radians.
 *
 * The LM's forward panes are set high in the cabin and the crew flew them
 * standing: with Eagle pitched well back the window is filled with black sky
 * and the limb sits low in the pane — which is why Aldrin could call the Earth
 * "straight out our front window" while the surface was still below the frame.
 * Without this cant the horizon rides above the pane centre and the view is
 * nearly all regolith.
 */
export const WINDOW_UP_CANT_RAD = 15 * (Math.PI / 180);

/**
 * Angle of the window boresight from straight down (nadir), radians.
 *
 * The commander's panes look perpendicular to the thrust axis, so WHICH WAY
 * the vehicle is rolled about that axis decides what fills the window:
 *
 * - Face-down (roll 180 deg, the PDI attitude): with Eagle pitched ~77 deg back
 *   the window looks only ~13 deg off nadir and the pane is filled with
 *   regolith running away beneath the feet toward the landing site. This is the
 *   attitude Armstrong flew through early braking.
 * - Rolled over (roll 0 deg, from the yaw-around at T+221 s): the same pitch now
 *   points the panes away from the surface, so the pane goes to black sky with
 *   the Earth in it — Aldrin's "Earth straight out our front window".
 * - Pitch-over for the approach then walks the look direction back down toward
 *   nadir, so the landing site rises into the pane and the Earth climbs out of
 *   it.
 *
 * The two ends are exact and the roll fraction blends between them, so the
 * horizon sweeps continuously through the pane while the player rolls.
 */
export function boresightFromNadirRad(pitchRad: number, rollRad = 0): number {
  const faceUp = pitchRad + WINDOW_UP_CANT_RAD;
  const faceDown = Math.abs(Math.PI / 2 - pitchRad);
  const u = (1 + Math.cos(rollRad)) / 2; // 1 = rolled over, 0 = face-down
  return u * faceUp + (1 - u) * faceDown;
}

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

  // Camera frame: look direction pitched `pitch` off nadir, toward +ahead.
  const pitch = boresightFromNadirRad(p.pitchRad, roll);
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
const LUNAR_RADIUS_M = 1_737_400;

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
  return Math.acos(LUNAR_RADIUS_M / (LUNAR_RADIUS_M + alt));
}

/**
 * Screen y of the horizon for the current attitude, in window pixels, measured
 * in the unrotated pane (callers apply the roll rotation themselves).
 */
export function horizonY(p: WindowProjection): number {
  const halfFov = p.halfFovRad ?? DEFAULT_HALF_FOV;
  const focal = p.width / 2 / Math.tan(halfFov);
  // The limb sits `dip` below level, so it enters the frame like extra pitch.
  const theta =
    boresightFromNadirRad(p.pitchRad, p.rollRad ?? 0) + horizonDipRad(p.altitudeM);

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
  // The blast sheet is engine-driven: at shutdown the moving dust stops dead
  // rather than hanging as a cloud (no atmosphere to suspend it).
  if (throttle <= 0.01) return 0;
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

/**
 * Broad, altitude-scaled crater field covering the whole ground track.
 *
 * The seeded landmark table only spans the last ~12 km, so through braking —
 * hundreds of kilometres uprange at 10–15 km altitude — the pane had nothing in
 * it and the descent looked static. This tiles deterministic craters whose cell
 * size grows with altitude, so there are always a few dozen features sweeping
 * through the window and the crew can see the ground track moving from PDI on.
 *
 * Pure function of the world cell indices: the same patch always looks the same.
 */
export function trackFieldFeatures(
  rangeToGoM: number,
  altitudeM: number,
  options: { readonly cellM?: number; readonly spanCells?: number } = {},
): readonly SurfaceLandmark[] {
  const alt = Math.max(50, altitudeM);
  // Cell size scales with altitude so the pane always holds a few dozen
  // features: at 16 km that is ~2.4 km craters, at 300 m it is ~120 m pocks.
  // Coarser than this and braking shows two or three blobs, which reads as a
  // still image rather than 1,700 m/s of ground track.
  const cell = options.cellM ?? Math.max(90, alt * 0.15);
  const spanCells = options.spanCells ?? 40;
  const centre = Math.round(rangeToGoM / cell);
  const out: SurfaceLandmark[] = [];
  for (let i = centre - 8; i <= centre + spanCells; i += 1) {
    for (let j = -10; j <= 10; j += 1) {
      const r = hash2(i * 7 + 13, j * 11 + 5);
      if (r < 0.4) continue;
      const kind: LandmarkKind = r > 0.965 ? "rille" : "crater";
      out.push({
        id: `field-${i}-${j}`,
        kind,
        trackRangeM: (i + hash2(i, j + 33)) * cell,
        lateralM: (j + hash2(i + 61, j)) * cell,
        radiusM:
          kind === "rille"
            ? cell * (0.5 + hash2(i + 2, j) * 1.2)
            : cell * (0.08 + hash2(i + 9, j + 4) * 0.34),
        albedo: 0.3 + hash2(i, j + 7) * 0.55,
      });
    }
  }

  out.sort((a, b) => b.trackRangeM - a.trackRangeM);
  return out;
}


// ---------------------------------------------------------------------------
// Earth in the window
// ---------------------------------------------------------------------------

/** Earth's apparent diameter from lunar distance: ~2 deg (12,750 km @ 385,000 km). */
export const EARTH_ANGULAR_DIAMETER_RAD = 1.9 * (Math.PI / 180);
/** Pitch at which Earth sits centred in the forward pane.
 *  At 102:38:20, just after the yaw-around and still pitched ~77 deg back,
 *  Aldrin called "got the Earth straight out our front window". */
export const EARTH_CENTRED_PITCH_RAD = 77 * (Math.PI / 180);
/** Earth stood 23 deg west of the lunar zenith: slightly off the track axis. */
export const EARTH_BEARING_RAD = -6 * (Math.PI / 180);
/** Below this altitude the crew is head-down on the landing area; Earth has
 *  long since climbed out of the forward window. */
export const EARTH_MIN_ALTITUDE_M = 1_500;

export interface EarthDisk {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  /** Apparent radius in window pixels. */
  readonly radiusPx: number;
  /** Illuminated fraction, gibbous (~0.7) during the landing. */
  readonly phase: number;
}

const EARTH_HIDDEN: EarthDisk = { visible: false, x: 0, y: 0, radiusPx: 0, phase: 0.7 };

/**
 * Where the Earth appears in the commander's window.
 *
 * A small, intensely bright gibbous disk in pure blackness — about 2 deg
 * across, four Moon-widths, but easily missed against the size of the pane.
 * It is only in view while the vehicle is still pitched well back and
 * windows-up: as Eagle comes upright the Earth climbs out of the top of the
 * window while the lunar surface rises into the bottom.
 */
export function earthDisk(
  p: WindowProjection,
  options: { readonly wobbleRad?: number } = {},
): EarthDisk {
  if (p.altitudeM < EARTH_MIN_ALTITUDE_M) return EARTH_HIDDEN;
  const roll = p.rollRad ?? 0;
  // Windows-down (engine-first, face-down braking): the crew is looking at the
  // ground, Earth is behind the cabin roof.
  if (Math.cos(roll) <= 0.2) return EARTH_HIDDEN;

  const halfFov = p.halfFovRad ?? DEFAULT_HALF_FOV;
  const focal = p.width / 2 / Math.tan(halfFov);
  const dPitch = p.pitchRad - EARTH_CENTRED_PITCH_RAD;
  if (Math.abs(dPitch) > 1.0) return EARTH_HIDDEN;

  const wob = options.wobbleRad ?? 0;
  let sx = Math.tan(EARTH_BEARING_RAD + wob * 0.6) * focal;
  let sy = Math.tan(dPitch + wob) * focal;

  // The Earth is a sky object: it can never be painted over the regolith. If
  // the unrolled disk would fall on or below the limb, it has already set.
  const unrolledY = p.height / 2 + sy;
  const radiusPx = Math.max(2, Math.tan(EARTH_ANGULAR_DIAMETER_RAD / 2) * focal);
  const limbY = horizonY(p);
  if (unrolledY + radiusPx * 1.4 > limbY) return EARTH_HIDDEN;

  if (roll !== 0) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const rx = sx * cr - sy * sr;
    const ry = sx * sr + sy * cr;
    sx = rx;
    sy = ry;
  }
  const x = p.width / 2 + sx;
  const y = p.height / 2 + sy;
  const onPane = y > -radiusPx && y < p.height + radiusPx && x > -radiusPx && x < p.width + radiusPx;
  return { visible: onPane, x, y, radiusPx, phase: 0.7 };
}
