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
  /** Organ under-melody (Interstellar-flavoured ostinato). */
  readonly melody: number;
  /** Heartbeat rate, beats per minute. */
  readonly pulseBpm: number;
  /** Seconds between under-melody notes — shortens as tension rises. */
  readonly melodyNoteSec: number;
  /**
   * 0 = simple sustained pedal tones, 1 = fully arpeggiated running line.
   * Selects the melodic pattern and the note articulation.
   */
  readonly melodyArp: number;
  /** Low-pass cutoff on the bed, Hz — opens up as tension rises. */
  readonly cutoffHz: number;
}

/** Layer gains for a tension value. Monotonic in tension by construction. */
export function scoreLayers(tension: number): ScoreLayers {
  const t = clamp01(tension);
  const arp = clamp01((t - 0.22) / 0.55);
  return {
    drone: 0.5 + 0.35 * t,
    pulse: t < 0.25 ? 0 : 0.18 + 0.5 * (t - 0.25),
    strings: t < 0.45 ? 0 : 0.5 * (t - 0.45) * 2,
    dissonance: t < 0.78 ? 0 : (t - 0.78) * 3.2,
    melody: t < 0.12 ? 0 : clamp01(0.35 + 0.75 * (t - 0.12)),
    pulseBpm: 44 + 76 * t,
    // 3.2 s pedal tones early, down to ~0.32 s sixteenth-feel arpeggios late.
    melodyNoteSec: 3.2 - 2.88 * arp,
    melodyArp: arp,
    cutoffHz: 220 + 1_600 * t * t,
  };

}


// --- harmonic progression ---------------------------------------------------
//
// The under-melody sits on a moving bass: a slow four-chord loop in A minor
// (i – VI – III – VII). The melody borrows its notes from the current chord,
// so the same arpeggio figure re-colours as the harmony moves underneath.

export interface Chord {
  readonly name: string;
  /** Bass root, Hz (octave 1/2 territory). */
  readonly bassHz: number;
  /** Chord tones for the arpeggio, ascending, Hz (octave 3/4 territory). */
  readonly tonesHz: readonly number[];
}

export const CHORD_PROGRESSION: readonly Chord[] = [
  { name: "Am", bassHz: 55.0, tonesHz: [220.0, 261.63, 329.63] }, // A C E
  { name: "F", bassHz: 43.65, tonesHz: [174.61, 220.0, 261.63] }, // F A C
  { name: "C", bassHz: 65.41, tonesHz: [196.0, 261.63, 329.63] }, // G C E
  { name: "G", bassHz: 49.0, tonesHz: [196.0, 246.94, 293.66] }, // G B D
];

/** How many melody notes are held per chord — fewer when the line is slow. */
/** Harmonic rhythm: the drone bass moves once every eight heartbeats. */
export const PULSES_PER_CHORD = 8;

export function melodyNotesPerChord(melodyArp: number): number {
  const arp = clamp01(melodyArp);
  if (arp < 0.25) return 2;
  if (arp < 0.5) return 4;
  if (arp < 0.78) return 6;
  return 12;
}

/** Chord for a given melody-step index. */
export function chordForStep(step: number, melodyArp: number): Chord {
  const per = melodyNotesPerChord(melodyArp);
  const idx = Math.floor(Math.max(0, step) / per) % CHORD_PROGRESSION.length;
  return CHORD_PROGRESSION[idx]!;
}

/**
 * "In the zone": the last stretch before touchdown, when the crew stops
 * talking and flies. Everything but the heartbeat gets muffled.
 * 500 ft (152 m) is the low-gate / P66 manual-takeover neighbourhood.
 */
export const ZONE_ALTITUDE_M = 152;

export function inTheZone(input: TensionInput): boolean {
  if (input.terminal || input.crewAborted) return false;
  if (input.houstonStage === "abort") return false;
  return input.altitudeM > 0 && input.altitudeM < ZONE_ALTITUDE_M;
}
