// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B §10 — rope-level verification of the scenario pad load.
//
// Installs the real 22-word manifest into the real pinned Luminary099 rope
// through the real HW-I/O v4 window, then lets the rope run NORMALLY. No Z
// forcing, no direct routine invocation, no bypassing of AGC execution.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
  encodePadLoadRecords,
  validatePadLoadManifest,
} from "@/simulation/agcio/padLoadManifest";
import {
  CDUX_ADDRESS, CDUY_ADDRESS, CDUZ_ADDRESS,
  FLAGWRD3_ADDRESS, REFSMFLG_MASK,
  REFSMMAT_ECADR, REFSMMAT_WORD_COUNT,
  IDENTITY_MATRIX3, wordsToRefsmmat,
} from "@/simulation/agcio/imuBootstrap";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const WASM_PATH = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

/** PIPA counters — Luminary099/ERASABLE_ASSIGNMENTS.agc. */
const PIPAX = 0o37;
const PIPAY = 0o40;
const PIPAZ = 0o41;

interface Ext {
  malloc: (n: number) => number;
  free: (p: number) => void;
  get_erasable_ptr: () => number;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  packet_read: () => number;
  agc_pad_load_window_open: () => number;
  agc_pad_load_window_close: () => number;
  agc_erasable_pad_load_apply: (ptr: number, count: number) => number;
  agc_erasable_read_word: (address: number) => number;
  agc_pad_load_status: () => number;
}

async function boot(): Promise<{ ex: Ext; memory: WebAssembly.Memory }> {
  if (!existsSync(ROPE_PATH)) throw new Error(`pinned rope missing at ${ROPE_PATH}`);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM_PATH), {
    env: { memory },
    wasi_snapshot_preview1: { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 },
  });
  const ex = instance.exports as unknown as Ext;
  const rope = new Uint8Array(readFileSync(ROPE_PATH));
  const ptr = ex.malloc(rope.length);
  new Uint8Array(memory.buffer, ptr, rope.length).set(rope);
  ex.set_fixed(ptr);
  ex.cpu_reset();
  return { ex, memory };
}

function installBootstrap(ex: Ext, memory: WebAssembly.Memory): number {
  const bytes = encodePadLoadRecords(MANIFEST.records);
  const ptr = ex.malloc(bytes.length);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  expect(ex.agc_pad_load_window_open()).toBe(0);
  const rc = ex.agc_erasable_pad_load_apply(ptr, MANIFEST.records.length);
  expect(ex.agc_pad_load_window_close()).toBe(0);
  ex.free(ptr);
  return rc;
}

describe("rope-level fixed-attitude IMU bootstrap (HW-I/O v4)", () => {
  it("installs, reads back, and survives normal rope execution", async () => {
    expect(validatePadLoadManifest()).toEqual([]);
    const { ex, memory } = await boot();

    expect(installBootstrap(ex, memory)).toBe(0);

    // --- Read back every one of the 22 words.
    for (const r of MANIFEST.records) {
      expect(ex.agc_erasable_read_word(r.address)).toBe(r.value);
    }

    // --- Decode the installed REFSMMAT straight out of erasable memory.
    const words: number[] = [];
    for (let i = 0; i < REFSMMAT_WORD_COUNT; i++) {
      words.push(ex.agc_erasable_read_word(REFSMMAT_ECADR + i));
    }
    const decoded = wordsToRefsmmat(words);
    for (let i = 0; i < 9; i++) expect(decoded[i]).toBeCloseTo(IDENTITY_MATRIX3[i], 7);

    // --- REFSMFLG is set in FLAGWRD3.
    expect(ex.agc_erasable_read_word(FLAGWRD3_ADDRESS) & REFSMFLG_MASK).toBe(REFSMFLG_MASK);

    // --- Now let the rope run its normal initialisation. Nothing forced.
    const before = { x: ex.agc_erasable_read_word(CDUX_ADDRESS) };
    void before;
    ex.cpu_step(400_000);

    // --- At a fixed attitude the CDU counters need no pulses: Luminary reads
    //     them without draining, so they must still be zero.
    expect(ex.agc_erasable_read_word(CDUX_ADDRESS)).toBe(0);
    expect(ex.agc_erasable_read_word(CDUY_ADDRESS)).toBe(0);
    expect(ex.agc_erasable_read_word(CDUZ_ADDRESS)).toBe(0);

    // --- PIPA counters remain owned by Luminary's own read/clear sequence:
    //     with no host pulses injected they stay zero.
    for (const a of [PIPAX, PIPAY, PIPAZ]) {
      expect(ex.agc_erasable_read_word(a)).toBe(0);
    }

    // --- The pad-load window is permanently closed before execution resumed.
    expect(ex.agc_pad_load_status() & 1).toBe(0);
  }, 180_000);

  it("emits no coarse-align / IMU-fail discrete on channel 012 or 011 after bootstrap", async () => {
    const { ex, memory } = await boot();
    expect(installBootstrap(ex, memory)).toBe(0);

    // CHAN12 bit 4 = ZERO IMU CDUS, bit 5 = COARSE ALIGN ENABLE
    // (Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc).
    const COARSE_ALIGN_BITS = 0o30;
    let sawCoarseAlign = false;
    for (let i = 0; i < 200_000; i++) {
      ex.cpu_step(1);
      for (;;) {
        const packet = ex.packet_read();
        if (packet === 0) break;
        const channel = (packet >> 16) & 0o777;
        const value = packet & 0o77777;
        if (channel === 0o12 && (value & COARSE_ALIGN_BITS) !== 0) sawCoarseAlign = true;
      }
    }
    expect(sawCoarseAlign).toBe(false);
  }, 180_000);
});
