// SPDX-License-Identifier: GPL-2.0-or-later
// Rope image + WASM URL registry. All artifacts are served same-origin and
// constructed against Vite's BASE_URL so a subpath deployment (e.g. GitHub
// Pages) works without modification. The runtime never fetches these files
// from GitHub — the manifest for each rope lives beside the binary in
// public/ropes/ and is validated (byte length + SHA-256) inside the Worker
// before the emulator ever sees the bytes.
//
// M3.3A2-P4: `agcWasmUrl()` returns the canonical extended artifact
// (`yaAGC-ext.wasm`). The frozen `yaAGC.wasm` is preserved as a byte-
// identity parity reference only — see `AgcRuntimeManifest.ts`.

function base(): string {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return b.endsWith("/") ? b : b + "/";
}

import { CANONICAL_AGC_RUNTIME } from "@/agc/AgcRuntimeManifest";

/** Canonical, same-origin WASM URL used by the Worker. Delegates to the
 *  canonical runtime descriptor. */
export function agcWasmUrl(): string {
  return CANONICAL_AGC_RUNTIME.wasmPath();
}
// Back-compat for M0 code paths that still import a constant.
export const AGC_WASM_URL = "/agc/yaAGC-ext.wasm";

export interface RopeImage {
  readonly id: "Luminary099" | "Comanche055";
  readonly url: string;
  readonly manifestUrl: string;
  readonly description: string;
  readonly sha256: string;
}

export function ropeImages(): readonly RopeImage[] {
  const b = base();
  return [
    {
      id: "Luminary099",
      url: `${b}ropes/Luminary099.bin`,
      manifestUrl: `${b}ropes/Luminary099.manifest.json`,
      description: "Apollo 11 Lunar Module (LM) flight software — LGC, Luminary Rev 099.",
      sha256: "1f5326e038de5b741b2f27b01ec949dbd688cf1906994e997402587c8628f40e",
    },
    {
      id: "Comanche055",
      // M0 layout retained; a manifest for Comanche055 will follow the same
      // pattern as Luminary099 when it is brought under M1's rope-loader.
      url: `${b}agc/rope/Comanche055.bin`,
      manifestUrl: `${b}agc/rope/Comanche055.bin`,
      description: "Apollo 11 Command Module (CM) flight software — CMC, Comanche Rev 055.",
      sha256: "2ba31de9291cd10fb351a64d261bae8514a1cb75b4651bfa6a135dfa821a2d79",
    },
  ];
}

// Stable snapshot for callers that just want the current list.
export const ROPE_IMAGES: readonly RopeImage[] = ropeImages();

export function ropeById(id: RopeImage["id"]): RopeImage {
  const r = ropeImages().find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rope image: ${id}`);
  return r;
}
