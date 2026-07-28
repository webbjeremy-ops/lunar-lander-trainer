// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic fixed-step mission clock.
//
// - Mission time is an integer number of microseconds, held as a bigint.
// - One "tick" advances mission time by exactly 20 000 µs (50 Hz sim rate).
// - Each tick steps the AGC by whole 11 720 ns instructions, carrying the
//   sub-instruction remainder across ticks so long-run integration is exact.
// - `setTimeScale(0)` is the paused state; the last nonzero scale is preserved
//   so `resume()` can restore it without the caller having to remember it.
// - Bounded catch-up: no more than `maxCatchupTicks` ticks per scheduler
//   iteration. Overruns emit a performance warning via the callback.

export const TICK_MICROS = 20_000n; // 20 ms
export const NS_PER_AGC_STEP = 11_720; // 11.720 µs
export const NS_PER_TICK = 20_000_000; // 20 ms in ns

export interface MissionClockOptions {
  maxCatchupTicks?: number;
  now?: () => number; // wall-clock ms (performance.now surrogate)
  onPerformanceWarning?: (message: string, overrunMs: number) => void;
}

export type StepFn = (steps: number) => void;

export class MissionClock {
  private missionTimeUs: bigint = 0n;
  /** Remainder of ns not yet consumed by whole AGC instruction steps. */
  private timingRemainderNs = 0;
  private totalAgcSteps: bigint = 0n;

  private timeScale = 1;
  private lastNonZeroScale = 1;

  private readonly maxCatchupTicks: number;
  private readonly now: () => number;
  private readonly onPerf?: (m: string, o: number) => void;

  private wallLastMs: number | null = null;
  private wallLeftoverMs = 0;

  private ticksExecuted = 0;
  private avgTickMs = 0;
  private maxTickMs = 0;
  private overruns = 0;

  constructor(opts: MissionClockOptions = {}) {
    this.maxCatchupTicks = Math.max(1, opts.maxCatchupTicks ?? 50);
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.onPerf = opts.onPerformanceWarning;
  }

  reset(): void {
    this.missionTimeUs = 0n;
    this.timingRemainderNs = 0;
    this.totalAgcSteps = 0n;
    this.wallLastMs = null;
    this.wallLeftoverMs = 0;
    this.ticksExecuted = 0;
    this.avgTickMs = 0;
    this.maxTickMs = 0;
    this.overruns = 0;
  }

  getMissionTimeUs(): bigint {
    return this.missionTimeUs;
  }

  getTimingRemainderNs(): number {
    return this.timingRemainderNs;
  }

  getTotalAgcSteps(): bigint {
    return this.totalAgcSteps;
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  isPaused(): boolean {
    return this.timeScale === 0;
  }

  /** Any scale >= 0. Zero enters paused; last nonzero value is preserved. */
  setTimeScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) return;
    if (scale > 0) this.lastNonZeroScale = scale;
    this.timeScale = scale;
    // Reset wall-clock anchor so a resume doesn't cause catch-up ticks.
    this.wallLastMs = null;
    this.wallLeftoverMs = 0;
  }

  /** Restore the previously running scale (or an explicit one). */
  resume(explicitScale?: number): void {
    const s = explicitScale ?? this.lastNonZeroScale;
    if (s <= 0) return;
    this.setTimeScale(s);
  }

  /**
   * Advance mission time by exactly one tick, regardless of pause state or
   * wall clock. Used by debug "step simulation" controls.
   */
  stepOneTick(step: StepFn): void {
    this.executeTick(step);
  }

  /**
   * Advance based on elapsed wall-clock time * current time scale. Returns
   * the number of ticks actually executed (bounded by maxCatchupTicks).
   */
  advanceByWallClock(step: StepFn): number {
    if (this.timeScale === 0) {
      // Keep the wall clock reference frozen while paused.
      this.wallLastMs = null;
      return 0;
    }
    const now = this.now();
    if (this.wallLastMs === null) {
      this.wallLastMs = now;
      return 0;
    }
    const rawDeltaMs = (now - this.wallLastMs) + this.wallLeftoverMs;
    this.wallLastMs = now;

    // Convert wall-clock delta * scale into 20 ms ticks.
    const scaledMs = rawDeltaMs * this.timeScale;
    let ticksDue = Math.floor(scaledMs / 20);
    this.wallLeftoverMs = (scaledMs - ticksDue * 20) / this.timeScale;

    if (ticksDue > this.maxCatchupTicks) {
      const dropped = ticksDue - this.maxCatchupTicks;
      const overrunMs = dropped * 20;
      this.overruns++;
      this.onPerf?.(
        `dropped ${dropped} tick(s) to bound catch-up (${overrunMs}ms mission-time)`,
        overrunMs,
      );
      ticksDue = this.maxCatchupTicks;
      this.wallLeftoverMs = 0;
    }

    for (let i = 0; i < ticksDue; i++) this.executeTick(step);
    return ticksDue;
  }

  private executeTick(step: StepFn): void {
    const tStart = this.now();
    // Advance mission time by one tick.
    this.missionTimeUs += TICK_MICROS;
    // Convert 20 ms into whole AGC instruction steps carrying remainder ns.
    const budget = NS_PER_TICK + this.timingRemainderNs;
    const steps = Math.floor(budget / NS_PER_AGC_STEP);
    this.timingRemainderNs = budget - steps * NS_PER_AGC_STEP;
    if (steps > 0) {
      step(steps);
      this.totalAgcSteps += BigInt(steps);
    }
    this.ticksExecuted++;
    const dtMs = this.now() - tStart;
    if (dtMs > this.maxTickMs) this.maxTickMs = dtMs;
    // EMA over ~100 ticks.
    this.avgTickMs = this.avgTickMs === 0 ? dtMs : this.avgTickMs * 0.99 + dtMs * 0.01;
  }

  stats(): { ticksExecuted: number; avgTickMs: number; maxTickMs: number; overruns: number } {
    return {
      ticksExecuted: this.ticksExecuted,
      avgTickMs: this.avgTickMs,
      maxTickMs: this.maxTickMs,
      overruns: this.overruns,
    };
  }
}
