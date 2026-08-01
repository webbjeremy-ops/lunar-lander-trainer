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

/** Gate altitudes in metres (7,000 ft high gate, 500 ft low gate). */
export const PHASE_HIGH_GATE_M = 2_134;
export const PHASE_LOW_GATE_M = 152;

const DEG = Math.PI / 180;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Historical attitude phase for a given altitude above the surface. */
export function descentPhaseFor(altitudeM: number): DescentPhaseInfo {
  const alt = Math.max(0, altitudeM);

  if (alt > PHASE_HIGH_GATE_M) {
    // Braking: essentially horizontal. Ease slightly off 90 deg as the vehicle
    // approaches high gate so the pitch-over is continuous.
    const t = (alt - PHASE_HIGH_GATE_M) / (15_240 - PHASE_HIGH_GATE_M); // 50k ft
    return {
      id: "braking",
      label: "BRAKING PHASE",
      pitchRad: lerp(72 * DEG, 88 * DEG, t),
      windowView: "Windows off the surface — landing site not visible",
    };
  }

  if (alt > PHASE_LOW_GATE_M) {
    // Approach / high gate: 55 deg at the gate easing to 40 deg at low gate.
    const t = (alt - PHASE_LOW_GATE_M) / (PHASE_HIGH_GATE_M - PHASE_LOW_GATE_M);
    return {
      id: "approach",
      label: "APPROACH PHASE · HIGH GATE",
      pitchRad: lerp(40 * DEG, 55 * DEG, t),
      windowView: "Pitch-over — landing site in the window, LPD usable",
    };
  }

  // Landing / low gate: near upright for the vertical descent.
  const t = alt / PHASE_LOW_GATE_M;
  return {
    id: "landing",
    label: "LANDING PHASE · LOW GATE",
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
): number {
  const nominal = descentPhaseFor(altitudeM).pitchRad;
  if (!manual) return nominal;
  return attitudeRad + (nominal - attitudeRad) * 0.35;
}
