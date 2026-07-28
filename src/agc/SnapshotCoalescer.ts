// SPDX-License-Identifier: GPL-3.0-or-later
// Wall-clock-throttled snapshot publisher.
//
// A "snapshot" is a full observable-state dump that the UI uses to redraw
// panels. The simulation may produce a new one after every tick, but the UI
// does not need or want ~50 snapshots per real-time second — let alone the
// ~500/sec that would arrive at 10× time acceleration. This coalescer stores
// the newest snapshot and flushes at most once per `minIntervalMs` of real
// wall clock. When a snapshot is offered while the throttle window is closed,
// the previous pending snapshot is simply overwritten — intermediate values
// are dropped. Critical events (dskyUpdate, alarm, paused, fatalError,
// resumed, performanceWarning) never route through this class; the Worker
// emits those directly.

export interface SnapshotCoalescerOptions<TSnap> {
  minIntervalMs?: number;
  now?: () => number;
  publish: (snapshot: TSnap) => void;
}

export class SnapshotCoalescer<TSnap> {
  private pending: TSnap | null = null;
  private lastPublishMs = -Infinity;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly publish: (snapshot: TSnap) => void;
  private publishedCount = 0;
  private droppedCount = 0;

  constructor(opts: SnapshotCoalescerOptions<TSnap>) {
    this.minIntervalMs = Math.max(0, opts.minIntervalMs ?? 40); // ~25 Hz
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.publish = opts.publish;
  }

  offer(snapshot: TSnap): void {
    // Coalesce: newest always wins if the throttle window is closed.
    if (this.pending !== null) this.droppedCount++;
    this.pending = snapshot;
    this.tryFlush();
  }

  /**
   * Emit the pending snapshot regardless of the throttle window. Useful for
   * a client-initiated `requestSnapshot`.
   */
  flushNow(): void {
    if (this.pending === null) return;
    const s = this.pending;
    this.pending = null;
    this.lastPublishMs = this.now();
    this.publishedCount++;
    this.publish(s);
  }

  private tryFlush(): void {
    const t = this.now();
    if (t - this.lastPublishMs < this.minIntervalMs) return;
    this.flushNow();
  }

  /** Attempt a flush without offering a new snapshot (called by a timer). */
  tick(): void {
    if (this.pending !== null) this.tryFlush();
  }

  stats(): { publishedCount: number; droppedCount: number } {
    return { publishedCount: this.publishedCount, droppedCount: this.droppedCount };
  }
}
