// SPDX-License-Identifier: GPL-3.0-or-later
//
// Wall-clock playback driver for the ReplayReducer.
//
// Design invariants
//   * One controlled loop (requestAnimationFrame by default) — never one
//     timer per event. Multiple events are drained in the same frame.
//   * At most ONE `onChange` publish per frame, even when many events are
//     due. React renders once regardless of burst density.
//   * The reducer still processes every event in order, including
//     duplicate-value channel writes and simultaneous mission-time events.
//   * Playback speed affects wall-clock timing ONLY. The reconstructed
//     state at any event index is identical across rates (verified by test).
//   * Live isolation: never touches the AGC worker / session / DSKY.
//   * File-change safety: `dispose()` cancels the outstanding frame AND
//     bumps a generation token so a scheduled callback that has already
//     been queued cannot mutate state after teardown.
//
// The clock is time-source injectable so tests can drive it deterministic-
// ally without leaning on real rAF.

import type { AgcEventLogPayloadV1 } from "../eventLog/schema";
import {
  applyNext,
  initReplayState,
  reconstructAt,
  withStatus,
  type ReplayState,
} from "./ReplayReducer";

export interface ReplayClockDeps {
  now(): number;
  scheduleFrame(cb: (t: number) => void): number;
  cancelFrame(handle: number): void;
}

export const REPLAY_SPEED_PRESETS = [0.25, 0.5, 1, 2, 4, 10] as const;
export type ReplaySpeed = (typeof REPLAY_SPEED_PRESETS)[number] | number;

/** Cap on events applied per frame. Prevents a pathological recording
 *  from freezing the browser; the loop continues draining next frame. */
const PER_FRAME_EVENT_BUDGET = 2000;

function defaultDeps(): ReplayClockDeps {
  const hasWin = typeof window !== "undefined";
  const raf = hasWin && typeof window.requestAnimationFrame === "function";
  return {
    now: () => (hasWin && typeof performance !== "undefined" ? performance.now() : Date.now()),
    scheduleFrame: (cb) =>
      raf
        ? window.requestAnimationFrame(cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number),
    cancelFrame: (h) => {
      if (raf) window.cancelAnimationFrame(h);
      else clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
    },
  };
}

export interface ReplayClockOptions {
  deps?: ReplayClockDeps;
  /** Initial speed multiplier applied to wall-clock playback (1 = real). */
  initialSpeed?: ReplaySpeed;
  /** Optional: emit whenever internal status changes even if state is same. */
  emitStatusOnly?: boolean;
}

/** Owns a ReplayState and drives it forward under a single rAF loop. */
export class ReplayClock {
  private payload: AgcEventLogPayloadV1;
  private state: ReplayState;
  private deps: ReplayClockDeps;
  private speed: number;
  private handle: number | null = null;
  private lastNowMs = 0;
  /** Virtual mission time (µs) accumulated for the current playback run,
   *  relative to the tick at which playback started. */
  private virtualUs = 0;
  /** Mission time (µs) of the anchor event: currentEventIndex at play(). */
  private anchorMissionUs = 0;
  private gen = 0;
  private disposed = false;
  onChange: (state: ReplayState) => void;

  constructor(payload: AgcEventLogPayloadV1, onChange: (s: ReplayState) => void, opts: ReplayClockOptions = {}) {
    this.payload = payload;
    this.onChange = onChange;
    this.deps = opts.deps ?? defaultDeps();
    this.speed = opts.initialSpeed ?? 1;
    this.state = initReplayState(payload);
  }

  getState(): ReplayState { return this.state; }
  getSpeed(): number { return this.speed; }
  getEventCount(): number { return this.payload.events.length; }

  setSpeed(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    // If currently playing, re-anchor so the rate change affects only
    // future wall-clock timing, not the position we've already advanced to.
    if (this.state.status === "playing") this.rearm();
    this.speed = rate;
  }

  play(): void {
    if (this.disposed) return;
    if (this.state.currentEventIndex >= this.payload.events.length - 1) {
      this.publish(withStatus(this.state, "finished"));
      return;
    }
    this.publish(withStatus(this.state, "playing"));
    this.rearm();
    this.arm();
  }

  pause(): void {
    if (this.disposed) return;
    this.cancel();
    if (this.state.status === "playing") {
      this.publish(withStatus(this.state, "paused"));
    }
  }

  next(): void {
    if (this.disposed) return;
    this.cancel();
    const idx = this.state.currentEventIndex + 1;
    if (idx >= this.payload.events.length) {
      this.publish(withStatus(this.state, "finished"));
      return;
    }
    const s = applyNext(this.state, this.payload.events[idx]!, idx);
    const status = idx === this.payload.events.length - 1 ? "finished" : "paused";
    this.publish(withStatus(s, status));
  }

  prev(): void {
    if (this.disposed) return;
    this.cancel();
    const target = this.state.currentEventIndex - 1;
    this.seek(target);
    if (this.state.status === "playing") {
      this.publish(withStatus(this.state, "paused"));
    }
  }

  toStart(): void { this.seek(-1); }
  toEnd(): void { this.seek(this.payload.events.length - 1); }

  seek(targetIndex: number): void {
    if (this.disposed) return;
    this.cancel();
    const s = reconstructAt(this.payload, targetIndex);
    // Preserve prior status semantics as `paused` (any manual reposition
    // pauses timed playback). Reaching the end lands in `finished`.
    const status =
      s.currentEventIndex >= this.payload.events.length - 1 ? "finished" : "paused";
    this.publish(withStatus(s, status));
  }

  dispose(): void {
    this.disposed = true;
    this.gen++;
    this.cancel();
  }

  // ---- internal ----------------------------------------------------------

  private publish(s: ReplayState): void {
    this.state = s;
    if (this.disposed) return;
    this.onChange(s);
  }

  private rearm(): void {
    this.lastNowMs = this.deps.now();
    this.virtualUs = 0;
    this.anchorMissionUs = this.state.currentEventIndex < 0
      ? this.payload.baseline.missionTimeUs
      : this.payload.events[this.state.currentEventIndex]!.missionTimeUs;
  }

  private arm(): void {
    if (this.disposed || this.state.status !== "playing") return;
    const myGen = this.gen;
    this.handle = this.deps.scheduleFrame((t) => {
      if (this.disposed || myGen !== this.gen) return;
      this.handle = null;
      this.tick(t);
      this.arm();
    });
  }

  private cancel(): void {
    if (this.handle !== null) {
      this.deps.cancelFrame(this.handle);
      this.handle = null;
    }
    // Bump gen so any queued callback that has not yet run is orphaned.
    this.gen++;
  }

  private tick(nowMs: number): void {
    if (this.state.status !== "playing") return;
    const dtMs = Math.max(0, nowMs - this.lastNowMs);
    this.lastNowMs = nowMs;
    // µs of mission time to advance this frame.
    this.virtualUs += dtMs * 1000 * this.speed;

    const dueMissionUs = this.anchorMissionUs + this.virtualUs;
    let s = this.state;
    let applied = 0;
    while (
      s.currentEventIndex + 1 < this.payload.events.length &&
      this.payload.events[s.currentEventIndex + 1]!.missionTimeUs <= dueMissionUs &&
      applied < PER_FRAME_EVENT_BUDGET
    ) {
      const idx = s.currentEventIndex + 1;
      s = applyNext(s, this.payload.events[idx]!, idx);
      applied++;
    }
    if (s.currentEventIndex >= this.payload.events.length - 1) {
      s = withStatus(s, "finished");
    }
    // Exactly one publish per frame regardless of how many events applied.
    if (applied > 0 || s.status !== this.state.status) this.publish(s);
  }
}
