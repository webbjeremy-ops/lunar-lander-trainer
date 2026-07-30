// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3B2 — HW-I/O v3 landing-radar / RADARUPT low-level tests.
//
// These load `src/third-party/webagc/yaAGC-ext.wasm` DIRECTLY (no adapter, no
// Worker) so they cannot perturb the frozen M2/M3.1/M3.2 code paths.
//
// What is being proven, and why it matters:
//
//   * The v3 export sets ONLY the native `InterruptRequests[9]` latch. It
//     never writes Z/NextZ/ZRUPT/BRUPT and never forces handler entry.
//     Consequence: every inhibit and priority rule stays the emulator's.
//   * A latch raised while interrupts are inhibited (INHINT) is HELD, not
//     lost and not force-delivered, and is serviced after RELINT.
//   * `agc_landing_radar_update_apply` is atomic: RNRAD (0o46) is fully
//     shifted in BEFORE the latch is set, matching the real LR/RR PSA
//     transaction (Luminary099/P20-P25.agc INITREAD -> RADAREAD).
//
// Two ropes are used. A hand-assembled synthetic rope gives deterministic
// control over INHINT/RELINT; the pinned Luminary099 rope proves the path
// works against the real flight program's RADARUPT lead-in at 04044.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const EXT_WASM = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

/** Index 9 -> vector 04000 + 4*9 = 04044, labelled `RADAR RUPT` in
 *  Luminary099/INTERRUPT_LEAD_INS.agc. */
const RADARUPT_INDEX = 9;
const RNRAD = 0o46;

interface Ext {
  memory?: WebAssembly.Memory;
  malloc: (n: number) => number;
  free: (p: number) => void;
  get_erasable_ptr: () => number;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  agc_hwio_version: () => number;
  agc_counter_increment: (a: number, t: number) => number;
  agc_request_hardware_interrupt: (index: number) => number;
  agc_interrupt_request_pending: (index: number) => number;
  agc_interrupt_inhibited: () => number;
  agc_in_isr: () => number;
  agc_interrupt_in_service: () => number;
  agc_landing_radar_update_size: () => number;
  agc_landing_radar_update_apply: (ptr: number) => number;
}

async function loadExt(): Promise<{ ex: Ext; memory: WebAssembly.Memory }> {
  const bytes = readFileSync(EXT_WASM);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const stub = () => 0;
  const wasi = new Proxy({} as Record<string, () => number>, { get: () => stub });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });
  return { ex: instance.exports as unknown as Ext, memory };
}

/** `set_fixed` consumes 34 banks x 02000 words x 2 bytes, big-endian, each
 *  word stored left-shifted by one (the parity bit occupies bit 0). File
 *  offset 0 is bank 02, i.e. AGC addresses 04000..05777 — which is where
 *  `cpu_reset` starts execution and where the interrupt vectors live. */
const BANK_WORDS = 0o2000;
const FIXED_BANKS = 34;

function synthRope(program: Map<number, number>): Uint8Array {
  const buf = new Uint8Array(FIXED_BANKS * BANK_WORDS * 2);
  for (const [address, word] of program) {
    if (address < 0o4000 || address >= 0o6000) {
      throw new Error(`synthRope only models bank 02/03 (got ${address.toString(8)})`);
    }
    const offset = (address - 0o4000) * 2;
    const stored = (word << 1) & 0xffff;
    buf[offset] = (stored >> 8) & 0xff;
    buf[offset + 1] = stored & 0xff;
  }
  return buf;
}

function loadFixed(ex: Ext, memory: WebAssembly.Memory, rope: Uint8Array): void {
  const ptr = ex.malloc(rope.byteLength);
  new Uint8Array(memory.buffer, ptr, rope.byteLength).set(rope);
  ex.set_fixed(ptr);
  ex.free(ptr);
}

function erasable(ex: Ext, memory: WebAssembly.Memory): Uint16Array {
  return new Uint16Array(memory.buffer, ex.get_erasable_ptr(), 2048);
}

const INHINT = 0o00004;
const RELINT = 0o00003;
/** TCF <address12> — opcode 1. Used as a one-word "advance"/self-loop. */
const TCF = (address: number) => 0o10000 | (address & 0o7777);
/** RESUME == `INDEX BRUPT` == 050017: the canonical ISR exit. */
const RESUME = 0o50017;

/**
 * Deterministic synthetic program. Interrupt vectors live at 04000 + 4*i for
 * i in 1..10, so the main program is placed clear of them at 04100.
 *
 *   04000        TCF 04100        start (cpu_reset sets Z = 04000)
 *   04004..04050 RESUME           every vector except RADARUPT returns at once
 *   04044        TCF 04044        RADARUPT lead-in: park inside the ISR
 *   04100        INHINT           interrupts inhibited from here
 *   04101..      TCF chain        NOP_COUNT filler instructions
 *   ...          RELINT           interrupts allowed again
 *   ...          TCF self         idle self-loop (main program)
 *
 * Note the emulator natively raises DOWNRUPT/T3RUPT/T4RUPT from its own
 * scaler while this runs; the RESUME vectors let those come and go without
 * blocking the vector under test.
 */
const NOP_COUNT = 16;
const PROGRAM_BASE = 0o4100;
const RELINT_ADDRESS = PROGRAM_BASE + 1 + NOP_COUNT;
const MAIN_IDLE = RELINT_ADDRESS + 1;

function inhibitProgram(): Uint8Array {
  const p = new Map<number, number>();
  p.set(0o4000, TCF(PROGRAM_BASE));
  for (let i = 1; i <= 10; i++) {
    p.set(0o4000 + 4 * i, i === RADARUPT_INDEX ? TCF(0o4044) : RESUME);
  }
  p.set(PROGRAM_BASE, INHINT);
  for (let i = 0; i < NOP_COUNT; i++) {
    p.set(PROGRAM_BASE + 1 + i, TCF(PROGRAM_BASE + 2 + i));
  }
  p.set(RELINT_ADDRESS, RELINT);
  p.set(MAIN_IDLE, TCF(MAIN_IDLE));
  return synthRope(p);
}

/** Mirror of yaAGC `CounterSHINC`/`CounterSHANC` (agc_engine.c:1292-1316). */
function expectedRnrad(initial: number, word: number, bitCount: number): number {
  let value = initial;
  for (let b = bitCount - 1; b >= 0; b--) {
    const bit = (word >> b) & 1;
    value = ((value << 1) + bit) & 0o37777;
  }
  return value;
}

describe("HW-I/O v3 — ABI surface", () => {
  it("reports version 4 and exposes the radar transaction record size", async () => {
    const { ex } = await loadExt();
    expect(ex.agc_hwio_version()).toBe(4);
    expect(ex.agc_landing_radar_update_size()).toBe(8);
  });

  it("allow-lists RADARUPT only — every other vector is refused", async () => {
    const { ex } = await loadExt();
    ex.cpu_reset();
    for (let i = 0; i <= 12; i++) {
      if (i === RADARUPT_INDEX) continue;
      expect(ex.agc_request_hardware_interrupt(i)).toBe(-7);
      expect(ex.agc_interrupt_request_pending(i)).toBe(0);
    }
    expect(ex.agc_request_hardware_interrupt(RADARUPT_INDEX)).toBe(0);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(1);
  });

  it("a refused request mutates nothing at all", async () => {
    const { ex } = await loadExt();
    ex.cpu_reset();
    expect(ex.agc_request_hardware_interrupt(2)).toBe(-7);
    for (let i = 1; i <= 10; i++) expect(ex.agc_interrupt_request_pending(i)).toBe(0);
  });

  it("RNRAD now permits the authentic serial SHINC/SHANC sequences", async () => {
    const { ex } = await loadExt();
    ex.cpu_reset();
    expect(ex.agc_counter_increment(RNRAD, 5)).toBe(0); // SHINC
    expect(ex.agc_counter_increment(RNRAD, 6)).toBe(0); // SHANC
    // Still refuses non-host-input counters on the serial path.
    expect(ex.agc_counter_increment(0o55, 5)).toBe(-3);
  });
});

describe("HW-I/O v3 — landing-radar transaction validation", () => {
  let ex: Ext;
  let memory: WebAssembly.Memory;
  let ptr: number;

  beforeEach(async () => {
    ({ ex, memory } = await loadExt());
    ex.cpu_reset();
    ptr = ex.malloc(8);
  });

  function apply(word: number, bitCount: number, raise: number, reserved = 0): number {
    const view = new DataView(memory.buffer, ptr, 8);
    view.setUint16(0, word, true);
    view.setUint16(2, bitCount, true);
    view.setUint16(4, raise, true);
    view.setUint16(6, reserved, true);
    return ex.agc_landing_radar_update_apply(ptr);
  }

  it("rejects a zero or oversized bit count without touching RNRAD", () => {
    const er = erasable(ex, memory);
    const before = er[RNRAD];
    expect(apply(0o12345, 0, 1)).toBe(-9);
    expect(apply(0o12345, 16, 1)).toBe(-9);
    expect(er[RNRAD]).toBe(before);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  });

  it("rejects a non-zero reserved field (forward-compat guard)", () => {
    expect(apply(0o12345, 15, 1, 1)).toBe(-8);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  });

  it("shifts the word in MSB-first and raises the latch in one call", () => {
    const er = erasable(ex, memory);
    const initial = er[RNRAD];
    const word = 0o12345;
    expect(apply(word, 15, 1)).toBe(0);
    expect(er[RNRAD]).toBe(expectedRnrad(initial, word, 15));
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(1);
  });

  it("can deliver data WITHOUT raising the interrupt", () => {
    const er = erasable(ex, memory);
    const initial = er[RNRAD];
    expect(apply(0o07777, 15, 0)).toBe(0);
    expect(er[RNRAD]).toBe(expectedRnrad(initial, 0o07777, 15));
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  });

  it("the latch is a single-bit hardware flag: re-requesting does not queue", () => {
    expect(apply(0o1, 15, 1)).toBe(0);
    expect(apply(0o2, 15, 1)).toBe(0);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(1);
  });
});

describe("HW-I/O v3 — native inhibit and dispatch are untouched", () => {
  let ex: Ext;
  let memory: WebAssembly.Memory;

  beforeEach(async () => {
    ({ ex, memory } = await loadExt());
    loadFixed(ex, memory, inhibitProgram());
    ex.cpu_reset();
  });

  it("cpu_reset clears any pending latch", () => {
    expect(ex.agc_request_hardware_interrupt(RADARUPT_INDEX)).toBe(0);
    ex.cpu_reset();
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
    expect(ex.agc_in_isr()).toBe(0);
  });

  it("holds the request through INHINT and services it only after RELINT", () => {
    // Run forward until INHINT has taken effect. cpu_step granularity is
    // MCTs, not instructions, so do not assume a fixed step count.
    let inhibited = false;
    for (let i = 0; i < 50 && !inhibited; i++) {
      ex.cpu_step(1);
      inhibited = ex.agc_interrupt_inhibited() === 1;
    }
    expect(inhibited).toBe(true);

    expect(ex.agc_request_hardware_interrupt(RADARUPT_INDEX)).toBe(0);

    // While inhibited the latch must be HELD: not lost, not delivered.
    for (let i = 0; i < NOP_COUNT - 2; i++) {
      if (ex.agc_interrupt_inhibited() !== 1) break;
      ex.cpu_step(1);
      // Held, never delivered, for as long as the program inhibits.
      expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(1);
      expect(ex.agc_interrupt_in_service()).not.toBe(RADARUPT_INDEX);
    }

    // Run past RELINT. The emulator — not us — decides the exact MCT.
    // Other vectors (natively-raised DOWNRUPT etc.) RESUME immediately; the
    // RADARUPT lead-in parks, so `in_isr` latches high once index 9 is taken.
    let serviced = false;
    for (let i = 0; i < 5_000 && !serviced; i++) {
      ex.cpu_step(1);
      if (ex.agc_in_isr() === 1 && ex.agc_interrupt_in_service() === RADARUPT_INDEX) {
        serviced = true;
      }
    }
    expect(serviced).toBe(true);
    expect(ex.agc_interrupt_inhibited()).toBe(0);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  });

  it("never reaches the RADARUPT vector when no request was made", () => {
    for (let i = 0; i < 5_000; i++) {
      ex.cpu_step(1);
      expect(ex.agc_interrupt_in_service()).not.toBe(RADARUPT_INDEX);
    }
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  });
});

describe("HW-I/O v3 — against the pinned Luminary099 rope", () => {
  it("delivers RNRAD and reaches the real RADARUPT lead-in at 04044", async () => {
    if (!existsSync(ROPE_PATH)) {
      throw new Error(`pinned rope missing at ${ROPE_PATH}`);
    }
    const { ex, memory } = await loadExt();
    loadFixed(ex, memory, new Uint8Array(readFileSync(ROPE_PATH)));
    ex.cpu_reset();
    // Let the rope reach its idle/steady state first.
    ex.cpu_step(400_000);

    const er = erasable(ex, memory);
    const before = er[RNRAD];
    const word = 0o01234;
    const ptr = ex.malloc(8);
    const view = new DataView(memory.buffer, ptr, 8);
    view.setUint16(0, word, true);
    view.setUint16(2, 15, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, 0, true);
    expect(ex.agc_landing_radar_update_apply(ptr)).toBe(0);
    ex.free(ptr);

    // Data is complete BEFORE any CPU step observes the latch.
    expect(new Uint16Array(memory.buffer, ex.get_erasable_ptr(), 2048)[RNRAD])
      .toBe(expectedRnrad(before, word, 15));
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(1);

    let sawRadarupt = false;
    for (let i = 0; i < 50_000 && !sawRadarupt; i++) {
      ex.cpu_step(1);
      if (ex.agc_interrupt_in_service() === RADARUPT_INDEX && ex.agc_in_isr() === 1) {
        sawRadarupt = true;
      }
    }
    expect(sawRadarupt).toBe(true);
    expect(ex.agc_interrupt_request_pending(RADARUPT_INDEX)).toBe(0);
  }, 120_000);
});
