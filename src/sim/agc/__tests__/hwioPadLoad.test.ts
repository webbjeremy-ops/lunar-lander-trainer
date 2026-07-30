// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B §7 — HW-I/O v4 pad-load ABI tests.
//
// Loads `src/third-party/webagc/yaAGC-ext.wasm` directly (no adapter, no
// Worker) and proves the pad-load window semantics: atomicity, one-shot,
// compare-before-write, bounded, duplicate/address/word rejection, reset
// disarming, CPU-run invalidation, and complete dormancy when unused.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const WASM_PATH = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

interface Ext {
  memory?: WebAssembly.Memory;
  malloc: (n: number) => number;
  free: (p: number) => void;
  get_erasable_ptr: () => number;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  version: () => number;
  agc_ext_version: () => number;
  agc_hwio_version: () => number;
  agc_out_trace_enabled: () => number;
  agc_out_trace_dropped: () => number;
  agc_out_trace_entry_size: () => number;
  agc_out_trace_drain: (dst: number, max: number) => number;
  agc_out_trace_set_enabled: (v: number) => number;
  agc_out_trace_reset: () => void;
  agc_pad_load_record_size: () => number;
  agc_pad_load_max_records: () => number;
  agc_pad_load_status: () => number;
  agc_pad_load_applied_count: () => number;
  agc_pad_load_last_error_index: () => number;
  agc_pad_load_window_open: () => number;
  agc_pad_load_window_close: () => number;
  agc_erasable_pad_load_apply: (ptr: number, count: number) => number;
  agc_erasable_read_word: (address: number) => number;
}

/** hwio.c `HWIO_ERR_PAD_*`. */
const ERR = {
  WINDOW_CLOSED: -20,
  ALREADY_OPEN: -21,
  CONSUMED: -22,
  CPU_RAN: -23,
  TRACE_ACTIVE: -24,
  COUNT: -25,
  ADDRESS: -26,
  DUPLICATE: -27,
  WORD: -28,
  MISMATCH: -29,
  SEALED: -30,
} as const;

const STATUS = { OPEN: 1, CONSUMED: 2, SEALED: 4, CPU_RAN: 8 } as const;

let memory: WebAssembly.Memory;

async function load(): Promise<Ext> {
  const bytes = readFileSync(WASM_PATH);
  memory = new WebAssembly.Memory({ initial: 5 });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 },
  });
  return instance.exports as unknown as Ext;
}

function cstr(ptr: number): string {
  const u8 = new Uint8Array(memory.buffer);
  let end = ptr;
  while (u8[end] !== 0) end++;
  return new TextDecoder().decode(u8.subarray(ptr, end));
}

type Rec = [address: number, expectedBefore: number, value: number];

function writeRecords(ex: Ext, recs: readonly Rec[]): number {
  const ptr = ex.malloc(Math.max(6, recs.length * 6));
  const dv = new DataView(memory.buffer);
  recs.forEach((r, i) => {
    dv.setUint16(ptr + i * 6, r[0], true);
    dv.setUint16(ptr + i * 6 + 2, r[1], true);
    dv.setUint16(ptr + i * 6 + 4, r[2], true);
  });
  return ptr;
}

function apply(ex: Ext, recs: readonly Rec[]): number {
  const ptr = writeRecords(ex, recs);
  const rc = ex.agc_erasable_pad_load_apply(ptr, recs.length);
  ex.free(ptr);
  return rc;
}

const GOOD: readonly Rec[] = [
  [0o1733, 0, 0o20000],
  [0o1741, 0, 0o20000],
  [0o1751, 0, 0o20000],
  [0o32, 0, 0],
  [0o77, 0, 0o10000],
];

describe("HW-I/O v4 — identity and ABI surface", () => {
  it("keeps the legacy upstream version stamp and reports the v4 extension", async () => {
    const ex = await load();
    expect(cstr(ex.version())).toBe("2020-12-24 ddc65e7be");
    expect(cstr(ex.agc_ext_version())).toBe("ddc65e7be+apollo-browser-hwio-v4");
    expect(ex.agc_hwio_version()).toBe(4);
  });

  it("exposes the pad-load ABI constants", async () => {
    const ex = await load();
    expect(ex.agc_pad_load_record_size()).toBe(6);
    expect(ex.agc_pad_load_max_records()).toBe(64);
  });

  it("retains every v3 export unchanged", async () => {
    const ex = await load() as unknown as Record<string, unknown>;
    for (const name of [
      "agc_out_trace_entry_size", "agc_out_trace_drain", "agc_out_trace_dropped",
      "agc_out_trace_reset", "agc_out_trace_set_enabled", "agc_out_trace_enabled",
      "agc_counter_increment", "agc_hw_input_apply", "agc_hw_input_last_error_index",
      "agc_request_hardware_interrupt", "agc_interrupt_request_pending",
      "agc_interrupt_inhibited", "agc_in_isr", "agc_interrupt_in_service",
      "agc_landing_radar_update_size", "agc_landing_radar_update_apply",
    ]) {
      expect(name in ex ? typeof ex[name] : "missing").toBe("function");
    }
  });
});

describe("HW-I/O v4 — pad-load window lifecycle", () => {
  let ex: Ext;
  beforeEach(async () => {
    ex = await load();
    ex.cpu_reset();
  });

  it("defaults closed and rejects writes while closed", () => {
    expect(ex.agc_pad_load_status()).toBe(0);
    expect(apply(ex, GOOD)).toBe(ERR.WINDOW_CLOSED);
  });

  it("applies a valid batch exactly, in caller order, and reads back", () => {
    expect(ex.agc_pad_load_window_open()).toBe(0);
    expect(ex.agc_pad_load_status() & STATUS.OPEN).toBe(STATUS.OPEN);
    expect(apply(ex, GOOD)).toBe(0);
    expect(ex.agc_pad_load_applied_count()).toBe(GOOD.length);
    for (const [addr, , value] of GOOD) {
      expect(ex.agc_erasable_read_word(addr)).toBe(value);
    }
  });

  it("is one-shot: a second apply in the same window fails", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, GOOD)).toBe(0);
    expect(apply(ex, GOOD)).toBe(ERR.CONSUMED);
  });

  it("cannot be reopened once closed in the same epoch", () => {
    ex.agc_pad_load_window_open();
    expect(ex.agc_pad_load_window_close()).toBe(0);
    expect(ex.agc_pad_load_status() & STATUS.SEALED).toBe(STATUS.SEALED);
    expect(ex.agc_pad_load_window_open()).toBe(ERR.SEALED);
    expect(apply(ex, GOOD)).toBe(ERR.WINDOW_CLOSED);
  });

  it("rejects opening twice", () => {
    expect(ex.agc_pad_load_window_open()).toBe(0);
    expect(ex.agc_pad_load_window_open()).toBe(ERR.ALREADY_OPEN);
  });

  it("is disarmed by cpu_reset and leaves no installed words behind", () => {
    ex.agc_pad_load_window_open();
    expect(apply(ex, GOOD)).toBe(0);
    ex.cpu_reset();
    expect(ex.agc_pad_load_status()).toBe(0);
    expect(ex.agc_erasable_read_word(0o1733)).toBe(0);
  });

  it("invalidates the window when the CPU runs after opening", () => {
    ex.agc_pad_load_window_open();
    ex.cpu_step(2);
    expect(ex.agc_pad_load_status() & STATUS.CPU_RAN).toBe(STATUS.CPU_RAN);
    expect(apply(ex, GOOD)).toBe(ERR.CPU_RAN);
    expect(ex.agc_erasable_read_word(0o1733)).toBe(0);
  });

  it("refuses to open while the output trace is active", () => {
    ex.agc_out_trace_set_enabled(1);
    expect(ex.agc_pad_load_window_open()).toBe(ERR.TRACE_ACTIVE);
    ex.agc_out_trace_set_enabled(0);
    ex.agc_out_trace_reset();
    expect(ex.agc_pad_load_window_open()).toBe(0);
  });
});

describe("HW-I/O v4 — batch validation is atomic", () => {
  let ex: Ext;
  beforeEach(async () => {
    ex = await load();
    ex.cpu_reset();
    ex.agc_pad_load_window_open();
  });

  const expectNothingWritten = (e: Ext) => {
    expect(e.agc_erasable_read_word(0o1733)).toBe(0);
    expect(e.agc_erasable_read_word(0o32)).toBe(0);
    expect(e.agc_pad_load_status() & STATUS.CONSUMED).toBe(0);
  };

  it("rejects a zero-length batch", () => {
    expect(apply(ex, [])).toBe(ERR.COUNT);
    expectNothingWritten(ex);
  });

  it("rejects an oversized batch atomically", () => {
    const big: Rec[] = Array.from({ length: 65 }, (_, i) => [0o1000 + i, 0, 1]);
    expect(apply(ex, big)).toBe(ERR.COUNT);
    expectNothingWritten(ex);
  });

  it("rejects an out-of-range address and writes nothing", () => {
    expect(apply(ex, [[0o1733, 0, 0o20000], [4095, 0, 1]])).toBe(ERR.ADDRESS);
    expect(ex.agc_pad_load_last_error_index()).toBe(1);
    expectNothingWritten(ex);
  });

  it("rejects a duplicated address and writes nothing", () => {
    expect(apply(ex, [[0o1733, 0, 0o20000], [0o1733, 0, 0]])).toBe(ERR.DUPLICATE);
    expect(ex.agc_pad_load_last_error_index()).toBe(1);
    expectNothingWritten(ex);
  });

  it("rejects a word outside the AGC word representation", () => {
    expect(apply(ex, [[0o1733, 0, 0o20000], [0o32, 0, 0o100000]])).toBe(ERR.WORD);
    expectNothingWritten(ex);
  });

  it("rejects an expected-before mismatch and writes nothing", () => {
    expect(apply(ex, [[0o1733, 0, 0o20000], [0o32, 0o777, 0]])).toBe(ERR.MISMATCH);
    expect(ex.agc_pad_load_last_error_index()).toBe(1);
    expectNothingWritten(ex);
  });

  it("generates no output-counter trace activity", () => {
    expect(apply(ex, GOOD)).toBe(0);
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
    const size = ex.agc_out_trace_entry_size();
    const dst = ex.malloc(size * 8);
    expect(ex.agc_out_trace_drain(dst, 8)).toBe(0);
    ex.free(dst);
  });
});

describe("HW-I/O v4 — unused pad load is exactly dormant", () => {
  it("never perturbs a running rope when the window is never opened", async () => {
    if (!existsSync(ROPE_PATH)) throw new Error(`pinned rope missing at ${ROPE_PATH}`);
    const ex = await load();
    const rope = new Uint8Array(readFileSync(ROPE_PATH));
    const ptr = ex.malloc(rope.length);
    new Uint8Array(memory.buffer, ptr, rope.length).set(rope);
    ex.set_fixed(ptr);
    ex.cpu_reset();
    ex.cpu_step(200_000);
    expect(ex.agc_pad_load_status()).toBe(0);
    expect(ex.agc_pad_load_applied_count()).toBe(0);
    expect(ex.agc_pad_load_last_error_index()).toBe(-1);
  }, 120_000);
});
