// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.14 — Historical powered-descent attitude phases (presentation model).
//
// Apollo 11 flew the powered descent in three attitude regimes:
//
//   Braking  (50,000 ft -> ~7,000 ft): pitched back near 90 deg from vertical,
//            engine pointed forward, windows looking at space (or straight
//            down) — the crew could not see the landing site. The windows-up
//            roll happens around 40,000 ft so the landing radar can see ground.
//   Approach ("high gate", ~7,000 ft -> 500 ft): pitch-over to roughly 55 deg
//            then 40 deg from vertical; the landing site swings into view.
//   Landing  ("low gate", 500 ft -> touchdown): nearly upright, 0-10 deg,
//            thrust straight down for the final vertical descent.
//
// Pure: altitude in -> phase and nominal pitch out. No side effects.

export type DescentPhaseId = "braking" | "approach" | "landing";

export interface DescentPhaseInfo {
  readonly id: DescentPhaseId;
  readonly label: string;
  /** Nominal pitch from local vertical, radians (0 = upright, thrust down). */
  readonly pitchRad: number;
  /** Short crew-facing description of what the windows show. */
  readonly windowView: string;
}

/** Gate altitudes in metres (7,600 ft high gate, 500 ft low gate). */
export const PHASE_HIGH_GATE_M = 2_316;
export const PHASE_LOW_GATE_M = 152;

const DEG = Math.PI / 180;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Options for the phase model.
 *
 * `p64Selected` reflects the crew's approach-phase DSKY entry (V06 N64 under
 * P64). Historically the AGC switched P63 -> P64 by itself at high gate and
 * the crew called the landing-point display to fly it; here the pitch-over is
 * withheld until that entry is made, so the player sees the manoeuvre happen
 * on the DSKY action instead of silently.
 */
export interface DescentPhaseOptions {
  readonly p64Selected?: boolean;
}

/**
 * M4.55 — the flown pitch curve, keyed to altitude in feet. These are the
 * postflight/crew-callout attitudes: ~78° at the face-up point, ~65° through
 * throttle recovery, the rapid 55° → 45° break as P64 takes over, then the
 * continuous rotation to ~18–20° at the manual takeover point and upright for
 * touchdown.
 */
const PITCH_CURVE_FT_DEG: ReadonlyArray<readonly [number, number]> = [
  [50_000, 88],
  [37_000, 78],
  [22_000, 65],
  [7_600, 56],
  [7_129, 55],
  [6_400, 45],
  [5_000, 42],
  [3_000, 36],
  [1_000, 27],
  [750, 22],
  [600, 19],
  [500, 18],
  [100, 8],
  [0, 2],
];

/** Interpolated nominal pitch (radians from vertical) for an altitude. */
export function nominalPitchRad(altitudeM: number): number {
  const ft = Math.max(0, altitudeM) / 0.3048;
  const table = PITCH_CURVE_FT_DEG;
  if (ft >= table[0]![0]) return table[0]![1] * DEG;
  for (let i = 1; i < table.length; i++) {
    const [hiFt, hiDeg] = table[i - 1]!;
    const [loFt, loDeg] = table[i]!;
    if (ft >= loFt) {
      const t = (ft - loFt) / (hiFt - loFt);
      return lerp(loDeg, hiDeg, t) * DEG;
    }
  }
  return table[table.length - 1]![1] * DEG;
}

/** Historical attitude phase for a given altitude above the surface. */
export function descentPhaseFor(
  altitudeM: number,
  _options: DescentPhaseOptions = {},
): DescentPhaseInfo {
  const alt = Math.max(0, altitudeM);
  const pitchRad = nominalPitchRad(alt);

  // M4.55 — P64 is entered automatically by the computer at high gate; the
  // pitch-over no longer waits on a crew DSKY entry.
  if (alt > PHASE_HIGH_GATE_M) {
    return {
      id: "braking",
      label: "BRAKING PHASE · P63",
      pitchRad,
      windowView: "Windows off the surface — landing site not visible",
    };
  }

  if (alt > PHASE_LOW_GATE_M) {
    return {
      id: "approach",
      label: "APPROACH PHASE · HIGH GATE · P64",
      pitchRad,
      windowView: "Pitch-over — landing site in the window, LPD usable",
    };
  }

  return {
    id: "landing",
    label: "LANDING PHASE · LOW GATE · P66",
    pitchRad,
    windowView: "Surface rising to meet the vehicle — manual touchdown",
  };
}

/**
 * Pitch used to draw the vehicle and horizon.
 *
 * Under guidance the picture follows the historical phase profile; once the
 * pilot has control the vehicle's own attitude is authoritative, but it is
 * blended toward the nominal so a scenario that starts with a flat attitude
 * still shows the correct posture for its starting altitude.
 */
export function displayPitchRad(
  attitudeRad: number,
  altitudeM: number,
  manual: boolean,
  options: DescentPhaseOptions = {},
): number {
  const nominal = descentPhaseFor(altitudeM, options).pitchRad;
  if (!manual) return nominal;
  // M4.52 — the kernel signs attitude the other way round from this
  // presentation model: negative attitude is thrust tilted retrograde, which
  // IS the pitched-back braking posture drawn as a positive display pitch.
  // Without this flip the picture inverted the moment the crew took over, so
  // "pitched forward at the site" was really thrust prograde.
  const shown = -attitudeRad;
  return shown + (nominal - shown) * 0.35;
}


