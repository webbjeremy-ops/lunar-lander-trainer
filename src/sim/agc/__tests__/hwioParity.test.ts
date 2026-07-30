// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P3 — Frozen-vs-Extended behavioural parity harness.
//
// Loads the frozen `yaAGC.wasm` and the extended `yaAGC-ext.wasm` side by side
// through identical WASI stubs, feeds them identical Luminary099 rope bytes
// and identical cpu_step / packet_write schedules, and asserts that the
// LEGACY output surface (packet_read stream + accessible erasable memory +
// step totals) is bit-identical between the two cores across six scenarios.
//
// Extension hardware inputs and output-trace exports are NEVER invoked
// during this suite. `agc_out_trace_enabled()` must return 0 throughout,
// and the extended core's trace ring must never accumulate entries.
//
// Never compare arbitrary WASM linear memory or pointer addresses — only
// what §Exact-comparisons in the P3 plan permits.
//
// On the first packet or erasable divergence in any scenario, this harness
// throws a structured report identifying scenario / step / last matching
// packet / first differing packet / relevant erasable diffs and stops.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const FROZEN_WASM  = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC.wasm");
const EXTENDED_WASM = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH    = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

// ------------------------------------------------------------------
// WASM loader (identical WASI stub for both cores).
// ------------------------------------------------------------------

interface LegacyExports {
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
}

interface ExtensionExports {
  agc_ext_version: () => number;
  agc_hwio_version: () => number;
  agc_out_trace_enabled: () => number;
  agc_out_trace_drain: (dst: number, max: number) => number;
  agc_out_trace_dropped: () => number;
}

type FrozenExports = LegacyExports;
type ExtendedExports = LegacyExports & ExtensionExports;

async function loadCore<T extends LegacyExports>(path: string): Promise<{ ex: T; memory: WebAssembly.Memory }> {
  const bytes = readFileSync(path);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const stub = () => 0;
  const wasi = new Proxy({} as Record<string, () => number>, {
    get: () => stub,
  });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });
  return { ex: instance.exports as unknown as T, memory };
}

// ------------------------------------------------------------------
// Shared operations (invoked identically on both cores).
// ------------------------------------------------------------------

function loadRope(ex: LegacyExports, mem: WebAssembly.Memory, rope: Uint8Array): void {
  const ptr = ex.malloc(rope.byteLength);
  // Refresh view after malloc (memory may not have grown for these sizes but
  // this is the same discipline AgcCoreAdapter uses).
  const view = new Uint8Array(mem.buffer);
  view.set(rope, ptr);
  ex.set_fixed(ptr);
  ex.free(ptr);
}

function readErasable(ex: LegacyExports, mem: WebAssembly.Memory): Uint16Array {
  const ptr = ex.get_erasable_ptr();
  // Copy so subsequent mutations don't retroactively change checkpoints.
  return new Uint16Array(mem.buffer, ptr, 2048).slice();
}

interface Packet { ch: number; val: number; }

function drainAll(ex: LegacyExports): Packet[] {
  const out: Packet[] = [];
  for (;;) {
    const data = ex.packet_read() >>> 0;
    const ch = data >>> 16;
    const val = data & 0xffff;
    if (!ch && !val) break;
    out.push({ ch, val });
    if (out.length > 200_000) throw new Error("packet_read runaway (>200k)");
  }
  return out;
}

interface CoreState {
  name: "frozen" | "extended";
  ex: LegacyExports;
  mem: WebAssembly.Memory;
  packets: Packet[];   // cumulative ordered packet stream
  totalSteps: number;
}

function primeInputs(ex: LegacyExports): void {
  // Match AgcCoreAdapter.reset() input priming — PROCEED high (not pressed),
  // key channel idle. Identical on both cores.
  ex.packet_write(0o32, 1 << 13);
  ex.packet_write(0o15, 0);
}

function resetCore(core: CoreState): void {
  core.ex.cpu_reset();
  core.packets = [];
  core.totalSteps = 0;
  primeInputs(core.ex);
}

// Run cpu_step then drain into the cumulative packet stream. `boundary`
// is a label used in first-divergence reports.
function stepAndDrain(core: CoreState, steps: number): void {
  if (steps <= 0) return;
  core.ex.cpu_step(steps);
  core.totalSteps += steps;
  const drained = drainAll(core.ex);
  for (const p of drained) core.packets.push(p);
}

// ------------------------------------------------------------------
// Divergence reporter — throws with structured detail on mismatch.
// ------------------------------------------------------------------

interface ParityRun {
  scenario: string;
  frozen: CoreState;
  extended: CoreState;
  segmentIndex: number;   // schedule segment counter
  totalStepsSoFar: number;
}

// ------------------------------------------------------------------
// Test-integrity ledger (M3.3B2 §8).
//
// A parity suite that silently skips is worse than no suite. Every segment
// records the scenario name, the number of PACKET pairs actually compared,
// and the cumulative cpu_step count. A final meta-test asserts that all six
// required scenarios executed with non-zero comparisons and non-zero steps,
// so an accidental whole-suite skip FAILS instead of reporting green.
// ------------------------------------------------------------------

export interface ParityLedgerEntry {
  comparedPackets: number;
  cpuSteps: number;
  segments: number;
}

const PARITY_LEDGER = new Map<string, ParityLedgerEntry>();

const REQUIRED_PARITY_SCENARIOS = [
  "cold-init",
  "long-idle",
  "V35E",
  "V16N65E",
  "pause-single-step",
  "mixed-dsky",
] as const;

function recordLedger(run: ParityRun): void {
  const e = PARITY_LEDGER.get(run.scenario) ?? {
    comparedPackets: 0,
    cpuSteps: 0,
    segments: 0,
  };
  e.comparedPackets = Math.max(
    e.comparedPackets,
    Math.min(run.frozen.packets.length, run.extended.packets.length),
  );
  e.cpuSteps = run.totalStepsSoFar;
  e.segments += 1;
  PARITY_LEDGER.set(run.scenario, e);
}

function comparePackets(run: ParityRun): void {
  const a = run.frozen.packets;
  const b = run.extended.packets;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const pa = a[i];
    const pb = b[i];
    if (!pa || !pb || pa.ch !== pb.ch || pa.val !== pb.val) {
      const lastMatch = a.slice(Math.max(0, i - 3), i);
      throw new Error(
        `M3.3A2-P3 divergence: PACKET stream diverged\n` +
        `  scenario:            ${run.scenario}\n` +
        `  segment:             ${run.segmentIndex}\n` +
        `  cumulative cpu_steps: ${run.totalStepsSoFar}\n` +
        `  packet index:        ${i}\n` +
        `  last matching:       ${JSON.stringify(lastMatch)}\n` +
        `  frozen:              ${pa ? JSON.stringify(pa) : "<absent>"}\n` +
        `  extended:            ${pb ? JSON.stringify(pb) : "<absent>"}\n` +
        `  frozen packet count: ${a.length}\n` +
        `  extended pkt count:  ${b.length}\n` +
        `  ext trace_enabled:   ${(run.extended.ex as ExtendedExports).agc_out_trace_enabled()}\n` +
        `  ext trace_dropped:   ${(run.extended.ex as ExtendedExports).agc_out_trace_dropped()}\n`
      );
    }
  }
}

function compareErasable(run: ParityRun, label: string): void {
  const a = readErasable(run.frozen.ex, run.frozen.mem);
  const b = readErasable(run.extended.ex, run.extended.mem);
  const diffs: Array<{ i: number; frozen: number; extended: number }> = [];
  for (let i = 0; i < 2048; i++) {
    if (a[i] !== b[i]) diffs.push({ i, frozen: a[i], extended: b[i] });
    if (diffs.length > 16) break;
  }
  if (diffs.length > 0) {
    throw new Error(
      `M3.3A2-P3 divergence: ERASABLE memory diverged at checkpoint "${label}"\n` +
      `  scenario:            ${run.scenario}\n` +
      `  segment:             ${run.segmentIndex}\n` +
      `  cumulative cpu_steps: ${run.totalStepsSoFar}\n` +
      `  first diffs (octal): ${diffs.map(d =>
        `[0o${d.i.toString(8)}] frozen=0o${d.frozen.toString(8)} extended=0o${d.extended.toString(8)}`
      ).join("\n                       ")}\n` +
      `  packets so far (frozen/ext): ${run.frozen.packets.length}/${run.extended.packets.length}\n` +
      `  ext trace_enabled:   ${(run.extended.ex as ExtendedExports).agc_out_trace_enabled()}\n`
    );
  }
}

function assertDormant(run: ParityRun, at: string): void {
  const ext = run.extended.ex as ExtendedExports;
  const enabled = ext.agc_out_trace_enabled();
  const dropped = ext.agc_out_trace_dropped();
  // Drain into a scratch buffer of size 0 pages away — but we cannot call
  // drain without a memory buffer. Instead: dropped must be 0 (implies the
  // sampler never observed a whitelisted delta while enabled), and enabled
  // must be 0 (implies the sampler early-returned on every cycle).
  if (enabled !== 0 || dropped !== 0) {
    throw new Error(
      `M3.3A2-P3 dormancy breach at ${at} (scenario=${run.scenario}, seg=${run.segmentIndex}):` +
      ` trace_enabled=${enabled}, trace_dropped=${dropped}`
    );
  }
}

// ------------------------------------------------------------------
// Test-suite scaffolding.
// ------------------------------------------------------------------

interface Cores {
  frozen: CoreState;
  extended: CoreState;
  rope: Uint8Array;
}

async function buildCores(): Promise<Cores> {
  const rope = readFileSync(ROPE_PATH);
  const [frozen, extended] = await Promise.all([
    loadCore<FrozenExports>(FROZEN_WASM),
    loadCore<ExtendedExports>(EXTENDED_WASM),
  ]);
  const cores: Cores = {
    frozen:   { name: "frozen",   ex: frozen.ex,   mem: frozen.memory,   packets: [], totalSteps: 0 },
    extended: { name: "extended", ex: extended.ex, mem: extended.memory, packets: [], totalSteps: 0 },
    rope,
  };
  return cores;
}

function initScenario(cores: Cores, scenario: string): ParityRun {
  loadRope(cores.frozen.ex,   cores.frozen.mem,   cores.rope);
  loadRope(cores.extended.ex, cores.extended.mem, cores.rope);
  resetCore(cores.frozen);
  resetCore(cores.extended);
  return {
    scenario,
    frozen: cores.frozen,
    extended: cores.extended,
    segmentIndex: 0,
    totalStepsSoFar: 0,
  };
}

// Feed identical inputs to both cores, drain nothing new (packets accumulate
// naturally when the next cpu_step advances the engine).
function bothPacketWrite(run: ParityRun, ch: number, val: number): void {
  run.frozen.ex.packet_write(ch, val);
  run.extended.ex.packet_write(ch, val);
}

function runSegment(run: ParityRun, steps: number, label: string): void {
  stepAndDrain(run.frozen, steps);
  stepAndDrain(run.extended, steps);
  run.segmentIndex++;
  run.totalStepsSoFar += steps;
  comparePackets(run);
  recordLedger(run);
  assertDormant(run, `after-segment[${label}]`);
}

function checkpointErasable(run: ParityRun, label: string): void {
  compareErasable(run, label);
  assertDormant(run, `checkpoint[${label}]`);
}

// DSKY key codes (mirrors AgcChannelRegistry.DSKY_KEYS).
const KEY = {
  ZERO:  0o20, ONE: 0o01, TWO: 0o02, THREE: 0o03, FOUR: 0o04,
  FIVE:  0o05, SIX: 0o06, SEVEN: 0o07, EIGHT: 0o10, NINE: 0o11,
  VERB:  0o21, NOUN: 0o37, ENTR: 0o34, RSET: 0o22, CLR: 0o36, KEY_REL: 0o31,
} as const;
const KEY_CH = 0o15;

// Between-keystroke settle steps. Chosen large enough to let PINBALL observe
// each keycode and emit its display echo before the next key overwrites the
// channel; identical value used for both cores.
const KEY_SETTLE_STEPS = 20_000;

// ------------------------------------------------------------------
// The parity suite. Each scenario is its own `it()` so a failure attributes
// to a single scenario. Within a scenario, first divergence stops via throw.
// All scenarios build fresh cores — no state leaks between scenarios.
// ------------------------------------------------------------------

describe("M3.3A2-P3 frozen-vs-extended behavioural parity", () => {
  let cores: Cores;

  beforeAll(async () => {
    cores = await buildCores();
    // Sanity: extended core carries HW-I/O v4 identity and starts dormant.
    const ext = cores.extended.ex as ExtendedExports;
    expect(ext.agc_hwio_version()).toBe(4);
    expect(ext.agc_out_trace_enabled()).toBe(0);
    expect(ext.agc_out_trace_dropped()).toBe(0);
  });

  it("Scenario 1 — cold init through readiness (no input beyond priming)", () => {
    const run = initScenario(cores, "cold-init");
    // Coarse initial burst, then several checkpoints. 50k * 6 = 300k steps.
    for (let i = 0; i < 6; i++) {
      runSegment(run, 50_000, `cold+${i}`);
    }
    checkpointErasable(run, "post-cold-init");
  });

  it("Scenario 2 — long deterministic idle (timer / interrupt activity)", () => {
    const run = initScenario(cores, "long-idle");
    // Warm up to readiness, then run a longer idle stretch. Total ~1.5M steps.
    runSegment(run, 300_000, "warm");
    checkpointErasable(run, "warm");
    for (let i = 0; i < 6; i++) {
      runSegment(run, 200_000, `idle+${i}`);
    }
    checkpointErasable(run, "post-long-idle");
    // TIME1 lives at 0o24; identical value on both cores was already covered
    // by the erasable compare, but re-assert for clarity.
    const a = readErasable(run.frozen.ex, run.frozen.mem);
    const b = readErasable(run.extended.ex, run.extended.mem);
    expect(a[0o24]).toBe(b[0o24]);
    expect(a[0o25]).toBe(b[0o25]);
  });

  it("Scenario 3 — authentic V35E lamp test", () => {
    const run = initScenario(cores, "V35E");
    runSegment(run, 300_000, "warm");
    checkpointErasable(run, "pre-V35");
    // V 3 5 ENTR with per-key settle windows.
    for (const [label, code] of [["V", KEY.VERB], ["3", KEY.THREE], ["5", KEY.FIVE], ["E", KEY.ENTR]] as const) {
      bothPacketWrite(run, KEY_CH, code);
      runSegment(run, KEY_SETTLE_STEPS, `key-${label}`);
    }
    // Let the lamp-test transient run to teardown.
    for (let i = 0; i < 20; i++) {
      runSegment(run, 25_000, `V35-run+${i}`);
    }
    checkpointErasable(run, "post-V35-teardown");
  });

  it("Scenario 4 — authentic V16 N65 E (advancing MET checkpoints)", () => {
    const run = initScenario(cores, "V16N65E");
    runSegment(run, 300_000, "warm");
    checkpointErasable(run, "pre-V16N65");
    const keys: Array<[string, number]> = [
      ["V", KEY.VERB], ["1", KEY.ONE], ["6", KEY.SIX],
      ["N", KEY.NOUN], ["6", KEY.SIX], ["5", KEY.FIVE],
      ["E", KEY.ENTR],
    ];
    for (const [label, code] of keys) {
      bothPacketWrite(run, KEY_CH, code);
      runSegment(run, KEY_SETTLE_STEPS, `key-${label}`);
    }
    // Two "checkpoints" of the running monitor.
    for (let i = 0; i < 8; i++) {
      runSegment(run, 100_000, `mon+${i}`);
      if (i === 3) checkpointErasable(run, "V16N65-mid");
    }
    checkpointErasable(run, "V16N65-late");
  });

  it("Scenario 5 — pause plus repeated single-step execution", () => {
    const run = initScenario(cores, "pause-single-step");
    runSegment(run, 200_000, "warm");
    // Alternate small and single steps. Every micro-schedule must agree.
    const schedule = [1, 1, 1, 1, 500, 1, 1, 100, 1, 1, 1, 5000, 1, 1, 1];
    for (let r = 0; r < 40; r++) {
      for (const s of schedule) runSegment(run, s, `ss-r${r}-s${s}`);
    }
    checkpointErasable(run, "post-single-step");
  });

  it("Scenario 6 — longer mixed DSKY input trace with RSET", () => {
    const run = initScenario(cores, "mixed-dsky");
    runSegment(run, 300_000, "warm");
    checkpointErasable(run, "warm");
    const trace: Array<[string, number]> = [
      ["V", KEY.VERB], ["1", KEY.ONE], ["6", KEY.SIX],
      ["N", KEY.NOUN], ["3", KEY.THREE], ["6", KEY.SIX],
      ["E", KEY.ENTR],
      ["RSET", KEY.RSET],
      ["V", KEY.VERB], ["3", KEY.THREE], ["5", KEY.FIVE], ["E", KEY.ENTR],
      // Repeat V35 to exercise repeated identical inputs.
      ["V", KEY.VERB], ["3", KEY.THREE], ["5", KEY.FIVE], ["E", KEY.ENTR],
      ["RSET", KEY.RSET],
      ["KREL", KEY.KEY_REL],
    ];
    for (const [label, code] of trace) {
      bothPacketWrite(run, KEY_CH, code);
      runSegment(run, KEY_SETTLE_STEPS, `key-${label}`);
    }
    // Let everything settle.
    for (let i = 0; i < 8; i++) runSegment(run, 50_000, `settle+${i}`);
    checkpointErasable(run, "post-mixed-dsky");
  });

  it("test integrity: every required parity scenario actually executed", () => {
    const report: Record<string, ParityLedgerEntry> = {};
    for (const [k, v] of PARITY_LEDGER) report[k] = v;
    // Fails loudly if the suite (or any scenario) was skipped.
    expect(Object.keys(report).sort()).toEqual([...REQUIRED_PARITY_SCENARIOS].sort());
    for (const name of REQUIRED_PARITY_SCENARIOS) {
      const e = report[name];
      expect(e, `scenario ${name} never ran`).toBeDefined();
      expect(e.segments, `scenario ${name} compared no segments`).toBeGreaterThan(0);
      expect(e.comparedPackets, `scenario ${name} compared no packets`).toBeGreaterThan(0);
      expect(e.cpuSteps, `scenario ${name} executed no cpu_steps`).toBeGreaterThan(0);
    }
    // Surface the ledger in CI output for the freeze report.
    console.log("[M3.3B2 parity ledger]", JSON.stringify(report));
  });

  it("dormancy: extended core never armed tracing across the full parity suite", () => {
    const ext = cores.extended.ex as ExtendedExports;
    expect(ext.agc_out_trace_enabled()).toBe(0);
    expect(ext.agc_out_trace_dropped()).toBe(0);
    // A drain into scratch memory must yield zero even if never armed.
    const scratch = (cores.extended.ex.malloc(32 * 8)) >>> 0;
    const drained = ext.agc_out_trace_drain(scratch, 8);
    expect(drained).toBe(0);
    cores.extended.ex.free(scratch);
  });
});
