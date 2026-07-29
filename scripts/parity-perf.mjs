// M3.3A2-P3 performance observation: median run time of a fixed workload
// on frozen vs. extended cores. No behavioural assertions here — parity is
// enforced by the Vitest harness. This script only reports timing.
//
// Workload: cpu_reset + prime + 1,000,000 cpu_step (drained in 20 chunks).

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const FROZEN   = "src/third-party/webagc/yaAGC.wasm";
const EXTENDED = "src/third-party/webagc/yaAGC-ext.wasm";
const ROPE     = "public/ropes/Luminary099.bin";

const ROPE_BYTES = readFileSync(ROPE);

async function loadCore(path) {
  const bytes = readFileSync(path);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const stub = () => 0;
  const wasi = new Proxy({}, { get: () => stub });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });
  return { ex: instance.exports, memory };
}

function primeAndLoad(ex, mem) {
  const ptr = ex.malloc(ROPE_BYTES.byteLength);
  new Uint8Array(mem.buffer).set(ROPE_BYTES, ptr);
  ex.set_fixed(ptr);
  ex.free(ptr);
  ex.cpu_reset();
  ex.packet_write(0o32, 1 << 13);
  ex.packet_write(0o15, 0);
}

function drainAll(ex) {
  let n = 0;
  for (;;) { const d = ex.packet_read() >>> 0; if (!d) break; n++; if (n > 1e6) throw new Error("runaway"); }
  return n;
}

function runOnce(ex) {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) { ex.cpu_step(50_000); drainAll(ex); }
  return performance.now() - t0;
}

function median(xs) { const s = xs.slice().sort((a,b) => a-b); return s[Math.floor(s.length/2)]; }

const RUNS = 7;

for (const [label, path] of [["frozen", FROZEN], ["extended", EXTENDED]]) {
  const { ex, memory } = await loadCore(path);
  primeAndLoad(ex, memory);
  // warmup
  runOnce(ex);
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    // fresh reset between runs so workloads are identical
    ex.cpu_reset();
    ex.packet_write(0o32, 1 << 13);
    ex.packet_write(0o15, 0);
    times.push(runOnce(ex));
  }
  const heap = (memory.buffer.byteLength / 1024).toFixed(0);
  console.log(`${label.padEnd(9)} median=${median(times).toFixed(1)}ms  min=${Math.min(...times).toFixed(1)}ms  max=${Math.max(...times).toFixed(1)}ms  heap=${heap}KiB  runs=${JSON.stringify(times.map(t => +t.toFixed(1)))}`);
}
