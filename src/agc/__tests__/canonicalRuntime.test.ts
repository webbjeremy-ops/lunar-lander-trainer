// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P4 — Canonical runtime descriptor coherence.
//
// The single source of truth in `AgcRuntimeManifest.ts` must agree with the
// artifact actually shipped at `src/third-party/webagc/yaAGC-ext.wasm` (the
// same bytes copied into `public/agc/`). If any of these drift, production
// would silently boot against a mismatched WASM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CANONICAL_AGC_RUNTIME,
  FROZEN_AGC_WASM_SHA256,
  frozenAgcWasmUrl,
} from "../AgcRuntimeManifest";
import { agcWasmUrl, AGC_WASM_URL } from "@/sim/agc/roms";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("M3.3A2-P4 canonical AGC runtime descriptor", () => {
  it("descriptor points at the extended artifact and matches its SHA-256", () => {
    const bytes = readFileSync(resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm"));
    expect(sha256(new Uint8Array(bytes))).toBe(CANONICAL_AGC_RUNTIME.sha256);
    const publicBytes = readFileSync(resolve(REPO_ROOT, "public/agc/yaAGC-ext.wasm"));
    expect(sha256(new Uint8Array(publicBytes))).toBe(CANONICAL_AGC_RUNTIME.sha256);
  });

  it("frozen artifact SHA-256 constant is authoritative (parity reference only)", () => {
    const bytes = readFileSync(resolve(REPO_ROOT, "src/third-party/webagc/yaAGC.wasm"));
    expect(sha256(new Uint8Array(bytes))).toBe(FROZEN_AGC_WASM_SHA256);
  });

  it("production URL helpers resolve to the extended artifact, not the frozen one", () => {
    expect(agcWasmUrl()).toMatch(/yaAGC-ext\.wasm$/);
    expect(AGC_WASM_URL).toBe("/agc/yaAGC-ext.wasm");
    expect(frozenAgcWasmUrl()).toMatch(/yaAGC\.wasm$/);
    expect(frozenAgcWasmUrl()).not.toMatch(/yaAGC-ext\.wasm$/);
  });

  it("descriptor identity fields match the extended WASM's exports", async () => {
    const bytes = readFileSync(resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm"));
    const memory = new WebAssembly.Memory({ initial: 5 });
    const stub = () => 0;
    const wasi = new Proxy({} as Record<string, () => number>, { get: () => stub });
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { memory },
      wasi_snapshot_preview1: wasi,
    });
    const ex = instance.exports as unknown as {
      memory?: WebAssembly.Memory;
      version: () => number;
      agc_hwio_version: () => number;
      agc_ext_version: () => number;
      agc_out_trace_enabled: () => number;
      agc_out_trace_dropped: () => number;
    };
    const readC = (ptr: number) => {
      const view = new Uint8Array(memory.buffer, ptr);
      const nul = view.indexOf(0);
      return new TextDecoder().decode(view.subarray(0, nul >= 0 ? nul : 0));
    };
    expect(ex.agc_hwio_version()).toBe(CANONICAL_AGC_RUNTIME.hwioVersion);
    expect(readC(ex.agc_ext_version())).toBe(CANONICAL_AGC_RUNTIME.extVersion);
    expect(readC(ex.version())).toBe(CANONICAL_AGC_RUNTIME.upstreamVersion);
    // Dormancy at boot.
    expect(ex.agc_out_trace_enabled()).toBe(0);
    expect(ex.agc_out_trace_dropped()).toBe(0);
  });
});
