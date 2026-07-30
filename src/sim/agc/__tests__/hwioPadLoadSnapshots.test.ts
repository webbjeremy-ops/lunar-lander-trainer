// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C §1 + §3 — full-erasable snapshot proof around the HW-I/O v4
// pad-load API.
//
// The lifecycle tests in `hwioPadLoad.test.ts` spot-check individual words.
// This file proves the stronger property the acceptance chain requires:
// EVERY negative path leaves the ENTIRE 2048-word erasable image
// byte-identical, and the one positive path (the real 22-word scenario
// bootstrap) changes EXACTLY the manifest's address set and nothing else.
//
// It also proves the pad-load path is side-effect free at the hardware
// boundary: no output packet, no counter-trace entry, no hardware-input
// trace, no interrupt request.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
  encodePadLoadRecords,
  validatePadLoadManifest,
} from "@/simulation/agcio/padLoadManifest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const WASM_PATH = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

/** hwio.c `HWIO_PAD_*` window bounds. */
const PAD_MIN_ADDRESS = 0o24;
const PAD_MAX_ADDRESS = 2047;
const ERASABLE_WORDS = 2048;

const ERR = {
  WINDOW_CLOSED: -20,
  CPU_RAN: -23,
  COUNT: -25,
  ADDRESS: -26,
  DUPLICATE: -27,
  WORD: -28,
  MISMATCH: -29,
  SEALED: -30,
} as const;

interface Ext {
  malloc: (n: number) => number;
  free: (p: number) => void;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  packet_read: () => number;
  agc_out_trace_dropped: () => number;
  agc_out_trace_entry_size: () => number;
  agc_out_trace_drain: (dst: number, max: number) => number;
  agc_out_trace_enabled: () => number;
  agc_hw_input_last_error_index: () => number;
  agc_interrupt_request_pending: (vector: number) => number;
  agc_pad_load_status: () => number;
  agc_pad_load_applied_count: () => number;
  agc_pad_load_last_error_index: () => number;
  agc_pad_load_window_open: () => number;
  agc_pad_load_window_close: () => number;
  agc_erasable_pad_load_apply: (ptr: number, count: number) => number;
  agc_erasable_read_word: (address: number) => number;
}

let memory: WebAssembly.Memory;

async function load(withRope: boolean): Promise<Ext> {
  if (withRope && !existsSync(ROPE_PATH)) {
    throw new Error(`pinned rope missing at ${ROPE_PATH}`);
  }
  memory = new WebAssembly.Memory({ initial: 5 });
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM_PATH), {
    env: { memory },
    wasi_snapshot_preview1: { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 },
  });
  const ex = instance.exports as unknown as Ext;
  if (withRope) {
    const rope = new Uint8Array(readFileSync(ROPE_PATH));
    const ptr = ex.malloc(rope.length);
    new Uint8Array(memory.buffer, ptr, rope.length).set(rope);
    ex.set_fixed(ptr);
  }
  ex.cpu_reset();
  return ex;
}

/** Complete erasable image, read through the read-only v4 export. */
function snapshotErasable(ex: Ext): Uint16Array {
  const out = new Uint16Array(ERASABLE_WORDS);
  for (let a = 0; a < ERASABLE_WORDS; a++) out[a] = ex.agc_erasable_read_word(a);
  return out;
}

function diffAddresses(before: Uint16Array, after: Uint16Array): number[] {
  const changed: number[] = [];
  for (let a = 0; a < ERASABLE_WORDS; a++) if (before[a] !== after[a]) changed.push(a);
  return changed;
}

type Rec = [address: number, expectedBefore: number, value: number];

function apply(ex: Ext, recs: readonly Rec[]): number {
  const ptr = ex.malloc(Math.max(6, recs.length * 6));
  const dv = new DataView(memory.buffer);
  recs.forEach((r, i) => {
    dv.setUint16(ptr + i * 6, r[0], true);
    dv.setUint16(ptr + i * 6 + 2, r[1], true);
    dv.setUint16(ptr + i * 6 + 4, r[2], true);
  });
  const rc = ex.agc_erasable_pad_load_apply(ptr, recs.length);
  ex.free(ptr);
  return rc;
}

function drainPackets(ex: Ext): number {
  let n = 0;
  for (;;) {
    if (ex.packet_read() >>> 0 ? true : false) n++;
    else break;
    if (n > 100_000) throw new Error("runaway packet drain");
  }
  return n;
}

describe("HW-I/O v4 pad load — every rejection is a total no-op", () => {
  let ex: Ext;
  let before: Uint16Array;

  beforeEach(async () => {
    ex = await load(false);
    before = snapshotErasable(ex);
  });

  const expectPristine = () => {
    expect(diffAddresses(before, snapshotErasable(ex))).toEqual([]);
    expect(ex.agc_pad_load_applied_count()).toBe(0);
    // No hardware side effects whatsoever.
    expect(drainPackets(ex)).toBe(0);
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
    expect(ex.agc_hw_input_last_error_index()).toBe(-1);
    for (const vector of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(ex.agc_interrupt_request_pending(vector)).toBe(0);
    }
  };

  it("write while the window has never been opened", () => {
    expect(apply(ex, [[0o1733, 0, 0o20000]])).toBe(ERR.WINDOW_CLOSED);
    expectPristine();
  });

  it("empty batch", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, [])).toBe(ERR.COUNT);
    expectPristine();
  });

  it("oversized batch (65 records)", () => {
    ex.agc_pad_load_window_open();
    const big: Rec[] = Array.from({ length: 65 }, (_, i) => [0o1000 + i, 0, 1]);
    expect(apply(ex, big)).toBe(ERR.COUNT);
    expectPristine();
  });

  it("address below the pad window (central/editing registers)", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, [[0o1733, 0, 0o20000], [PAD_MIN_ADDRESS - 1, 0, 1]])).toBe(ERR.ADDRESS);
    expect(ex.agc_pad_load_last_error_index()).toBe(1);
    expectPristine();
  });

  it("address above the pad window", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, [[0o1733, 0, 0o20000], [PAD_MAX_ADDRESS + 1, 0, 1]])).toBe(ERR.ADDRESS);
    expectPristine();
  });

  it("duplicate address anywhere in the batch", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, [
      [0o1733, 0, 0o20000],
      [0o1741, 0, 0o20000],
      [0o1733, 0, 0o30000],
    ])).toBe(ERR.DUPLICATE);
    expect(ex.agc_pad_load_last_error_index()).toBe(2);
    expectPristine();
  });

  it("illegal AGC word (value and expected-before alike)", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, [[0o1733, 0, 0o100000]])).toBe(ERR.WORD);
    expectPristine();
    expect(apply(ex, [[0o1733, 0o100000, 1]])).toBe(ERR.WORD);
    expectPristine();
  });

  it("expected-before compared against real erasable contents", () => {
    ex.agc_pad_load_window_open();
    // Every address in a freshly reset core reads 0; claim otherwise.
    expect(ex.agc_erasable_read_word(0o1733)).toBe(0);
    expect(apply(ex, [[0o1733, 1, 0o20000]])).toBe(ERR.MISMATCH);
    expect(ex.agc_pad_load_last_error_index()).toBe(0);
    expectPristine();
  });

  it("a mismatch in the LAST record still blocks the FIRST write", () => {
    ex.agc_pad_load_window_open();
    const batch: Rec[] = [
      [0o1733, 0, 0o20000],
      [0o1741, 0, 0o20000],
      [0o1751, 0, 0o20000],
      [0o77, 0o7777, 0o10000],
    ];
    expect(apply(ex, batch)).toBe(ERR.MISMATCH);
    expect(ex.agc_pad_load_last_error_index()).toBe(3);
    expectPristine();
  });

  it("CPU execution while the window is open invalidates it", () => {
    ex.agc_pad_load_window_open();
    ex.cpu_step(1);
    expect(apply(ex, [[0o1733, 0, 0o20000]])).toBe(ERR.CPU_RAN);
    // cpu_step legitimately mutates erasable (counters); compare only the
    // address the rejected batch targeted.
    expect(ex.agc_erasable_read_word(0o1733)).toBe(0);
    expect(ex.agc_pad_load_applied_count()).toBe(0);
  });

  it("a closed window is permanently sealed for the epoch", () => {
    ex.agc_pad_load_window_open();
    ex.agc_pad_load_window_close();
    expect(ex.agc_pad_load_window_open()).toBe(ERR.SEALED);
    expect(apply(ex, [[0o1733, 0, 0o20000]])).toBe(ERR.WINDOW_CLOSED);
    expectPristine();
  });
});

describe("HW-I/O v4 pad load — the real 22-word bootstrap installation ledger", () => {
  interface LedgerRow {
    symbol: string;
    addressOctal: string;
    expectedBefore: number;
    actualBefore: number;
    installed: number;
    readBack: number;
    category: string;
    citation: string;
  }

  it("installs exactly the manifest address set and nothing else", async () => {
    expect(validatePadLoadManifest()).toEqual([]);
    const ex = await load(true);

    const before = snapshotErasable(ex);
    expect(ex.agc_pad_load_status()).toBe(0);

    const bytes = encodePadLoadRecords(MANIFEST.records);
    const ptr = ex.malloc(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    expect(ex.agc_pad_load_window_open()).toBe(0);
    expect(ex.agc_erasable_pad_load_apply(ptr, MANIFEST.records.length)).toBe(0);
    expect(ex.agc_pad_load_window_close()).toBe(0);
    ex.free(ptr);

    const after = snapshotErasable(ex);

    // --- per-record ledger -------------------------------------------------
    const ledger: LedgerRow[] = MANIFEST.records.map((r) => ({
      symbol: r.symbol,
      addressOctal: r.addressOctal,
      expectedBefore: r.expectedBefore,
      actualBefore: before[r.address],
      installed: r.value,
      readBack: ex.agc_erasable_read_word(r.address),
      category: r.category,
      citation: r.citation.source,
    }));
    expect(ledger).toHaveLength(22);
    for (const row of ledger) {
      expect(row.expectedBefore).toBe(row.actualBefore);
      expect(row.installed).toBe(row.readBack);
      expect(row.citation.length).toBeGreaterThan(0);
    }
    expect(ex.agc_pad_load_applied_count()).toBe(22);

    // --- whole-image diff --------------------------------------------------
    const changed = diffAddresses(before, after).sort((a, b) => a - b);
    const manifestAddresses = MANIFEST.records
      .map((r) => r.address)
      .filter((a) => before[a] !== MANIFEST.records.find((r) => r.address === a)!.value)
      .sort((a, b) => a - b);
    expect(changed).toEqual(manifestAddresses);
    for (const a of changed) {
      expect(MANIFEST.records.some((r) => r.address === a)).toBe(true);
    }

    // --- installation produced no hardware activity ------------------------
    expect(drainPackets(ex)).toBe(0);
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
    for (const vector of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(ex.agc_interrupt_request_pending(vector)).toBe(0);
    }

    // --- API is closed and unusable immediately afterwards -----------------
    expect(ex.agc_pad_load_window_open()).toBe(ERR.SEALED);
    expect(apply(ex, [[0o1733, 0o20000, 0]])).toBe(ERR.WINDOW_CLOSED);
    expect(ex.agc_erasable_read_word(0o1733)).toBe(0o20000);

    // eslint-disable-next-line no-console
    console.log("[M3.3C bootstrap ledger]", JSON.stringify(ledger));
  }, 120_000);

  it("cpu_reset closes the lifecycle and discards the bootstrap", async () => {
    const ex = await load(true);
    const bytes = encodePadLoadRecords(MANIFEST.records);
    const ptr = ex.malloc(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    ex.agc_pad_load_window_open();
    expect(ex.agc_erasable_pad_load_apply(ptr, MANIFEST.records.length)).toBe(0);
    ex.agc_pad_load_window_close();
    ex.free(ptr);

    ex.cpu_reset();
    expect(ex.agc_pad_load_status()).toBe(0);
    expect(ex.agc_pad_load_applied_count()).toBe(0);
    for (const r of MANIFEST.records) {
      expect(ex.agc_erasable_read_word(r.address)).toBe(0);
    }
  }, 120_000);
});
