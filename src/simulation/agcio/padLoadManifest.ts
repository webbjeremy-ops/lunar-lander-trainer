// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B — NON-FLIGHT SCENARIO PAD LOAD manifest.
//
// This module owns the exact, source-derived erasable words that represent
// mission operations completed BEFORE the simulated descent begins (the P52
// option-4 IMU fine alignment of Phase 4A). It is:
//
//   * NOT flight hardware,
//   * NOT an uplink simulation,
//   * NOT a sensor input,
//   * NOT a generic memory editor.
//
// Why not V71/V72 (P27) here: the authentic LM ground-uplink path is entered
// only in P00, accepts characters through INLINK/UPRUPT with triple-character
// redundancy and uplink-lockout handling, and mutates update-program state.
// That is a separate educational milestone; imitating it partially would be
// worse than declaring this boundary honestly. See
// docs/M3_3C_PAD_LOAD_AND_ACCEPTANCE.md §"Why not P27".
//
// The emulator holds NONE of these values: HW-I/O v4 accepts validated
// records only. The application owns the manifest.

import {
  FIXED_ATTITUDE_STATE_INITIALIZERS,
  LUMINARY099_FIXED_ATTITUDE_IMU_V1 as BOOT,
  REFSMMAT_ECADR,
  REFSMMAT_WORD_COUNT,
  CDUX_ADDRESS,
  CDUY_ADDRESS,
  CDUZ_ADDRESS,
  FLAGWRD3_ADDRESS,
  REFSMFLG_MASK,
  cduCountsToDegrees,
  degreesToCduCounts,
  isRightHandedOrthonormal,
  wordsToRefsmmat,
  xnbFromCduDegrees,
  type Matrix3,
  type SourceCitation,
} from "./imuBootstrap";

/** Erasable window the HW-I/O v4 pad load will accept (hwio.c
 *  `HWIO_PAD_MIN_ADDRESS` / `HWIO_PAD_MAX_ADDRESS`). */
export const PAD_LOAD_MIN_ADDRESS = 0o24;
export const PAD_LOAD_MAX_ADDRESS = 2047;
/** hwio.c `HWIO_PAD_MAX_RECORDS`. */
export const PAD_LOAD_MAX_RECORDS = 64;
/** `sizeof(AgcPadLoadRecord)` — three little-endian uint16 fields. */
export const PAD_LOAD_RECORD_BYTES = 6;

export type PadLoadCategory = "refsmmat" | "cdu-initial-state" | "coordinate-bootstrap";

export interface SourceMappedPadLoadRecord {
  readonly symbol: string;
  readonly addressOctal: string;
  readonly address: number;
  readonly expectedBefore: number;
  readonly value: number;
  readonly decodedMeaning: string;
  readonly scale: string;
  readonly category: PadLoadCategory;
  readonly citation: SourceCitation;
}

export interface AgcScenarioPadLoadManifestV1 {
  readonly id: "luminary099-fixed-attitude-descent-padload-v1";
  readonly kind: "NON-FLIGHT SCENARIO PAD LOAD";
  readonly ropeSha256: string;
  readonly runtimeSha256: string;
  /** Major mode the AGC must be in for the bootstrap to be legitimate. P00. */
  readonly requiredMajorMode: number;
  readonly records: readonly SourceMappedPadLoadRecord[];
  readonly citations: readonly SourceCitation[];
  readonly notes: readonly string[];
}

const ALLOWED_CATEGORIES: readonly PadLoadCategory[] = [
  "refsmmat",
  "cdu-initial-state",
  "coordinate-bootstrap",
];

const oct = (n: number) => `0o${n.toString(8)}`;

/**
 * Build the record list from the Phase 4A bootstrap. Every word is derived,
 * never typed twice: the REFSMMAT words come from the proven encoder, the CDU
 * words from the declared attitude, the flag word from FLAGWORD_ASSIGNMENTS.
 *
 * `expectedBefore` is 0 for every record because the pad load may only run on
 * a freshly reset AGC, where erasable memory is zeroed and no CPU step has
 * executed. The v4 API compares before writing, so a violated assumption
 * rejects the whole batch instead of silently overwriting rope state.
 */
function buildRecords(): readonly SourceMappedPadLoadRecord[] {
  const out: SourceMappedPadLoadRecord[] = [];
  for (const w of BOOT.refsmmatWords) {
    out.push({
      symbol: w.symbol,
      addressOctal: oct(w.address),
      address: w.address,
      expectedBefore: 0,
      value: w.rawWord,
      decodedMeaning: w.decodedValue,
      scale: w.scale,
      category: "refsmmat",
      citation: { claim: w.priorStateReason, source: w.sourceCitation },
    });
  }
  for (const i of FIXED_ATTITUDE_STATE_INITIALIZERS) {
    const category: PadLoadCategory =
      i.address === FLAGWRD3_ADDRESS ? "coordinate-bootstrap" : "cdu-initial-state";
    out.push({
      symbol: i.symbol,
      addressOctal: oct(i.address),
      address: i.address,
      expectedBefore: 0,
      value: i.rawWord,
      decodedMeaning: i.decodedValue,
      scale: i.scale,
      category,
      citation: { claim: i.priorStateReason, source: i.sourceCitation },
    });
  }
  return out;
}

/** SHA-256 of the pinned Luminary099 rope (public/ropes/Luminary099.manifest.json). */
export const REQUIRED_ROPE_SHA256 =
  "1b7fcf7b0eb02a94e0d97b3aeb4b1bb9c3e2d4e9c1c3e4bb92a2a63c1f2e0f19";

export const LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1: AgcScenarioPadLoadManifestV1 = {
  id: "luminary099-fixed-attitude-descent-padload-v1",
  kind: "NON-FLIGHT SCENARIO PAD LOAD",
  ropeSha256: "", // filled by the Worker from the loaded rope provenance
  runtimeSha256: "", // filled by the Worker from the canonical runtime manifest
  requiredMajorMode: 0,
  records: buildRecords(),
  citations: BOOT.citations,
  notes: [
    "NON-FLIGHT SCENARIO PAD LOAD. Represents state established before scenario start.",
    "Not an uplink. Authentic P27 V71/V72 ground-uplink simulation is deferred to a separate educational milestone and must use INLINK/UPRUPT.",
    "Installed only on a freshly reset AGC, once per AGC epoch, through the HW-I/O v4 window.",
  ],
};

export interface PadLoadManifestError {
  readonly kind: string;
  readonly detail: string;
  readonly index?: number;
}

/**
 * Pure structural + semantic validation of a manifest. Rejects anything that
 * is not the proven coordinate bootstrap: foreign erasables, duplicates,
 * out-of-window addresses, illegal words, wrong categories, and any REFSMMAT
 * / CDU inconsistency (transpose, mirror, wrong scale, corrupt bit).
 */
export function validatePadLoadManifest(
  manifest: AgcScenarioPadLoadManifestV1 = LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1,
): readonly PadLoadManifestError[] {
  const errors: PadLoadManifestError[] = [];
  const { records } = manifest;

  if (records.length === 0 || records.length > PAD_LOAD_MAX_RECORDS) {
    errors.push({ kind: "record-count", detail: `illegal record count ${records.length}` });
  }

  const seen = new Set<number>();
  records.forEach((r, index) => {
    if (!Number.isInteger(r.address) || r.address < PAD_LOAD_MIN_ADDRESS ||
        r.address > PAD_LOAD_MAX_ADDRESS) {
      errors.push({ kind: "address-out-of-window", detail: r.symbol, index });
    }
    if (seen.has(r.address)) {
      errors.push({ kind: "duplicate-address", detail: r.addressOctal, index });
    }
    seen.add(r.address);
    if (oct(r.address) !== r.addressOctal) {
      errors.push({ kind: "octal-mismatch", detail: r.addressOctal, index });
    }
    for (const w of [r.value, r.expectedBefore]) {
      if (!Number.isInteger(w) || w < 0 || w > 0o77777) {
        errors.push({ kind: "illegal-word", detail: `${r.symbol}=${w}`, index });
      }
    }
    if (!ALLOWED_CATEGORIES.includes(r.category)) {
      errors.push({ kind: "illegal-category", detail: r.category, index });
    }
    if (r.citation.source.length === 0 || r.citation.claim.length === 0) {
      errors.push({ kind: "missing-citation", detail: r.symbol, index });
    }
  });

  // --- The address set must be EXACTLY the coordinate bootstrap. No strays.
  const expected = new Set<number>([
    ...Array.from({ length: REFSMMAT_WORD_COUNT }, (_, i) => REFSMMAT_ECADR + i),
    CDUX_ADDRESS,
    CDUY_ADDRESS,
    CDUZ_ADDRESS,
    FLAGWRD3_ADDRESS,
  ]);
  for (const a of seen) {
    if (!expected.has(a)) {
      errors.push({ kind: "unrelated-erasable", detail: oct(a) });
    }
  }
  for (const a of expected) {
    if (!seen.has(a)) errors.push({ kind: "missing-erasable", detail: oct(a) });
  }

  // --- The REFSMMAT words must decode back to a right-handed orthonormal
  //     matrix identical to the declared bootstrap matrix.
  const matrixWords: number[] = [];
  for (let i = 0; i < REFSMMAT_WORD_COUNT; i++) {
    const rec = records.find((r) => r.address === REFSMMAT_ECADR + i);
    matrixWords.push(rec ? rec.value : Number.NaN);
  }
  if (matrixWords.every((w) => Number.isInteger(w))) {
    let decoded: Matrix3 | null = null;
    try {
      decoded = wordsToRefsmmat(matrixWords);
    } catch (e) {
      errors.push({ kind: "refsmmat-decode", detail: String(e) });
    }
    if (decoded) {
      if (!isRightHandedOrthonormal(decoded, 1e-6)) {
        errors.push({ kind: "refsmmat-not-right-handed-orthonormal", detail: decoded.join(",") });
      }
      for (let i = 0; i < 9; i++) {
        if (Math.abs(decoded[i] - BOOT.refsmmat[i]) > 1e-6) {
          errors.push({
            kind: "refsmmat-disagrees-with-bootstrap",
            detail: `element ${i}: ${decoded[i]} != ${BOOT.refsmmat[i]}`,
          });
        }
      }
    }
  }

  // --- The CDU words must decode to the attitude the bootstrap declares.
  const cdu = {
    x: records.find((r) => r.address === CDUX_ADDRESS)?.value,
    y: records.find((r) => r.address === CDUY_ADDRESS)?.value,
    z: records.find((r) => r.address === CDUZ_ADDRESS)?.value,
  };
  if (cdu.x !== undefined && cdu.y !== undefined && cdu.z !== undefined) {
    if (cdu.x !== BOOT.initialCduCounts.x || cdu.y !== BOOT.initialCduCounts.y ||
        cdu.z !== BOOT.initialCduCounts.z) {
      errors.push({ kind: "cdu-disagrees-with-bootstrap", detail: JSON.stringify(cdu) });
    }
    const xnb = xnbFromCduDegrees(
      cduCountsToDegrees(cdu.x),
      cduCountsToDegrees(cdu.y),
      cduCountsToDegrees(cdu.z),
    );
    for (let i = 0; i < 9; i++) {
      if (Math.abs(xnb[i] - BOOT.bodyToStableMember[i]) > 1e-9) {
        errors.push({ kind: "cdu-disagrees-with-body-matrix", detail: `element ${i}` });
      }
    }
  }

  // --- REFSMFLG must be set, and only that bit.
  const flag = records.find((r) => r.address === FLAGWRD3_ADDRESS);
  if (flag && flag.value !== REFSMFLG_MASK) {
    errors.push({ kind: "refsmflg-word", detail: oct(flag.value) });
  }

  return errors;
}

/**
 * Serialise a validated manifest to the little-endian `AgcPadLoadRecord[]`
 * byte layout the v4 ABI consumes. Caller order is preserved exactly.
 */
export function encodePadLoadRecords(
  records: readonly SourceMappedPadLoadRecord[],
): Uint8Array {
  const buf = new Uint8Array(records.length * PAD_LOAD_RECORD_BYTES);
  const dv = new DataView(buf.buffer);
  records.forEach((r, i) => {
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES, r.address, true);
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES + 2, r.expectedBefore, true);
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES + 4, r.value, true);
  });
  return buf;
}

/** Convenience for tests and diagnostics: a CDU-count helper re-export. */
export { degreesToCduCounts };
