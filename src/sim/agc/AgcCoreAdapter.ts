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
import { AgcIoState, type ChannelEvent } from "./AgcIoState";
export type { AgcChannelDoc, ChannelEvent };

export type RomName = "Luminary099" | "Comanche055";

export interface AgcCoreEvents {
  onChannelUpdate?: (channel: number, value: number) => void;
  onDskyLampsUpdate?: (lampBits: number) => void;
  /**
   * M3.3A2-P5.d LOSSLESS observer. Fires for EVERY output packet drained
   * from yaAGC — including repeated writes of the same value, which
   * `onChannelUpdate` suppresses because `AgcIoState.ingest` is
   * change-filtered. Monitor mode requires the unfiltered stream so
   * repeated CHAN11/CHAN14 writes inside one AGC interval are preserved in
   * order. Purely additive: the frozen M2 path is unchanged.
   */
  onChannelPacket?: (channel: number, value: number, valueBefore: number | null) => void;
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
  // ---- Optional M3.3A2 extension exports (present on yaAGC-ext.wasm).
  // Legacy code paths never call these; they exist only so the Worker's
  // startup ABI-validation step can observe extension identity + confirm
  // trace collection is disabled at boot. Absence means the frozen artifact
  // was loaded (production loader forbids this at runtime).
  agc_hwio_version?: () => number;
  agc_ext_version?: () => number;
  agc_out_trace_enabled?: () => number;
  agc_out_trace_dropped?: () => number;
  agc_out_trace_entry_size?: () => number;
  agc_out_trace_drain?: (dst: number, max: number) => number;
  agc_out_trace_reset?: () => void;
  agc_out_trace_set_enabled?: (enabled: number) => number;
  // M3.3B: ordered batched host counter input (Pinc/Minc/Pcdu/Mcdu).
  agc_hw_input_apply?: (records: number, count: number) => number;
  agc_hw_input_last_error_index?: () => number;
  agc_counter_increment?: (address: number, incType: number) => number;
  // M3.3B2 (HW-I/O v3): allow-listed hardware interrupt latch + the atomic
  // landing-radar delivery transaction. See hwio.c "v3" section.
  agc_request_hardware_interrupt?: (index: number) => number;
  agc_interrupt_request_pending?: (index: number) => number;
  agc_interrupt_inhibited?: () => number;
  agc_in_isr?: () => number;
  agc_interrupt_in_service?: () => number;
  agc_landing_radar_update_size?: () => number;
  agc_landing_radar_update_apply?: (ptr: number) => number;
}

/** Native interrupt-vector indices. Index i vectors to 04000 + 4*i
 *  (yaAGC `agc_engine.c` dispatch loop). Only RADARUPT is host-requestable
 *  — see the v3 allow-list in hwio.c. */
export const AGC_INTERRUPT_INDEX = {
  /** 04044 — `RADAR RUPT` in Luminary099/INTERRUPT_LEAD_INS.agc. */
  RADARUPT: 9,
} as const;

/** Native `AgcIncType` ids — mirror the `HWIO_INC_*` defines in
 *  `third-party/virtualagc-fork/PATCHES/lovable-hwio/hwio.c`. Values are the
 *  yaAGC `UnprogrammedIncrement` sequence ids and MUST NOT be renumbered. */
export const AGC_INC_TYPE_IDS = {
  PINC: 0,
  PCDU: 1,
  MINC: 2,
  MCDU: 3,
  DINC: 4,
  SHINC: 5,
  SHANC: 6,

} as const;

export type AgcIncTypeName = keyof typeof AGC_INC_TYPE_IDS;

/** One ordered host-input record. `suborder` is a stable sort key applied
 *  inside the WASM; equal suborders retain insertion order. */
export interface AgcHwInputRecordInput {
  readonly counterAddress: number;
  readonly incType: AgcIncTypeName;
  readonly pulseCount: number;
  readonly suborder: number;
}

/** Result codes returned by `agc_hw_input_apply` (hwio.c `HWIO_ERR_*`). */
export const AGC_HW_INPUT_RESULT = {
  OK: 0,
  INVALID_ADDRESS: -1,
  INVALID_INC_TYPE: -2,
  NOT_PERMITTED: -3,
  INTERNAL: -4,
  BATCH_LIMIT: -5,
  OVERFLOW: -6,
  INVALID_INTERRUPT: -7,
  RESERVED_NONZERO: -8,
  INVALID_BIT_COUNT: -9,
} as const;

export interface AgcHwInputApplyResult {
  readonly code: number;
  readonly ok: boolean;
  /** Index of the offending record when the batch was rejected, else -1. */
  readonly errorIndex: number;
}

const HW_INPUT_RECORD_BYTES = 12;
/** `HWIO_MAX_RECORDS` in hwio.c. */
export const AGC_HW_INPUT_MAX_RECORDS = 256;


/** One drained HW-I/O v3 output-counter observation, decoded from the
 *  32-byte `AgcOutputTraceEntry` record. Field order/semantics mirror
 *  `third-party/virtualagc-fork/PATCHES/lovable-hwio/hwio.c`. */
export interface AgcOutTraceRecord {
  sequence: { hi: number; lo: number };
  cycle: { hi: number; lo: number };
  address: number;
  operation: number;
  delta: number;
  valueBefore: number;
  valueAfter: number;
}

/** `sizeof(AgcLandingRadarUpdate)` in hwio.c. */
const LR_UPDATE_BYTES = 8;

const TRACE_ENTRY_BYTES = 32;
const TRACE_DRAIN_MAX = 4096;

/** Extension identity reported by the running WASM instance. */
export interface AgcExtensionIdentity {
  hwioVersion: number;
  extVersion: string;
  traceEnabled: number;
  traceDropped: number;
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

  private readonly io: AgcIoState;

  private totalSteps = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private clockDivisor = 1;

  constructor(private readonly events: AgcCoreEvents = {}) {
    this.io = new AgcIoState({ ringSize: 512 });
  }

  /** Test seam: install fake memory + exports without instantiating WebAssembly. */
  __testInstall(mem: WebAssembly.Memory, exports: YaAgcExports): void {
    this.mem = mem;
    this.memArray = new Uint8Array(mem.buffer);
    this.exports = exports;
  }

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

  /** Read the extension-identity trio (hwio version, ext version string,
   *  and initial trace-armed / trace-dropped counters). Returns null when
   *  the loaded artifact lacks the extension exports — in production this
   *  indicates the frozen artifact was fetched and is a hard failure. */
  extensionIdentity(): AgcExtensionIdentity | null {
    const ex = this.exports;
    if (!ex.agc_hwio_version || !ex.agc_ext_version ||
        !ex.agc_out_trace_enabled || !ex.agc_out_trace_dropped) {
      return null;
    }
    let extVersion = "";
    try {
      const ptr = ex.agc_ext_version();
      const bytes = this.memArray.subarray(ptr);
      const nul = bytes.indexOf(0);
      extVersion = new TextDecoder().decode(bytes.subarray(0, nul >= 0 ? nul : 0));
    } catch { /* keep empty */ }
    return {
      hwioVersion: ex.agc_hwio_version(),
      extVersion,
      traceEnabled: ex.agc_out_trace_enabled(),
      traceDropped: ex.agc_out_trace_dropped(),
    };
  }

  // ---- M3.3A2-P5.d HW-I/O v3 monitor surface ---------------------------
  //
  // These wrappers are the ONLY way Worker code touches the trace ABI.
  // They are inert unless explicitly invoked: production boots dormant and
  // the monitor controller arms them only on an accepted profile entry.

  hwioVersion(): number {
    return this.exports.agc_hwio_version?.() ?? 0;
  }

  traceEnabled(): boolean {
    return (this.exports.agc_out_trace_enabled?.() ?? 0) !== 0;
  }

  setTraceEnabled(enabled: boolean): void {
    this.exports.agc_out_trace_set_enabled?.(enabled ? 1 : 0);
  }

  resetTrace(): void {
    this.exports.agc_out_trace_reset?.();
  }

  traceDropped(): number {
    return this.exports.agc_out_trace_dropped?.() ?? 0;
  }

  /** Drain the WASM output-counter ring EXACTLY once. After this call the
   *  ring is empty by construction — a second drain in the same tick
   *  returns []. Never throws when the exports are absent. */
  drainTrace(): AgcOutTraceRecord[] {
    const drain = this.exports.agc_out_trace_drain;
    if (!drain || !this.exports.malloc || !this.exports.free) return [];
    const entryBytes = this.exports.agc_out_trace_entry_size?.() ?? TRACE_ENTRY_BYTES;
    const ptr = this.exports.malloc(entryBytes * TRACE_DRAIN_MAX);
    if (!ptr) return [];
    try {
      const count = drain(ptr, TRACE_DRAIN_MAX);
      if (count <= 0) return [];
      // memory may have grown during malloc; re-derive the view.
      const view = new DataView(this.mem.buffer, ptr, entryBytes * count);
      const out: AgcOutTraceRecord[] = [];
      for (let i = 0; i < count; i++) {
        const o = i * entryBytes;
        out.push({
          sequence: { hi: view.getUint32(o + 4, true), lo: view.getUint32(o + 0, true) },
          cycle: { hi: view.getUint32(o + 12, true), lo: view.getUint32(o + 8, true) },
          address: view.getUint16(o + 16, true),
          operation: view.getUint16(o + 18, true),
          delta: view.getInt32(o + 20, true),
          valueBefore: view.getUint16(o + 24, true),
          valueAfter: view.getUint16(o + 26, true),
        });
      }
      return out;
    } finally {
      this.exports.free(ptr);
      this.memArray = new Uint8Array(this.mem.buffer);
    }
  }

  /** True when the running artifact exposes the batched host-input ABI. */
  hwInputSupported(): boolean {
    return typeof this.exports.agc_hw_input_apply === "function";
  }

  /**
   * Apply an ordered batch of unprogrammed counter increments through
   * `agc_hw_input_apply`. Validation inside the WASM is ATOMIC: on any
   * error NO record is applied. Opposing pulses are never collapsed here —
   * the records are transcribed verbatim and applied one pulse at a time so
   * the CDU FIFO ordering yaAGC models is preserved.
   */
  applyHwInput(records: readonly AgcHwInputRecordInput[]): AgcHwInputApplyResult {
    const apply = this.exports.agc_hw_input_apply;
    if (!apply || !this.exports.malloc || !this.exports.free) {
      return { code: AGC_HW_INPUT_RESULT.INTERNAL, ok: false, errorIndex: -1 };
    }
    if (records.length === 0) {
      return { code: AGC_HW_INPUT_RESULT.OK, ok: true, errorIndex: -1 };
    }
    if (records.length > AGC_HW_INPUT_MAX_RECORDS) {
      return { code: AGC_HW_INPUT_RESULT.BATCH_LIMIT, ok: false, errorIndex: -1 };
    }
    const ptr = this.exports.malloc(HW_INPUT_RECORD_BYTES * records.length);
    if (!ptr) {
      return { code: AGC_HW_INPUT_RESULT.INTERNAL, ok: false, errorIndex: -1 };
    }
    try {
      const view = new DataView(this.mem.buffer, ptr, HW_INPUT_RECORD_BYTES * records.length);
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const o = i * HW_INPUT_RECORD_BYTES;
        view.setUint16(o + 0, r.counterAddress, true);
        view.setUint16(o + 2, AGC_INC_TYPE_IDS[r.incType], true);
        view.setUint32(o + 4, r.pulseCount, true);
        view.setUint32(o + 8, r.suborder, true);
      }
      const code = apply(ptr, records.length);
      const errorIndex =
        code === AGC_HW_INPUT_RESULT.OK
          ? -1
          : (this.exports.agc_hw_input_last_error_index?.() ?? -1);
      return { code, ok: code === AGC_HW_INPUT_RESULT.OK, errorIndex };
    } finally {
      this.exports.free(ptr);
      this.memArray = new Uint8Array(this.mem.buffer);
    }
  }

  // ---- M3.3B2 HW-I/O v3 radar surface ---------------------------------

  /** True when the running artifact exposes the v3 radar/interrupt ABI. */
  radarInterruptSupported(): boolean {
    return (
      typeof this.exports.agc_landing_radar_update_apply === "function" &&
      typeof this.exports.agc_request_hardware_interrupt === "function"
    );
  }

  /** Set the native RADARUPT latch (and nothing else). The emulator's own
   *  dispatcher decides when — or whether — the handler is entered. */
  requestRadarInterrupt(): number {
    return this.exports.agc_request_hardware_interrupt?.(AGC_INTERRUPT_INDEX.RADARUPT)
      ?? AGC_HW_INPUT_RESULT.INTERNAL;
  }

  /** Read-only: is the given interrupt latch currently set? */
  interruptRequestPending(index: number): boolean {
    return (this.exports.agc_interrupt_request_pending?.(index) ?? 0) !== 0;
  }

  /** Read-only: are interrupts currently inhibited (INHINT active)? */
  interruptsInhibited(): boolean {
    return (this.exports.agc_interrupt_inhibited?.() ?? 0) !== 0;
  }

  /** Read-only: is the AGC currently inside an interrupt service routine? */
  inIsr(): boolean {
    return (this.exports.agc_in_isr?.() ?? 0) !== 0;
  }

  /** Read-only: index of the interrupt being serviced (0 = none). */
  interruptInService(): number {
    return this.exports.agc_interrupt_in_service?.() ?? 0;
  }

  /**
   * Atomic landing-radar delivery: serially shift `word` into RNRAD (0o46)
   * MSB-first over `bitCount` SHINC/SHANC pulses, then (optionally) raise
   * RADARUPT — in that order, inside one host call, so no CPU step can
   * observe a half-shifted counter with the interrupt already pending.
   */
  applyLandingRadarUpdate(
    word: number,
    bitCount = 15,
    raiseRadarupt = true,
  ): number {
    const apply = this.exports.agc_landing_radar_update_apply;
    if (!apply || !this.exports.malloc || !this.exports.free) {
      return AGC_HW_INPUT_RESULT.INTERNAL;
    }
    const ptr = this.exports.malloc(LR_UPDATE_BYTES);
    if (!ptr) return AGC_HW_INPUT_RESULT.INTERNAL;
    try {
      const view = new DataView(this.mem.buffer, ptr, LR_UPDATE_BYTES);
      view.setUint16(0, word & 0x7fff, true);
      view.setUint16(2, bitCount, true);
      view.setUint16(4, raiseRadarupt ? 1 : 0, true);
      view.setUint16(6, 0, true);
      return apply(ptr);
    } finally {
      this.exports.free(ptr);
      this.memArray = new Uint8Array(this.mem.buffer);
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
    this.io.reset();
    this.erasableView = null;
    this.totalSteps = 0;
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

  /** Advance the CPU by a small fixed number of instructions and drain I/O. */
  singleStep(steps = 1): void {
    this.stepCpu(steps);
    this.drainIo();
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const packet = this.readOnePacket();
      if (!packet) break;
      const [channel, value] = packet;
      const prevLamps = this.io.lampBits();
      const before = this.io.seen(channel) ? this.io.channel(channel) : null;
      // Lossless first: EVERY packet is observable, including repeats.
      this.events.onChannelPacket?.(channel, value, before);
      const changed = this.io.ingest(channel, value);
      if (changed) this.events.onChannelUpdate?.(channel, value);
      const newLamps = this.io.lampBits();
      if (newLamps !== prevLamps) this.events.onDskyLampsUpdate?.(newLamps);
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
    return this.io.channel(channel);
  }

  /** Current combined DSKY lamp word. */
  lampBits(): DskyLampBits {
    return this.io.lampBits();
  }

  /** Most-recent-first snapshot of recent channel events. */
  recentEvents(limit?: number): ChannelEvent[] {
    return this.io.recentEvents(limit);
  }

  /** Total number of ingested channel-change events (monotonic). */
  totalChannelEvents(): number {
    return this.io.totalEvents();
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
