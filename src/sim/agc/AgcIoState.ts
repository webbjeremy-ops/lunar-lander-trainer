// SPDX-License-Identifier: GPL-2.0-or-later
// Pure I/O bookkeeping for the AGC adapter: channel-value cache, DSKY lamp
// folding, and a bounded ring buffer of recent channel events. Kept pure so
// it can be unit-tested without loading WebAssembly.

export interface ChannelEvent {
  readonly channel: number;
  readonly value: number;
  /** Monotonic sequence number (assigned by the state). */
  readonly seq: number;
  /** performance.now() timestamp (ms). */
  readonly t: number;
}

export interface AgcIoStateOptions {
  readonly ringSize?: number;
  readonly now?: () => number;
}

// Bit masks live here (not in the registry) because they encode packing into
// the *combined* lamp word — a UI concern that the registry does not describe.
const CH011_LAMP_MASK = 0b110; // bits 2 & 3
const CH0163_LAMP_MASK = 0b111111001; // bits 1, 4..10

export class AgcIoState {
  private readonly channels: Map<number, number> = new Map();
  private readonly ring: Array<ChannelEvent | undefined>;
  private readonly cap: number;
  private ringHead = 0;
  private ringCount = 0;
  private seq = 0;
  private lamps = 0;
  private readonly now: () => number;

  constructor(opts: AgcIoStateOptions = {}) {
    this.cap = Math.max(16, opts.ringSize ?? 256);
    this.ring = new Array(this.cap);
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  }

  reset(): void {
    this.channels.clear();
    for (let i = 0; i < this.cap; i++) this.ring[i] = undefined;
    this.ringHead = 0;
    this.ringCount = 0;
    this.lamps = 0;
  }

  ingest(channel: number, value: number): boolean {
    const prev = this.channels.get(channel);
    if (prev === value) return false;
    this.channels.set(channel, value);

    this.ring[this.ringHead] = { channel, value, seq: ++this.seq, t: this.now() };
    this.ringHead = (this.ringHead + 1) % this.cap;
    if (this.ringCount < this.cap) this.ringCount++;

    if (channel === 0o11) {
      this.lamps = (this.lamps & ~CH011_LAMP_MASK) | (value & CH011_LAMP_MASK);
    } else if (channel === 0o163) {
      this.lamps = (this.lamps & ~CH0163_LAMP_MASK) | (value & CH0163_LAMP_MASK);
    }
    return true;
  }

  channel(channel: number): number {
    return this.channels.get(channel) ?? 0;
  }

  allChannels(): ReadonlyMap<number, number> {
    return this.channels;
  }

  lampBits(): number {
    return this.lamps;
  }

  recentEvents(limit = 64): ChannelEvent[] {
    const out: ChannelEvent[] = [];
    const n = Math.min(limit, this.ringCount);
    for (let i = 0; i < n; i++) {
      const idx = (this.ringHead - 1 - i + this.cap) % this.cap;
      const ev = this.ring[idx];
      if (ev) out.push(ev);
    }
    return out;
  }

  totalEvents(): number {
    return this.seq;
  }
}
