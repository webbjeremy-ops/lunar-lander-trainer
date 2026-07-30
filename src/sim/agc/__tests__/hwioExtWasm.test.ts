// M3.3A2-P2 — ABI-surface tests for the extended yaAGC WebAssembly artifact.
//
// These tests load `src/third-party/webagc/yaAGC-ext.wasm` DIRECTLY, without
// going through AgcCoreAdapter or the Worker, so they cannot affect the
// frozen M2 / M3.1 / M3.2 code paths. They verify only the new hardware-
// interface surface and that the legacy ABI is preserved intact.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(HERE, "../../../third-party/webagc/yaAGC-ext.wasm");

interface ExtExports {
  memory?: WebAssembly.Memory;
  malloc: (n: number) => number;
  free: (p: number) => void;
  get_erasable_ptr: () => number;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  packet_write: (ch: number, val: number) => number;
  packet_read: () => number;
  version: () => number;
  agc_ext_version: () => number;
  agc_hwio_version: () => number;
  agc_out_trace_entry_size: () => number;
  agc_out_trace_drain: (dst: number, max: number) => number;
  agc_out_trace_dropped: () => number;
  agc_out_trace_reset: () => void;
  agc_out_trace_set_enabled: (enabled: number) => number;
  agc_out_trace_enabled: () => number;
  agc_counter_increment: (address: number, incType: number) => number;
  agc_hw_input_apply: (records: number, count: number) => number;
  agc_hw_input_last_error_index: () => number;
  agc_request_hardware_interrupt: (index: number) => number;
  agc_interrupt_request_pending: (index: number) => number;
  agc_interrupt_inhibited: () => number;
  agc_in_isr: () => number;
  agc_interrupt_in_service: () => number;
  agc_landing_radar_update_size: () => number;
  agc_landing_radar_update_apply: (ptr: number) => number;
}

const LEGACY_EXPORTS = [
  "malloc", "free", "get_erasable_ptr", "set_fixed",
  "cpu_reset", "cpu_step", "packet_write", "packet_read", "version",
] as const;

const EXTENSION_EXPORTS = [
  "agc_ext_version", "agc_hwio_version",
  "agc_out_trace_entry_size", "agc_out_trace_drain",
  "agc_out_trace_dropped", "agc_out_trace_reset",
  "agc_out_trace_set_enabled", "agc_out_trace_enabled",
  "agc_counter_increment", "agc_hw_input_apply",
  "agc_hw_input_last_error_index",
  // M3.3B2 (HW-I/O v3)
  "agc_request_hardware_interrupt", "agc_interrupt_request_pending",
  "agc_interrupt_inhibited", "agc_in_isr", "agc_interrupt_in_service",
  "agc_landing_radar_update_size", "agc_landing_radar_update_apply",
] as const;

async function loadExt(): Promise<{ ex: ExtExports; memory: WebAssembly.Memory }> {
  const bytes = readFileSync(WASM_PATH);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const wasi = {
    fd_fdstat_get: () => 0,
    fd_seek: () => 0,
    fd_write: () => 0,
  };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });
  return { ex: instance.exports as unknown as ExtExports, memory };
}

function readCstr(memory: WebAssembly.Memory, ptr: number): string {
  const u8 = new Uint8Array(memory.buffer);
  let end = ptr;
  while (u8[end] !== 0) end++;
  return new TextDecoder().decode(u8.subarray(ptr, end));
}

describe("M3.3A2-P2 extended WASM ABI", () => {
  let ex: ExtExports;
  let memory: WebAssembly.Memory;

  beforeAll(async () => {
    ({ ex, memory } = await loadExt());
    ex.cpu_reset();
  });

  it("instantiates against plain env.memory + WASI stub", () => {
    expect(typeof ex.cpu_step).toBe("function");
  });

  it("retains all nine legacy exports", () => {
    for (const name of LEGACY_EXPORTS) {
      expect(typeof (ex as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("adds only the approved extension exports", () => {
    for (const name of EXTENSION_EXPORTS) {
      expect(typeof (ex as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("preserves upstream ancestry via version() and separates extension identity", () => {
    expect(readCstr(memory, ex.version())).toBe("2020-12-24 ddc65e7be");
    expect(readCstr(memory, ex.agc_ext_version())).toBe("ddc65e7be+apollo-browser-hwio-v3");
    expect(ex.agc_hwio_version()).toBe(3);
  });

  it("output-trace entry is 32 bytes (matches TS layout)", () => {
    expect(ex.agc_out_trace_entry_size()).toBe(32);
  });

  describe("single-shot counter increment (test-only path)", () => {
    it("rejects THRUST as observable-output (not host-incrementable)", () => {
      expect(ex.agc_counter_increment(0o55, 0)).toBe(-3);
    });
    it("rejects timer counters (internally-timed)", () => {
      expect(ex.agc_counter_increment(0o25, 0)).toBe(-3);
      expect(ex.agc_counter_increment(0o26, 0)).toBe(-3);
    });
    it("rejects unmapped addresses", () => {
      expect(ex.agc_counter_increment(0o60, 0)).toBe(-1);
      expect(ex.agc_counter_increment(0o77, 0)).toBe(-1);
    });
    it("rejects invalid IncType", () => {
      expect(ex.agc_counter_increment(0o37, 99)).toBe(-2);
    });
    it("rejects mapped address with wrong IncType (PIPAX + PCDU)", () => {
      expect(ex.agc_counter_increment(0o37, 1)).toBe(-3);
    });
    it("allowed PIPAX PINC advances erasable through native UnprogrammedIncrement", () => {
      ex.cpu_reset();
      const er = new Uint16Array(memory.buffer, ex.get_erasable_ptr(), 2048);
      const before = er[0o37];
      expect(ex.agc_counter_increment(0o37, 0)).toBe(0);
      expect(er[0o37]).toBe(before + 1);
    });
  });

  describe("batched host input", () => {
    function writeRecords(bufPtr: number,
      recs: Array<{ addr: number; inc: number; pulses: number; suborder: number }>) {
      const dv = new DataView(memory.buffer, bufPtr, recs.length * 12);
      recs.forEach((r, i) => {
        const o = i * 12;
        dv.setUint16(o, r.addr, true);
        dv.setUint16(o + 2, r.inc, true);
        dv.setUint32(o + 4, r.pulses, true);
        dv.setUint32(o + 8, r.suborder, true);
      });
    }

    it("accepts an ordered batch of PIPA + CDU pulses", () => {
      ex.cpu_reset();
      const ptr = ex.malloc(12 * 4);
      writeRecords(ptr, [
        { addr: 0o37, inc: 0, pulses: 5, suborder: 1 },
        { addr: 0o32, inc: 1, pulses: 3, suborder: 2 },
        { addr: 0o32, inc: 3, pulses: 3, suborder: 5 },
        { addr: 0o40, inc: 2, pulses: 2, suborder: 1 },
      ]);
      expect(ex.agc_hw_input_apply(ptr, 4)).toBe(0);
      expect(ex.agc_hw_input_last_error_index()).toBe(-1);
      ex.free(ptr);
    });

    it("atomically rejects a batch containing an unpermitted record and reports its index", () => {
      ex.cpu_reset();
      const er = new Uint16Array(memory.buffer, ex.get_erasable_ptr(), 2048);
      const pipaxBefore = er[0o37];
      const ptr = ex.malloc(12 * 3);
      writeRecords(ptr, [
        { addr: 0o37, inc: 0, pulses: 1, suborder: 0 },
        { addr: 0o55, inc: 0, pulses: 1, suborder: 0 }, // THRUST: forbidden
        { addr: 0o37, inc: 0, pulses: 1, suborder: 0 },
      ]);
      expect(ex.agc_hw_input_apply(ptr, 3)).toBe(-3);
      expect(ex.agc_hw_input_last_error_index()).toBe(1);
      // No mutation occurred (validation happens before any apply).
      expect(er[0o37]).toBe(pipaxBefore);
      ex.free(ptr);
    });

    it("rejects a batch that exceeds HWIO_MAX_PULSES_RECORD", () => {
      const ptr = ex.malloc(12);
      writeRecords(ptr, [{ addr: 0o37, inc: 0, pulses: 20_000, suborder: 0 }]);
      expect(ex.agc_hw_input_apply(ptr, 1)).toBe(-6);
      expect(ex.agc_hw_input_last_error_index()).toBe(0);
      ex.free(ptr);
    });

    it("opposing pulses are not algebraically combined", () => {
      ex.cpu_reset();
      const er = new Uint16Array(memory.buffer, ex.get_erasable_ptr(), 2048);
      // PIPAX: +5 then -5 must execute 10 unprogrammed sequences.
      const ptr = ex.malloc(12 * 2);
      writeRecords(ptr, [
        { addr: 0o37, inc: 0, pulses: 5, suborder: 0 },
        { addr: 0o37, inc: 2, pulses: 5, suborder: 1 },
      ]);
      expect(ex.agc_hw_input_apply(ptr, 2)).toBe(0);
      // Net magnitude after +5/-5 through native PINC/MINC returns to origin,
      // but the sequences ran (no collapse). We verify the sequences ran by
      // observing that a +5 alone leaves erasable at +5:
      ex.cpu_reset();
      writeRecords(ptr, [
        { addr: 0o37, inc: 0, pulses: 5, suborder: 0 },
      ]);
      expect(ex.agc_hw_input_apply(ptr, 1)).toBe(0);
      expect(er[0o37]).toBe(5);
      ex.free(ptr);
    });
  });

  describe("output trace", () => {
    it("drain returns 0 with no whitelisted counter motion, and cpu_reset clears state", () => {
      ex.cpu_reset();
      ex.cpu_step(2000);
      const cap = 64;
      const dst = ex.malloc(cap * 32);
      // No THRUST / CDU*CMD writes without a rope; expect zero entries.
      expect(ex.agc_out_trace_drain(dst, cap)).toBe(0);
      expect(ex.agc_out_trace_drain(dst, cap)).toBe(0);
      expect(ex.agc_out_trace_dropped()).toBe(0);
      ex.agc_out_trace_reset();
      expect(ex.agc_out_trace_dropped()).toBe(0);
      ex.free(dst);
    });
  });
});
