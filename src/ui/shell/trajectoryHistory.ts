// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Bounded trajectory history.
//
// A flown-path trail must never grow without limit: a long sandbox session at
// 8x time scale would otherwise accumulate hundreds of thousands of points and
// stall the SVG renderer. This is a pure, allocation-bounded ring buffer with
// a minimum sample spacing, so cost is O(1) per physics publish and the drawn
// path is capped at MAX_TRAJECTORY_SAMPLES points.

export interface TrajectorySample {
  /** Moon-centred inertial position, metres. */
  readonly x: number;
  readonly y: number;
  /** Mission time of the sample, microseconds. */
  readonly tUs: number;
}

/** Hard cap on retained points. */
export const MAX_TRAJECTORY_SAMPLES = 600;
/** Minimum mission-time spacing between retained points (0.5 s). */
export const MIN_TRAJECTORY_SPACING_US = 500_000;

/**
 * Append a sample, honouring the spacing rule and the hard cap. Returns the
 * same array reference when the sample is rejected, so React consumers can
 * skip a re-render cheaply.
 */
export function pushTrajectorySample(
  history: readonly TrajectorySample[],
  sample: TrajectorySample,
  maxSamples: number = MAX_TRAJECTORY_SAMPLES,
  minSpacingUs: number = MIN_TRAJECTORY_SPACING_US,
): readonly TrajectorySample[] {
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return history;
  const last = history[history.length - 1];
  if (last) {
    if (sample.tUs < last.tUs) return history; // never accept time going backwards
    if (sample.tUs - last.tUs < minSpacingUs) return history;
  }
  const cap = Math.max(1, Math.floor(maxSamples));
  if (history.length < cap) return [...history, sample];
  // Decimate: drop every other older point so the trail keeps its full span
  // instead of becoming a short recent tail.
  const kept: TrajectorySample[] = [];
  for (let i = 0; i < history.length; i += 2) kept.push(history[i]!);
  kept.push(sample);
  return kept;
}

export function emptyTrajectory(): readonly TrajectorySample[] {
  return [];
}
