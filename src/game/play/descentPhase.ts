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

/** Historical attitude phase for a given altitude above the surface. */
export function descentPhaseFor(
  altitudeM: number,
  options: DescentPhaseOptions = {},
): DescentPhaseInfo {
  const alt = Math.max(0, altitudeM);
  const p64 = options.p64Selected ?? true;

  if (alt > PHASE_HIGH_GATE_M) {
    // Braking: essentially horizontal. Ease slightly off 90 deg as the vehicle
    // approaches high gate so the pitch-over is continuous.
    const t = (alt - PHASE_HIGH_GATE_M) / (15_240 - PHASE_HIGH_GATE_M); // 50k ft
    return {
      id: "braking",
      label: "BRAKING PHASE · P63",
      pitchRad: lerp(72 * DEG, 88 * DEG, t),
      windowView: "Windows off the surface — landing site not visible",
    };
  }

  if (!p64) {
    // At or below high gate but the approach program has not been taken:
    // hold the braking attitude and tell the player what is missing.
    return {
      id: "braking",
      label: "HIGH GATE · P64 NOT SELECTED",
      pitchRad: 72 * DEG,
      windowView: "Key V06 N64 for P64 — pitch-over waits on the approach program",
    };
  }

  if (alt > PHASE_LOW_GATE_M) {
    // Approach / high gate: 55 deg at the gate easing to 40 deg at low gate.
    const t = (alt - PHASE_LOW_GATE_M) / (PHASE_HIGH_GATE_M - PHASE_LOW_GATE_M);
    return {
      id: "approach",
      label: "APPROACH PHASE · HIGH GATE · P64",
      pitchRad: lerp(40 * DEG, 55 * DEG, t),
      windowView: "Pitch-over — landing site in the window, LPD usable",
    };
  }

  // Landing / low gate: near upright for the vertical descent.
  const t = alt / PHASE_LOW_GATE_M;
  return {
    id: "landing",
    label: "LANDING PHASE · LOW GATE · P66",
    pitchRad: lerp(2 * DEG, 12 * DEG, t),
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


