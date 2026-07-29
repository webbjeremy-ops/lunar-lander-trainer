// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.d — bounded Worker-owned monitor diagnostic ring.
//
// This ring is DISTINCT from the WASM HW-I/O output-counter ring:
//   * The WASM ring (`agc_out_trace_*`, capacity 4096 entries) holds
//     PENDING output-counter observations. It is drained exactly once per
//     mission tick; after a drain its pending count returns to zero.
//   * This ring holds RETAINED diagnostics (sensor channel-mask updates
//     that were applied, lossless CHAN11/CHAN14 output events, and the
//     drained output-counter events) so the UI can retrieve a window of
//     monitor history without inflating every mission snapshot.
//
// Overflow is reported honestly: `dropped` counts entries evicted from the
// head of this ring, and the drained-trace response also carries the WASM
// layer's own dropped count separately.

export const MONITOR_TRACE_CAPACITY = 2048;

export type MonitorTraceEntry =
  | {
      readonly kind: "sensor-channel";
      readonly seq: number;
      readonly missionTick: number;
      readonly missionTimeUs: number;
      readonly channel: number;
      readonly mask: number;
      readonly value: number;
      /** Complete channel word actually sent to the AGC after the merge. */
      readonly mergedWord: number;
      readonly suborder: number;
      readonly mappingId: string;
    }
  | {
      readonly kind: "output-channel";
      readonly seq: number;
      readonly missionTick: number;
      readonly missionTimeUs: number;
      readonly channel: number;
      readonly value: number;
      readonly valueBefore: number | null;
    }
  | {
      readonly kind: "output-counter";
      readonly seq: number;
      readonly missionTick: number;
      readonly missionTimeUs: number;
      readonly address: number;
      readonly operation: number;
      readonly delta: number;
      readonly valueBefore: number;
      readonly valueAfter: number;
    };

export interface MonitorTraceWindow {
  readonly events: readonly MonitorTraceEntry[];
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  readonly retainedCount: number;
  readonly droppedCount: number;
  readonly capacity: number;
  readonly firstMissionTick: number | null;
  readonly lastMissionTick: number | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A trace entry before the ring assigns its sequence number. */
export type MonitorTraceEntryInput = DistributiveOmit<MonitorTraceEntry, "seq">;

/** Deterministic bounded FIFO. `seq` is assigned by the ring so ordering is
 *  total and stable across kinds. */
export class MonitorTraceRing {
  private entries: MonitorTraceEntry[] = [];
  private nextSeq = 1;
  private dropped = 0;

  constructor(private readonly capacity: number = MONITOR_TRACE_CAPACITY) {}

  append(entry: MonitorTraceEntryInput): MonitorTraceEntry {
    const withSeq = { ...entry, seq: this.nextSeq++ } as MonitorTraceEntry;
    this.entries.push(withSeq);
    if (this.entries.length > this.capacity) {
      const overflow = this.entries.length - this.capacity;
      this.entries.splice(0, overflow);
      this.dropped += overflow;
    }
    return withSeq;
  }

  clear(): void {
    this.entries = [];
    this.nextSeq = 1;
    this.dropped = 0;
  }

  count(): number {
    return this.entries.length;
  }

  droppedCount(): number {
    return this.dropped;
  }

  /** Snapshot the retained window. Ordering: ascending `seq`, which is the
   *  exact append order (mission tick, then intra-tick suborder). */
  window(): MonitorTraceWindow {
    const events = this.entries.map((e) => ({ ...e })) as MonitorTraceEntry[];
    return {
      events,
      firstSeq: events.length > 0 ? events[0].seq : null,
      lastSeq: events.length > 0 ? events[events.length - 1].seq : null,
      retainedCount: events.length,
      droppedCount: this.dropped,
      capacity: this.capacity,
      firstMissionTick: events.length > 0 ? events[0].missionTick : null,
      lastMissionTick: events.length > 0 ? events[events.length - 1].missionTick : null,
    };
  }
}
