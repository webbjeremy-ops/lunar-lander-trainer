// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — EXPERIMENTAL reconstructed-PDI shadow pad load.
//
//   EXPERIMENTAL LUMINARY SHADOW MODE
//   RECONSTRUCTED PDI INITIALIZATION — NOT THE ORIGINAL APOLLO 11 INPUT DECK
//   REAL LUMINARY099 · REAL SIMULATED SENSOR INPUTS · NO AGC CONTROL OF PHYSICS
//
// This manifest is SEPARATE from, and never replaces, the frozen M3.3E
// fixed-attitude coordinate pad load. That manifest supplies REFSMMAT/CDU and
// is applied first, unchanged, on a freshly reset AGC. This one is applied
// afterwards, with the mission clock paused, in P00, through the same atomic
// HW-I/O v4 compare-before-write window.
//
// It contains ONLY words whose address, mask and meaning are source-derived
// from the pinned rope. Every value that could not be resolved is declared as
// UNRESOLVED in `reconstructedValues.ts` and is deliberately NOT installed.

import {
  PAD_LOAD_MAX_ADDRESS,
  PAD_LOAD_MAX_RECORDS,
  PAD_LOAD_MIN_ADDRESS,
  PAD_LOAD_RECORD_BYTES,
  REQUIRED_ROPE_SHA256,
} from "@/simulation/agcio/padLoadManifest";
import { CANONICAL_AGC_RUNTIME } from "@/agc/AgcRuntimeManifest";
import {
  RECONSTRUCTED_VALUES,
  reconstructedValueById,
  type ReconstructedClassification,
} from "./reconstructedValues";

export const PINNED_ROPE = "Luminary099 @911e5c0283c629c50cb97666f34065e8c07d71a5";

/** FLAGWRD7, ERASABLE_ASSIGNMENTS.agc. */
export const FLAGWRD7_ADDRESS = 0o103;
/** AVEGFBIT = BIT5, FLAGWORD_ASSIGNMENTS.agc:809-810. */
export const AVEGFBIT_MASK = 0o20;
/** MODREG — observed only, never written. */
export const MODREG_ADDRESS = 0o1011;

/**
 * `expectedBefore` may be a literal word, or the sentinel below when the
 * record is installed AFTER the rope's own fresh start has written the word.
 * In that case the installer captures the live value, records it in the audit
 * ledger, and passes it to the compare-before-write ABI. The host never skips
 * the comparison.
 */
export const OBSERVED_AT_INSTALL = "observed-at-install" as const;

export interface ShadowPadLoadRecord {
  readonly symbol: string;
  readonly address: number;
  readonly addressOctal: string;
  readonly expectedBefore: number | typeof OBSERVED_AT_INSTALL;
  /** Literal word, or a pure transform of the observed word. */
  readonly value: number | { readonly orMask: number };
  readonly assumptionId: string;
  readonly reconstructedValueId: string;
  readonly ropeCitation: string;
  readonly purpose: string;
  readonly confidence: ReconstructedClassification;
}

export interface ReconstructedPdiShadowPadLoadV1 {
  readonly id: "luminary099-reconstructed-pdi-shadow-padload-v1";
  readonly profileId: "reconstructed-pdi-shadow-v1";
  readonly kind: "EXPERIMENTAL RECONSTRUCTED PDI PAD LOAD";
  readonly ropeSha256: string;
  readonly runtimeSha256: string;
  /** P00. The experimental profile must be inactive and the clock paused. */
  readonly requiredMajorMode: number;
  readonly records: readonly ShadowPadLoadRecord[];
  readonly notes: readonly string[];
}

export const RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1: ReconstructedPdiShadowPadLoadV1 = {
  id: "luminary099-reconstructed-pdi-shadow-padload-v1",
  profileId: "reconstructed-pdi-shadow-v1",
  kind: "EXPERIMENTAL RECONSTRUCTED PDI PAD LOAD",
  ropeSha256: REQUIRED_ROPE_SHA256,
  runtimeSha256: CANONICAL_AGC_RUNTIME.sha256,
  requiredMajorMode: 0,
  records: [
    {
      symbol: "FLAGWRD7",
      address: FLAGWRD7_ADDRESS,
      addressOctal: "0o103",
      expectedBefore: OBSERVED_AT_INSTALL,
      value: { orMask: AVEGFBIT_MASK },
      assumptionId: "average-g-activation",
      reconstructedValueId: "flags.avegflag",
      ropeCitation:
        `${PINNED_ROPE} FLAGWORD_ASSIGNMENTS.agc:809-810 (AVEGFLAG = 115D, AVEGFBIT = BIT5); SERVICER.agc:53, :109`,
      purpose:
        "Raise AVEGFLAG so that, if READACCS is ever entered, SERVICER.agc:109 does not immediately branch to AVEGOUT.",
      confidence: "source-derived",
    },
  ],
  notes: [
    "EXPERIMENTAL LUMINARY SHADOW MODE.",
    "RECONSTRUCTED PDI INITIALIZATION — NOT THE ORIGINAL APOLLO 11 INPUT DECK.",
    "The frozen M3.3E fixed-attitude manifest is applied first and is NOT modified by this milestone.",
    "One record only: it is the sole word in the PDI category whose address, mask and meaning are fully source-derived from the pinned rope.",
    "Every other required PDI quantity is declared UNRESOLVED in reconstructedValues.ts rather than guessed.",
  ],
};

export interface ShadowPadLoadError {
  readonly kind: string;
  readonly detail: string;
  readonly index?: number;
}

/** Pure structural + semantic validation. Runs before any record is applied. */
export function validateShadowPadLoad(
  manifest: ReconstructedPdiShadowPadLoadV1 = RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1,
): readonly ShadowPadLoadError[] {
  const errors: ShadowPadLoadError[] = [];
  const { records } = manifest;

  if (records.length === 0 || records.length > PAD_LOAD_MAX_RECORDS) {
    errors.push({ kind: "record-count", detail: String(records.length) });
  }
  const seen = new Set<number>();
  records.forEach((r, index) => {
    if (
      !Number.isInteger(r.address) ||
      r.address < PAD_LOAD_MIN_ADDRESS ||
      r.address > PAD_LOAD_MAX_ADDRESS
    ) {
      errors.push({ kind: "address-out-of-window", detail: r.symbol, index });
    }
    if (seen.has(r.address)) {
      errors.push({ kind: "duplicate-address", detail: r.addressOctal, index });
    }
    seen.add(r.address);
    if (`0o${r.address.toString(8)}` !== r.addressOctal) {
      errors.push({ kind: "octal-mismatch", detail: r.addressOctal, index });
    }
    const words: number[] = [];
    if (typeof r.value === "number") words.push(r.value);
    else words.push(r.value.orMask);
    if (typeof r.expectedBefore === "number") words.push(r.expectedBefore);
    for (const w of words) {
      if (!Number.isInteger(w) || w < 0 || w > 0o77777) {
        errors.push({ kind: "illegal-word", detail: `${r.symbol}=${w}`, index });
      }
    }
    if (r.ropeCitation.length === 0 || r.purpose.length === 0) {
      errors.push({ kind: "missing-citation", detail: r.symbol, index });
    }
    if (!RECONSTRUCTED_VALUES.some((v) => v.id === r.reconstructedValueId)) {
      errors.push({ kind: "unregistered-value", detail: r.reconstructedValueId, index });
    } else if (reconstructedValueById(r.reconstructedValueId).assumptionId !== r.assumptionId) {
      errors.push({ kind: "assumption-mismatch", detail: r.symbol, index });
    }
    if (r.address === MODREG_ADDRESS) {
      errors.push({ kind: "major-mode-must-not-be-written", detail: r.symbol, index });
    }
  });
  if (manifest.requiredMajorMode !== 0) {
    errors.push({ kind: "required-major-mode", detail: String(manifest.requiredMajorMode) });
  }
  return errors;
}

/** Resolve a record against the observed pre-install word. Pure. */
export function resolveRecord(
  record: ShadowPadLoadRecord,
  observedBefore: number,
): { readonly expectedBefore: number; readonly value: number } {
  const expectedBefore =
    record.expectedBefore === OBSERVED_AT_INSTALL ? observedBefore : record.expectedBefore;
  const value =
    typeof record.value === "number" ? record.value : (observedBefore | record.value.orMask) & 0o77777;
  return { expectedBefore, value };
}

/** Serialise resolved records into the little-endian v4 record layout. */
export function encodeShadowPadLoad(
  resolved: readonly { readonly address: number; readonly expectedBefore: number; readonly value: number }[],
): Uint8Array {
  const buf = new Uint8Array(resolved.length * PAD_LOAD_RECORD_BYTES);
  const dv = new DataView(buf.buffer);
  resolved.forEach((r, i) => {
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES, r.address, true);
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES + 2, r.expectedBefore, true);
    dv.setUint16(i * PAD_LOAD_RECORD_BYTES + 4, r.value, true);
  });
  return buf;
}

export interface ShadowPadLoadAuditRow {
  readonly symbol: string;
  readonly addressOctal: string;
  readonly previousValueOctal: string;
  readonly installedValueOctal: string;
  readonly assumptionId: string;
  readonly ropeCitation: string;
  readonly purpose: string;
  readonly confidence: ReconstructedClassification;
}

/** The audit table required by the brief. Built from OBSERVED words only. */
export function buildAuditTable(
  observedBefore: readonly number[],
  manifest: ReconstructedPdiShadowPadLoadV1 = RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1,
): readonly ShadowPadLoadAuditRow[] {
  return manifest.records.map((r, i) => {
    const { expectedBefore, value } = resolveRecord(r, observedBefore[i] ?? 0);
    return {
      symbol: r.symbol,
      addressOctal: r.addressOctal,
      previousValueOctal: `0o${expectedBefore.toString(8)}`,
      installedValueOctal: `0o${value.toString(8)}`,
      assumptionId: r.assumptionId,
      ropeCitation: r.ropeCitation,
      purpose: r.purpose,
      confidence: r.confidence,
    };
  });
}
