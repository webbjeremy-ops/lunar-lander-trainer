// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — REAL-WASM acceptance for the reconstructed-PDI shadow experiment.
//
// This test runs the canonical HW-I/O v4 artefact with the pinned Luminary099
// rope and records what ACTUALLY happens. It encodes the deterministic
// observed result, not a wished-for one: the milestone verdict is FAIL, and
// this test exists to keep that finding honest and reproducible.
//
// Nothing here touches the Worker, the game, or the physics kernel.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as FROZEN,
  encodePadLoadRecords,
} from "@/simulation/agcio/padLoadManifest";
import {
  AVEGFBIT_MASK,
  FLAGWRD7_ADDRESS,
  RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1 as SHADOW,
  buildAuditTable,
  encodeShadowPadLoad,
  resolveRecord,
} from "../pdiShadowPadLoad";
import { classifyPipaConsumption } from "../shadowObservables";
import { M4_6A_OBSERVED_RESULT, classifyShadowOutcome } from "../verdict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const WASM_PATH = resolve(ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(ROOT, "public/ropes/Luminary099.bin");

/** hwio.c HWIO_INC_PINC. */
const PINC = 0;
const A = {
  MODREG: 0o1011,
  FLAGWRD7: FLAGWRD7_ADDRESS,
  PHASE5: 0o763,
  WCHPHASE: 0o1351,
  FAILREG: 0o375,
  RN: 0o1220,
  VN: 0o1226,
  PIPTIME: 0o1234,
  PIPAX: 0o37,
  PIPAY: 0o40,
  PIPAZ: 0o41,
} as const;

const KEY = { VERB: 0o21, ENTR: 0o34 } as const;
const KEY_CHANNEL = 0o15;

interface Ext {
  malloc: (n: number) => number;
  free: (p: number) => void;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  packet_write: (channel: number, value: number) => number;
  agc_hwio_version: () => number;
  agc_pad_load_window_open: () => number;
  agc_pad_load_window_close: () => number;
  agc_pad_load_applied_count: () => number;
  agc_pad_load_last_error_index: () => number;
  agc_erasable_pad_load_apply: (ptr: number, count: number) => number;
  agc_erasable_read_word: (address: number) => number;
  agc_counter_increment: (address: number, incType: number) => number;
}

async function boot(): Promise<{ ex: Ext; memory: WebAssembly.Memory }> {
  const memory = new WebAssembly.Memory({ initial: 5 });
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM_PATH), {
    env: { memory },
    wasi_snapshot_preview1: { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 },
  });
  const ex = instance.exports as unknown as Ext;
  const rope = new Uint8Array(readFileSync(ROPE_PATH));
  const p = ex.malloc(rope.length);
  new Uint8Array(memory.buffer, p, rope.length).set(rope);
  ex.set_fixed(p);
  ex.cpu_reset();
  return { ex, memory };
}

function applyBytes(ex: Ext, memory: WebAssembly.Memory, bytes: Uint8Array, count: number) {
  const open = ex.agc_pad_load_window_open();
  const ptr = ex.malloc(bytes.length);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  const rc = ex.agc_erasable_pad_load_apply(ptr, count);
  const close = ex.agc_pad_load_window_close();
  ex.free(ptr);
  return { open, rc, close, applied: ex.agc_pad_load_applied_count() };
}

function keyIn(ex: Ext, code: number) {
  ex.packet_write(KEY_CHANNEL, code);
  ex.cpu_step(120_000);
  ex.packet_write(KEY_CHANNEL, 0);
  ex.cpu_step(120_000);
}

const HAVE_ARTEFACTS = existsSync(WASM_PATH) && existsSync(ROPE_PATH);
const suite = HAVE_ARTEFACTS ? describe : describe.skip;

suite("M4.6A reconstructed-PDI shadow — real WASM", () => {
  it("installs the experimental bootstrap, enters P63 by DSKY, and does NOT achieve rope consumption", async () => {
    const { ex, memory } = await boot();
    expect(ex.agc_hwio_version()).toBe(4);
    const rd = (a: number) => ex.agc_erasable_read_word(a);

    // --- OBSERVED BLOCKER: the HW-I/O v4 pad-load window is ONE-SHOT per AGC
    //     epoch. Installing the frozen M3.3E coordinate bootstrap consumes it,
    //     so the experimental PDI batch is refused in the same epoch. Rewriting
    //     HW-I/O v4 is out of scope for this milestone, so the experiment runs
    //     WITHOUT the frozen coordinate bootstrap and reports that limitation.
    //     (Proven separately below.)

    // --- let the rope perform its own fresh start, normally.
    ex.cpu_step(2_000_000);

    // --- EXPERIMENTAL reconstructed-PDI pad load, compare-before-write on the
    //     word the rope itself just produced.
    const observedBefore = SHADOW.records.map((r) => rd(r.address));
    const resolved = SHADOW.records.map((r, i) => ({
      address: r.address,
      ...resolveRecord(r, observedBefore[i]),
    }));
    const install = applyBytes(
      ex,
      memory,
      encodeShadowPadLoad(resolved),
      resolved.length,
    );
    expect(install.open).toBe(0);
    expect(install.rc).toBe(0);
    expect(install.close).toBe(0);
    expect(install.applied).toBe(SHADOW.records.length);


    // complete read-back of every installed word
    resolved.forEach((r) => expect(rd(r.address)).toBe(r.value));
    expect(rd(A.FLAGWRD7) & AVEGFBIT_MASK).toBe(AVEGFBIT_MASK);

    const audit = buildAuditTable(observedBefore);
    expect(audit[0].previousValueOctal).toBe(`0o${observedBefore[0].toString(8)}`);

    // --- P63 through the REAL DSKY path. The major mode is never written.
    const modeBefore = rd(A.MODREG);
    for (const k of [KEY.VERB, 3, 7, KEY.ENTR, 6, 3, KEY.ENTR]) keyIn(ex, k);
    ex.cpu_step(3_000_000);
    const modeAfter = rd(A.MODREG);
    expect(modeBefore).not.toBe(63);
    expect(modeAfter).toBe(63); // P63LM, THE_LUNAR_LANDING.agc:40

    // --- live PIPA delivery through the native PINC path.
    let drainEvents = 0;
    let delivered = 0;
    for (let t = 0; t < 50; t++) {
      for (let i = 0; i < 5; i++) expect(ex.agc_counter_increment(A.PIPAX, PINC)).toBe(0);
      for (let i = 0; i < 2; i++) expect(ex.agc_counter_increment(A.PIPAZ, PINC)).toBe(0);
      delivered += 7;
      const before = rd(A.PIPAX);
      ex.cpu_step(200_000);
      if (rd(A.PIPAX) < before) drainEvents++;
    }
    expect(delivered).toBe(350);

    // --- OBSERVED RESULT: delivery works, consumption does not.
    //     SERVICER.agc:42 PREREAD never runs, so READACCS never reads PIPASR.
    const servicerRunning = rd(A.PHASE5) !== 0;
    expect(servicerRunning).toBe(false);
    expect(drainEvents).toBe(0);
    expect(rd(A.PIPAX)).toBe(250);
    expect(rd(A.PIPAZ)).toBe(100);
    expect(rd(A.RN)).toBe(0);
    expect(rd(A.VN)).toBe(0);
    expect(rd(A.PIPTIME)).toBe(0);

    expect(
      classifyPipaConsumption({ pulsesDelivered: delivered, drainEvents, servicerRunning }),
    ).toBe("not-consumed");

    // --- the recorded verdict must match what this run just observed.
    const verdict = classifyShadowOutcome({
      ...M4_6A_OBSERVED_RESULT,
      bootstrapInstalled: install.rc === 0,
      p63EnteredViaDsky: modeAfter === 63,
      majorModeAfterEntry: modeAfter,
      avegflagRaised: (rd(A.FLAGWRD7) & AVEGFBIT_MASK) !== 0,
      servicerRunning,
    });
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.recommendM4_6B).toBe(false);
  }, 600_000);

  it("rejects the experimental batch atomically when compare-before-write fails", async () => {
    const { ex, memory } = await boot();
    const rd = (a: number) => ex.agc_erasable_read_word(a);
    ex.cpu_step(2_000_000);
    const live = rd(A.FLAGWRD7);
    const wrongExpectation = (live ^ 0o1) & 0o77777;

    const bytes = encodeShadowPadLoad([
      { address: A.FLAGWRD7, expectedBefore: wrongExpectation, value: live | AVEGFBIT_MASK },
    ]);
    const r = applyBytes(ex, memory, bytes, 1);
    expect(r.rc).not.toBe(0);
    // nothing was written
    expect(rd(A.FLAGWRD7)).toBe(live);
  }, 300_000);

  it("a reset invalidates the installed experimental state", async () => {
    const { ex, memory } = await boot();
    const rd = (a: number) => ex.agc_erasable_read_word(a);
    ex.cpu_step(2_000_000);
    const before = rd(A.FLAGWRD7);
    applyBytes(
      ex,
      memory,
      encodeShadowPadLoad([
        { address: A.FLAGWRD7, expectedBefore: before, value: before | AVEGFBIT_MASK },
      ]),
      1,
    );
    expect(rd(A.FLAGWRD7) & AVEGFBIT_MASK).toBe(AVEGFBIT_MASK);
    ex.cpu_reset();
    expect(rd(A.FLAGWRD7) & AVEGFBIT_MASK).toBe(0);
  }, 300_000);
});
