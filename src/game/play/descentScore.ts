// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.21 — Descent score model (PURE).
//
// The music that plays under powered descent is not a loop: it is a function
// of where the vehicle is on the 13-minute timeline, how close the surface is,
// and whether Houston is happy. This module holds that mapping as pure maths
// so it can be tested and so the audio engine stays a thin renderer.
//
// PURE MODULE: no Web Audio, no timers, no side effects.

import { DESCENT_DURATION_SEC } from "./descentTimeline";

export type ScoreStage = "clear" | "correct" | "final-warning" | "abort";

export interface TensionInput {
  readonly sinceIgnitionSec: number;
  readonly altitudeM: number;
  /** Fraction of the descent load left, 0..1. */
  readonly propellantFraction: number;
  readonly houstonStage: ScoreStage;
  readonly crewAborted: boolean;
  /** Touchdown or crash — the score resolves. */
  readonly terminal: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 0 = still, 1 = maximum dread. Escalates with the timeline, escalates harder
 * as the surface comes up, and pins high while Houston is calling a
 * correction or an abort.
 */
export function descentTension(input: TensionInput): number {
  if (input.terminal) return 0.12;

  // Timeline component: a slow build across the 12:35 descent.
  const progress = clamp01(input.sinceIgnitionSec / DESCENT_DURATION_SEC);
  let tension = 0.18 + 0.42 * progress;

  // Proximity component: the last 2,300 m (high gate down) dominate.
  if (input.altitudeM < 2_316) {
    const near = clamp01(1 - input.altitudeM / 2_316);
    tension = Math.max(tension, 0.55 + 0.35 * near * near);
  }
  if (input.altitudeM < 150) {
    tension = Math.max(tension, 0.9);
  }

  // Propellant component: the sixty/thirty-second window.
  if (input.propellantFraction > 0 && input.propellantFraction < 0.1) {
    tension = Math.max(tension, 0.85);
  }

  if (input.houstonStage === "correct") tension = Math.max(tension, 0.78);
  if (input.houstonStage === "final-warning") tension = Math.max(tension, 0.95);
  if (input.houstonStage === "abort" || input.crewAborted) tension = 1;

  return clamp01(tension);
}

export interface ScoreLayers {
  /** Sub-bass bed — always present once the engine is lit. */
  readonly drone: number;
  /** Pulsing heartbeat under the drone. */
  readonly pulse: number;
  /** Sustained cluster that adds harmonic tension. */
  readonly strings: number;
  /** High dissonant partial that only appears when things are bad. */
  readonly dissonance: number;
  /** Heartbeat rate, beats per minute. */
  readonly pulseBpm: number;
  /** Low-pass cutoff on the bed, Hz — opens up as tension rises. */
  readonly cutoffHz: number;
}

/** Layer gains for a tension value. Monotonic in tension by construction. */
export function scoreLayers(tension: number): ScoreLayers {
  const t = clamp01(tension);
  return {
    drone: 0.5 + 0.35 * t,
    pulse: t < 0.25 ? 0 : 0.18 + 0.5 * (t - 0.25),
    strings: t < 0.45 ? 0 : 0.5 * (t - 0.45) * 2,
    dissonance: t < 0.78 ? 0 : (t - 0.78) * 3.2,
    pulseBpm: 44 + 76 * t,
    cutoffHz: 220 + 1_600 * t * t,
  };
}
