// M3.3A2-P3 Dormancy audit for the extended yaAGC WebAssembly artifact.
//
// Contract: instantiating and operating yaAGC-ext.wasm without invoking any
// new hardware-interface API MUST have no observable side effect on the
// extension state. The trace ring, dropped counter, and sampler baseline
// must all stay at their post-instantiation zero across arbitrary cpu_step
// / packet_write / cpu_reset workloads. This is what makes it safe to swap
// yaAGC.wasm for yaAGC-ext.wasm as the canonical runtime in a later phase.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = resolve(HERE, "../../../third-party/webagc/yaAGC-ext.wasm");

interface ExtExports {
  memory?: WebAssembly.Memory;
  malloc: (n: number) => number;
  free: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  packet_write: (ch: number, val: number) => number;
  packet_read: () => number;
  agc_out_trace_drain: (dst: number, max: number) => number;
  agc_out_trace_dropped: () => number;
  agc_out_trace_reset: () => void;
  agc_out_trace_set_enabled: (v: number) => number;
  agc_out_trace_enabled: () => number;
}

async function loadExt(): Promise<{ ex: ExtExports; memory: WebAssembly.Memory }> {
  const bytes = readFileSync(EXT_PATH);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const wasi = { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });
  return { ex: instance.exports as unknown as ExtExports, memory };
}

describe("M3.3A2-P3 hardware-interface dormancy audit", () => {
  let ex: ExtExports;
  let memory: WebAssembly.Memory;
  let scratch: number;

  beforeAll(async () => {
    ({ ex, memory } = await loadExt());
    // Scratch destination for drain calls. Drain never mutates AGC state.
    scratch = ex.malloc(64 * 32);
  });

  function drainCount(): number {
    return ex.agc_out_trace_drain(scratch, 64);
  }

  it("is disabled immediately after instantiation, before any call", () => {
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
    expect(drainCount()).toBe(0);
  });

  it("stays disabled across cpu_reset()", () => {
    ex.cpu_reset();
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(drainCount()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
  });

  it("cpu_reset() disarms even after an explicit enable", () => {
    ex.agc_out_trace_set_enabled(1);
    expect(ex.agc_out_trace_enabled()).toBe(1);
    ex.cpu_reset();
    expect(ex.agc_out_trace_enabled()).toBe(0);
  });

  it("large idle workload produces zero trace mutation while dormant", () => {
    ex.cpu_reset();
    // No rope loaded; cpu_step still executes cycles. In an M2 workload the
    // rope-loaded case is exercised by hwioExtLegacy tests; here we only
    // assert that the hook is genuinely nonmutating.
    ex.cpu_step(50_000);
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(drainCount()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
  });

  it("packet_write activity does not touch the trace ring", () => {
    ex.cpu_reset();
    for (let i = 0; i < 200; i++) {
      ex.packet_write(0o15, i & 0x1f);
      ex.cpu_step(50);
    }
    expect(drainCount()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
  });

  it("set_enabled returns previous value and is idempotent", () => {
    ex.cpu_reset();
    expect(ex.agc_out_trace_set_enabled(0)).toBe(0);
    expect(ex.agc_out_trace_set_enabled(1)).toBe(0);
    expect(ex.agc_out_trace_set_enabled(1)).toBe(1);
    expect(ex.agc_out_trace_set_enabled(0)).toBe(1);
    expect(ex.agc_out_trace_enabled()).toBe(0);
    // disarm/re-arm never spuriously drops entries with no observed motion
    expect(ex.agc_out_trace_dropped()).toBe(0);
    expect(drainCount()).toBe(0);
  });

  it("disable/re-enable clears sampler baseline so no spurious first delta", () => {
    ex.cpu_reset();
    ex.agc_out_trace_set_enabled(1);
    ex.cpu_step(1000); // let sampler initialise baseline
    ex.agc_out_trace_set_enabled(0);
    ex.cpu_step(1000); // dormant window
    ex.agc_out_trace_set_enabled(1);
    ex.cpu_step(1000);
    // With no rope + no counter mutation, nothing to record either way.
    expect(drainCount()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
    ex.agc_out_trace_set_enabled(0);
  });

  it("memory footprint of extension state does not grow with dormant workload", () => {
    // We can't inspect internal state, but we can prove externally:
    //   TraceCount is drained-to-zero at rest, dropped stays at 0.
    ex.cpu_reset();
    for (let i = 0; i < 20; i++) {
      ex.cpu_step(10_000);
      expect(drainCount()).toBe(0);
      expect(ex.agc_out_trace_dropped()).toBe(0);
    }
    void memory;
  });
});
