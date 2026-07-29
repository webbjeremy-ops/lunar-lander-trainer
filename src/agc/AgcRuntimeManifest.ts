// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P4 — Canonical AGC runtime descriptor.
//
// A SINGLE source of truth for the WASM artifact the running application
// instantiates. Production code (Worker, session provider, DSKY, capture,
// diagnostics) MUST derive the WASM URL and expected identity from this
// descriptor. The frozen artifact is preserved solely as a byte-identity
// reference for the parity test harness and MUST NOT be selected by any
// production code path.
//
// See `docs/M3_3A2_P4_ACCEPTANCE.md` for the acceptance record.

function base(): string {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return b.endsWith("/") ? b : b + "/";
}

/** The identity the Worker's ABI-validation step must observe. */
export interface CanonicalAgcRuntime {
  /** Same-origin URL served out of `public/agc/`. */
  readonly wasmPath: () => string;
  /** SHA-256 of the extended artifact vendored at
   *  `src/third-party/webagc/yaAGC-ext.wasm` (byte-identical to the file
   *  copied into `public/agc/`). */
  readonly sha256: string;
  /** Upstream Virtual AGC (yaAGC) source commit — value returned by the
   *  WASM's `version()` export. */
  readonly upstreamVersion: string;
  /** Value returned by `agc_hwio_version()` — the extension ABI major. */
  readonly hwioVersion: number;
  /** Value returned by `agc_ext_version()` — combines upstream commit
   *  plus the browser-hardware-interface extension tag. */
  readonly extVersion: string;
  /** Human-readable extension provenance stamp. */
  readonly extensionTag: string;
}

export const CANONICAL_AGC_RUNTIME: CanonicalAgcRuntime = {
  wasmPath: () => `${base()}agc/yaAGC-ext.wasm`,
  sha256: "aec84b4736b2a8f80709d6a8c8ccceec51f1f3955144a9fad771118c9a21262e",
  upstreamVersion: "2020-12-24 ddc65e7be",
  hwioVersion: 2,
  extVersion: "ddc65e7be+apollo-browser-hwio-v2",
  extensionTag: "apollo-browser-hwio-v2",
} as const;

/** URL of the frozen historical artifact. Loaded ONLY by explicit parity
 *  tests (see `src/sim/agc/__tests__/hwioParity.test.ts`). Production code
 *  MUST NOT fetch this. */
export function frozenAgcWasmUrl(): string {
  return `${base()}agc/yaAGC.wasm`;
}

/** SHA-256 of the frozen historical artifact — reference only. */
export const FROZEN_AGC_WASM_SHA256 =
  "a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14";
