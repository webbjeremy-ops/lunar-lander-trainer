// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C §1 — SERVICER / PIPA-consumption reachability evidence.
//
// The independent REFSMMAT-consumption proof requires Luminary099 to READ the
// PIPA counters through its own SERVICER path (READACCS -> DELV -> REFSMMAT ->
// DELVREF). This test records, as executable evidence, that the path is NOT
// reachable from the states this milestone can legitimately create.
//
// PRIMARY SOURCE (pinned Luminary099 @911e5c0):
//   FLAGWORD_ASSIGNMENTS.agc:809-810  AVEGFLAG = 115D, AVEGFBIT = BIT5
//                                     "AVERAGEG (SERVICER) DESIRED"
//   SERVICER.agc:53  "SET V37FLAG AND AVEGFLAG (BITS 5 AND 6 ...)"
//   SERVICER.agc:77-83 READACCS is entered only as a WAITLIST task inside the
//                      AVERAGEG loop; :109 BZF AVEGOUT leaves the loop the
//                      moment AVEGFLAG is down; :147 "END TASK WITHOUT
//                      CALLING READACCS".
//
// Consequence: with AVEGFLAG down (the state after a cold rope start in P00,
// with or without the pad-loaded IMU bootstrap), nothing in the rope ever
// reads or clears PIPAX/PIPAY/PIPAZ. Host-injected PINC/MINC pulses simply
// accumulate. Forcing AVEGFLAG, PIPTIME or a state vector by hand would be
// fabricated mission state and is prohibited by this milestone.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
  encodePadLoadRecords,
} from "@/simulation/agcio/padLoadManifest";
import {
  PIPAX_ADDRESS,
  PIPAY_ADDRESS,
  PIPAZ_ADDRESS,
} from "@/simulation/agcio/pipaEncoder";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const WASM_PATH = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");
const ROPE_PATH = resolve(REPO_ROOT, "public/ropes/Luminary099.bin");

/** PINC — hwio.c HWIO_INC_PINC. */
const PINC = 0;

interface Ext {
  malloc: (n: number) => number;
  free: (p: number) => void;
  set_fixed: (p: number) => void;
  cpu_reset: () => void;
  cpu_step: (n: number) => void;
  agc_pad_load_window_open: () => number;
  agc_pad_load_window_close: () => number;
  agc_erasable_pad_load_apply: (ptr: number, count: number) => number;
  agc_erasable_read_word: (address: number) => number;
  agc_counter_increment: (address: number, incType: number) => number;
}

async function bootWithBootstrap(): Promise<Ext> {
  if (!existsSync(ROPE_PATH)) throw new Error(`pinned rope missing at ${ROPE_PATH}`);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM_PATH), {
    env: { memory },
    wasi_snapshot_preview1: { fd_fdstat_get: () => 0, fd_seek: () => 0, fd_write: () => 0 },
  });
  const ex = instance.exports as unknown as Ext;
  const rope = new Uint8Array(readFileSync(ROPE_PATH));
  const ropePtr = ex.malloc(rope.length);
  new Uint8Array(memory.buffer, ropePtr, rope.length).set(rope);
  ex.set_fixed(ropePtr);
  ex.cpu_reset();

  const bytes = encodePadLoadRecords(MANIFEST.records);
  const ptr = ex.malloc(bytes.length);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  expect(ex.agc_pad_load_window_open()).toBe(0);
  expect(ex.agc_erasable_pad_load_apply(ptr, MANIFEST.records.length)).toBe(0);
  expect(ex.agc_pad_load_window_close()).toBe(0);
  ex.free(ptr);
  return ex;
}

describe("SERVICER / PIPA-consumption reachability (Luminary099 @911e5c0)", () => {
  it("does not read or clear the PIPA counters after the bootstrap (AVEGFLAG down)", async () => {
    const ex = await bootWithBootstrap();

    // Let the rope complete its own fresh-start initialisation, normally.
    ex.cpu_step(2_000_000);

    // Asymmetric, host-injected PINC pulses through the native
    // UnprogrammedIncrement path — no direct erasable writes.
    for (let i = 0; i < 7; i++) expect(ex.agc_counter_increment(PIPAX_ADDRESS, PINC)).toBe(0);
    for (let i = 0; i < 3; i++) expect(ex.agc_counter_increment(PIPAY_ADDRESS, PINC)).toBe(0);
    for (let i = 0; i < 5; i++) expect(ex.agc_counter_increment(PIPAZ_ADDRESS, PINC)).toBe(0);

    expect(ex.agc_erasable_read_word(PIPAX_ADDRESS)).toBe(7);

    // ~5 million further cycles of NORMAL execution. Nothing forced.
    for (let k = 0; k < 100; k++) ex.cpu_step(50_000);

    // SERVICER.agc:109/:147 — with AVEGFLAG down READACCS is never called, so
    // the counters are untouched. This is the open blocker for the
    // independent REFSMMAT-consumption proof, recorded as evidence.
    expect(ex.agc_erasable_read_word(PIPAX_ADDRESS)).toBe(7);
    expect(ex.agc_erasable_read_word(PIPAY_ADDRESS)).toBe(3);
    expect(ex.agc_erasable_read_word(PIPAZ_ADDRESS)).toBe(5);
  }, 300_000);
});
