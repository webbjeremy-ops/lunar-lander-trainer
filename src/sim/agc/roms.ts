// SPDX-License-Identifier: GPL-2.0-or-later
// Rope image manifest. Files live in public/agc/ and are served same-origin.
// SHA-256 hashes lock the exact rope build; a mismatch at runtime should be
// treated as a data-integrity failure by the Sources & Methodology page.

export const AGC_WASM_URL = "/agc/yaAGC.wasm";

export interface RopeImage {
  readonly id: "Luminary099" | "Comanche055";
  readonly url: string;
  readonly description: string;
  readonly sha256: string; // expected hex digest
}

export const ROPE_IMAGES: readonly RopeImage[] = [
  {
    id: "Luminary099",
    url: "/agc/rope/Luminary099.bin",
    description: "Apollo 11 Lunar Module (LM) flight software — LGC, Luminary Rev 099.",
    sha256: "1f5326e038de5b741b2f27b01ec949dbd688cf1906994e997402587c8628f40e",
  },
  {
    id: "Comanche055",
    url: "/agc/rope/Comanche055.bin",
    description: "Apollo 11 Command Module (CM) flight software — CMC, Comanche Rev 055.",
    sha256: "2ba31de9291cd10fb351a64d261bae8514a1cb75b4651bfa6a135dfa821a2d79",
  },
];

export function ropeById(id: RopeImage["id"]): RopeImage {
  const r = ROPE_IMAGES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rope image: ${id}`);
  return r;
}
