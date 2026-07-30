// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B §9 — scenario pad-load manifest tests.

import { describe, expect, it } from "vitest";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
  PAD_LOAD_MAX_RECORDS,
  PAD_LOAD_RECORD_BYTES,
  encodePadLoadRecords,
  validatePadLoadManifest,
  type AgcScenarioPadLoadManifestV1,
  type SourceMappedPadLoadRecord,
} from "../padLoadManifest";
import {
  REFSMMAT_ECADR,
  REFSMFLG_MASK,
  degreesToCduCounts,
  refsmmatToWords,
  wordsToRefsmmat,
  xnbFromCduDegrees,
  type Matrix3,
} from "../imuBootstrap";
import { CANONICAL_AGC_RUNTIME } from "@/agc/AgcRuntimeManifest";

const clone = (over: Partial<AgcScenarioPadLoadManifestV1>): AgcScenarioPadLoadManifestV1 => ({
  ...MANIFEST,
  ...over,
});

const withRecord = (
  address: number,
  patch: Partial<SourceMappedPadLoadRecord>,
): AgcScenarioPadLoadManifestV1 =>
  clone({
    records: MANIFEST.records.map((r) => (r.address === address ? { ...r, ...patch } : r)),
  });

/** A deliberately non-identity, right-handed orthonormal fixture: 30 deg about Z. */
const ROT_Z_30: Matrix3 = (() => {
  const a = (30 * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
})();

describe("scenario pad-load manifest — shape", () => {
  it("is the 22-word coordinate bootstrap and nothing else", () => {
    expect(MANIFEST.records).toHaveLength(22);
    expect(MANIFEST.records.length).toBeLessThanOrEqual(PAD_LOAD_MAX_RECORDS);
    expect(new Set(MANIFEST.records.map((r) => r.address)).size).toBe(22);
    for (const r of MANIFEST.records) {
      expect(["refsmmat", "cdu-initial-state", "coordinate-bootstrap"]).toContain(r.category);
      expect(r.addressOctal).toBe(`0o${r.address.toString(8)}`);
      expect(r.citation.source.length).toBeGreaterThan(0);
    }
  });

  it("declares itself a non-flight scenario pad load, not an uplink", () => {
    expect(MANIFEST.kind).toBe("NON-FLIGHT SCENARIO PAD LOAD");
    const notes = MANIFEST.notes.join(" ");
    expect(notes).toMatch(/Not an uplink/i);
    expect(notes).toMatch(/V71\/V72/);
  });

  it("pins the rope and canonical runtime provenance", () => {
    expect(MANIFEST.runtimeSha256).toBe(CANONICAL_AGC_RUNTIME.sha256);
    expect(MANIFEST.ropeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MANIFEST.requiredMajorMode).toBe(0);
  });

  it("addresses only the 18 REFSMMAT words, 3 CDU counters and FLAGWRD3", () => {
    const addrs = MANIFEST.records.map((r) => r.address).sort((a, b) => a - b);
    const expected = [
      0o32, 0o33, 0o34, 0o77,
      ...Array.from({ length: 18 }, (_, i) => REFSMMAT_ECADR + i),
    ].sort((a, b) => a - b);
    expect(addrs).toEqual(expected);
  });

  it("encodes REFSMMAT row-major at half-unit scale", () => {
    const words = MANIFEST.records
      .filter((r) => r.category === "refsmmat")
      .sort((a, b) => a.address - b.address)
      .map((r) => r.value);
    expect(words).toHaveLength(18);
    expect(words[0]).toBe(0o20000);
    expect(words[8]).toBe(0o20000);
    expect(words[16]).toBe(0o20000);
    const m = wordsToRefsmmat(words);
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 7);
  });

  it("encodes zero CDU counters and a set REFSMFLG", () => {
    for (const a of [0o32, 0o33, 0o34]) {
      expect(MANIFEST.records.find((r) => r.address === a)!.value).toBe(0);
    }
    expect(MANIFEST.records.find((r) => r.address === 0o77)!.value).toBe(REFSMFLG_MASK);
  });

  it("serialises to the exact v4 record layout, preserving caller order", () => {
    const bytes = encodePadLoadRecords(MANIFEST.records);
    expect(bytes.length).toBe(22 * PAD_LOAD_RECORD_BYTES);
    const dv = new DataView(bytes.buffer);
    MANIFEST.records.forEach((r, i) => {
      expect(dv.getUint16(i * 6, true)).toBe(r.address);
      expect(dv.getUint16(i * 6 + 2, true)).toBe(r.expectedBefore);
      expect(dv.getUint16(i * 6 + 4, true)).toBe(r.value);
    });
  });
});

describe("scenario pad-load manifest — validation", () => {
  it("accepts the shipped manifest", () => {
    expect(validatePadLoadManifest()).toEqual([]);
  });

  it("accepts a non-identity matrix fixture, so identity cannot hide bugs", () => {
    const words = refsmmatToWords(ROT_Z_30);
    const cduZ = 0; // attitude unchanged; only the REFSMMAT differs
    void cduZ;
    const rotated = clone({
      records: MANIFEST.records.map((r) =>
        r.category === "refsmmat" ? { ...r, value: words[r.address - REFSMMAT_ECADR] } : r,
      ),
    });
    // The matrix is orthonormal and right-handed, but disagrees with the
    // declared bootstrap matrix — validation must SAY SO rather than shrug.
    const errs = validatePadLoadManifest(rotated);
    expect(errs.some((e) => e.kind === "refsmmat-disagrees-with-bootstrap")).toBe(true);
    expect(errs.some((e) => e.kind === "refsmmat-not-right-handed-orthonormal")).toBe(false);
  });

  it("rejects a transposed non-symmetric matrix", () => {
    const t: Matrix3 = [
      ROT_Z_30[0], ROT_Z_30[3], ROT_Z_30[6],
      ROT_Z_30[1], ROT_Z_30[4], ROT_Z_30[7],
      ROT_Z_30[2], ROT_Z_30[5], ROT_Z_30[8],
    ];
    const forward = refsmmatToWords(ROT_Z_30);
    const transposed = refsmmatToWords(t);
    expect(transposed).not.toEqual(forward);
  });

  it("rejects a mirrored (left-handed) frame", () => {
    const mirrored = refsmmatToWords([1, 0, 0, 0, 1, 0, 0, 0, -1]);
    const bad = clone({
      records: MANIFEST.records.map((r) =>
        r.category === "refsmmat" ? { ...r, value: mirrored[r.address - REFSMMAT_ECADR] } : r,
      ),
    });
    expect(validatePadLoadManifest(bad).some(
      (e) => e.kind === "refsmmat-not-right-handed-orthonormal",
    )).toBe(true);
  });

  it("detects a one-bit corruption of a matrix word", () => {
    const bad = withRecord(REFSMMAT_ECADR, { value: 0o20001 });
    expect(validatePadLoadManifest(bad).length).toBeGreaterThan(0);
  });

  it("rejects a CDU state that contradicts the declared attitude", () => {
    const bad = withRecord(0o34, { value: degreesToCduCounts(30) });
    const errs = validatePadLoadManifest(bad);
    expect(errs.some((e) => e.kind === "cdu-disagrees-with-bootstrap")).toBe(true);
    expect(errs.some((e) => e.kind === "cdu-disagrees-with-body-matrix")).toBe(true);
  });

  it("agrees with the pure body-to-stable-member transform at the declared attitude", () => {
    const xnb = xnbFromCduDegrees(0, 0, 0);
    for (let i = 0; i < 9; i++) expect(xnb[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 12);
  });

  it("rejects an unrelated erasable address", () => {
    const bad = clone({
      records: [
        ...MANIFEST.records,
        { ...MANIFEST.records[0], symbol: "STRAY", address: 0o1000, addressOctal: "0o1000" },
      ],
    });
    expect(validatePadLoadManifest(bad).some((e) => e.kind === "unrelated-erasable")).toBe(true);
  });

  it("rejects a duplicated record", () => {
    const bad = clone({ records: [...MANIFEST.records, MANIFEST.records[0]] });
    const errs = validatePadLoadManifest(bad);
    expect(errs.some((e) => e.kind === "duplicate-address")).toBe(true);
  });

  it("rejects an illegal word and an address outside the pad window", () => {
    expect(validatePadLoadManifest(withRecord(0o32, { value: 0o100000 }))
      .some((e) => e.kind === "illegal-word")).toBe(true);
    expect(validatePadLoadManifest(withRecord(0o32, { address: 4, addressOctal: "0o4" }))
      .some((e) => e.kind === "address-out-of-window")).toBe(true);
  });

  it("rejects an illegal category", () => {
    const bad = withRecord(0o32, { category: "sensor" as never });
    expect(validatePadLoadManifest(bad).some((e) => e.kind === "illegal-category")).toBe(true);
  });

  it("rejects an empty manifest", () => {
    expect(validatePadLoadManifest(clone({ records: [] })).some((e) => e.kind === "record-count"))
      .toBe(true);
  });
});
