// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: Adapted from webAGC (Copyright 2020 Michael Karl Franzl)
//
// Typed adapter around the yaAGC WebAssembly build shipped by
// michaelfranzl/webAGC. The public API here is the ONLY surface UI code is
// allowed to touch — never call `instance.exports.*` directly from a
// component. This file is browser-only (uses WebAssembly.compileStreaming,
// fetch, and dynamically imports the WASI shim).
//
// Milestone-0 scope: load + reset + run + DSKY key input + lamp/register
// output + erasable memory read. Worker isolation lands in Milestone 1.

import type { AgcChannelDoc } from "./AgcChannelRegistry";
export type { AgcChannelDoc };

export type RomName = "Luminary099" | "Comanche055";

export interface AgcCoreEvents {
  onChannelUpdate?: (channel: number, value: number) => void;
  onDskyLampsUpdate?: (lampBits: number) => void;
}

interface YaAgcExports {
  memory?: WebAssembly.Memory;
  version: () => number;
  packet_write: (channel: number, data: number) => void;
  packet_read: () => number;
  cpu_step: (steps: number) => void;
  cpu_reset: () => void;
  get_erasable_ptr: () => number;
  set_fixed: (ptr: number) => void;
  malloc: (n: number) => number;
  free: (ptr: number) => void;
}

const PROCEED_CHANNEL = 0o32;
const NORMAL_KEY_CHANNEL = 0o15;
const PROCEED_BIT = 1 << 13;

/** Combined lamp word — see AgcChannelRegistry.DSKY_LAMPS for bit layout. */
export type DskyLampBits = number;

export class AgcCoreAdapter {
  private mem!: WebAssembly.Memory;
  private memArray!: Uint8Array;
  private instance!: WebAssembly.Instance;
  private exports!: YaAgcExports;
  private erasableView: Uint16Array | null = null;

  private channels: Record<number, number> = {};
  private lamps: DskyLampBits = 0;

  private totalSteps = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private clockDivisor = 1;

  constructor(private readonly events: AgcCoreEvents = {}) {}

  /** Load and instantiate the yaAGC WASM binary from `wasmUrl`. */
  async init(wasmUrl: string): Promise<void> {
    // WASI shim — loaded lazily so this module stays SSR-safe if imported.
    const { WASI } = await import("@wasmer/wasi");
    const { WasmFs } = await import("@wasmer/wasmfs");

    const wasmfs = new WasmFs();
    const wasi = new WASI({
      preopens: { "/": "/" },
      bindings: { ...WASI.defaultBindings, fs: wasmfs.fs },
    });

    this.mem = new WebAssembly.Memory({ initial: 5 });
    this.memArray = new Uint8Array(this.mem.buffer);
    wasi.setMemory(this.mem);

    const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
    const wasiImports = wasi.getImports(module) as Record<string, WebAssembly.ModuleImports>;
    const instance = await WebAssembly.instantiate(module, {
      env: { memory: this.mem },
      ...wasiImports,
    });
    this.instance = instance;
    this.exports = instance.exports as unknown as YaAgcExports;
  }

  /** Returns a string reported by the emulator (build commit id). */
  version(): string {
    try {
      const ptr = this.exports.version();
      const bytes = this.memArray.subarray(ptr);
      const nul = bytes.indexOf(0);
      return new TextDecoder().decode(bytes.subarray(0, nul >= 0 ? nul : 0));
    } catch {
      return "unknown";
    }
  }

  /** Fetch a rope image and load it as fixed (rope) memory. */
  async loadRom(url: string): Promise<{ url: string; bytes: number; sha256: string }> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch rope ${url}: HTTP ${response.status}`);
    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);

    const ptr = this.exports.malloc(bytes.byteLength);
    // memArray may be stale if memory grew; refresh view.
    this.memArray = new Uint8Array(this.mem.buffer);
    this.memArray.set(bytes, ptr);
    this.exports.set_fixed(ptr);
    this.exports.free(ptr);

    // Compute a SHA-256 for provenance display.
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { url, bytes: bytes.byteLength, sha256 };
  }

  reset(): void {
    this.exports.cpu_reset();
    this.channels = {};
    this.lamps = 0;
    this.erasableView = null;
    // After reset, prime the PROCEED input to its "not pressed" state and the
    // key channel to idle, mirroring webAGC's configure().
    this.writeIo(PROCEED_CHANNEL, PROCEED_BIT); // PROCEED is active-low; high = not pressed.
    this.writeIo(NORMAL_KEY_CHANNEL, 0);
  }

  stepCpu(steps: number): void {
    if (steps <= 0) return;
    this.exports.cpu_step(steps);
    this.totalSteps += steps;
  }

  writeIo(channel: number, data: number): void {
    this.exports.packet_write(channel, data);
  }

  keyPress(keyCode: number): void {
    if (!keyCode) return;
    this.writeIo(NORMAL_KEY_CHANNEL, keyCode);
  }

  proceedKey(pressed: boolean): void {
    // Active-low: pressed = 0, released = PROCEED_BIT high.
    this.writeIo(PROCEED_CHANNEL, pressed ? 0 : PROCEED_BIT);
  }

  /**
   * Read a single channel packet from yaAGC's output queue.
   * Returns [channel, value] or null if the queue is empty.
   * The queue is empty when both channel and value read as 0.
   */
  private readOnePacket(): [number, number] | null {
    const data = this.exports.packet_read();
    const channel = data >>> 16;
    const value = data & 0xffff;
    if (!channel && !value) return null;
    return [channel, value];
  }

  /** Drain all pending channel updates and fold them into DSKY lamp state. */
  drainIo(): void {
    // Bits 2 & 3 of channel 011 (COMP ACTY / UPLINK ACTY).
    const CH011_LAMP_MASK = 0b110;
    // Bits 1,4..10 of channel 0163 (blinking lamps, see AgcChannelRegistry).
    const CH0163_LAMP_MASK = 0b111111001;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const packet = this.readOnePacket();
      if (!packet) break;
      const [channel, value] = packet;

      if (this.channels[channel] !== value) {
        this.channels[channel] = value;
        this.events.onChannelUpdate?.(channel, value);
      }

      if (channel === 0o11) {
        this.lamps = (this.lamps & ~CH011_LAMP_MASK) | (value & CH011_LAMP_MASK);
        this.events.onDskyLampsUpdate?.(this.lamps);
      } else if (channel === 0o163) {
        this.lamps = (this.lamps & ~CH0163_LAMP_MASK) | (value & CH0163_LAMP_MASK);
        this.events.onDskyLampsUpdate?.(this.lamps);
      }
    }
  }

  /** Read-only view onto 2048 words (15-bit) of erasable memory. */
  erasable(): Uint16Array {
    if (!this.erasableView) {
      const ptr = this.exports.get_erasable_ptr();
      this.erasableView = new Uint16Array(this.mem.buffer, ptr, 2048);
    }
    return this.erasableView;
  }

  /** Latest observed value on a channel (0 if never seen). */
  channel(channel: number): number {
    return this.channels[channel] ?? 0;
  }

  /** Current combined DSKY lamp word. */
  lampBits(): DskyLampBits {
    return this.lamps;
  }

  /**
   * Start free-running the CPU on a JS timer. Prefer the mission clock in
   * production; this is a Milestone-0 convenience mirroring webAGC's
   * oscillate(). `divisor` > 1 slows the AGC below realtime.
   */
  oscillate(divisor = 1): void {
    this.stopOscillator();
    this.clockDivisor = divisor;
    const cycleMs = 0.01172; // 11.72 µs per instruction — see webAGC.
    const frameHz = 60;
    let startTime = performance.now();
    this.totalSteps = 0;

    this.intervalHandle = setInterval(() => {
      const targetSteps = Math.floor((performance.now() - startTime) / cycleMs / this.clockDivisor);
      const diff = targetSteps - this.totalSteps;
      if (diff < 0 || diff > 100_000) {
        startTime = performance.now();
        this.totalSteps = 0;
        return;
      }
      this.stepCpu(diff);
      this.drainIo();
    }, 1000 / frameHz);
  }

  stopOscillator(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  running(): boolean {
    return this.intervalHandle !== null;
  }

  totalCpuSteps(): number {
    return this.totalSteps;
  }
}
