// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4A acceptance tests for the fixed-attitude IMU bootstrap.
// These tests are the proof-carrying part of the bootstrap: they assert the
// storage convention, the scale, the transformation direction, the counter
// representation and the internal consistency of the whole chain.

import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_INSTALLATION_BLOCKER,
  CDU_COUNTS_PER_REVOLUTION,
  CDU_DEGREES_PER_COUNT,
  FIXED_ATTITUDE_STATE_INITIALIZERS,
  FLAGWRD3_ADDRESS,
  IDENTITY_MATRIX3,
  LUMINARY099_FIXED_ATTITUDE_IMU_V1 as BOOT,
  REFSMFLG_MASK,
  REFSMMAT_ECADR,
  REFSMMAT_WORD_COUNT,
  cduCountsToDegrees,
  decodeRefsmmatElement,
  degreesToCduCounts,
  determinant,
  encodeRefsmmatElement,
  isRightHandedOrthonormal,
  matVec,
  orthonormalityDefect,
  refsmmatToWords,
  stableMemberSpecificForceFromBody,
  transposeMatVec,
  validateFixedAttitudeBootstrap,
  wordsToRefsmmat,
  xnbFromCduDegrees,
  type Matrix3,
} from "../imuBootstrap";

// A deliberately asymmetric orthonormal matrix. Row-major vs column-major and
// forward vs transpose are distinguishable with this one; identity is not.
const ASYMMETRIC: Matrix3 = (() => {
  const a = (30 * Math.PI) / 180;
  const b = (50 * Math.PI) / 180;
  const rz: Matrix3 = [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const ry: Matrix3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const out: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out.push(rz[r * 3] * ry[c] + rz[r * 3 + 1] * ry[3 + c] + rz[r * 3 + 2] * ry[6 + c]);
  return out as unknown as Matrix3;
})();

describe("REFSMMAT fixed-point storage (B-1 half-unit, ones' complement DP)", () => {
  it("stores +1.0 as the half-unit word pair 0o20000 / 0", () => {
    expect(encodeRefsmmatElement(1)).toEqual({ hi: 0o20000, lo: 0 });
  });

  it("stores 0.0 as a positive zero word pair", () => {
    expect(encodeRefsmmatElement(0)).toEqual({ hi: 0, lo: 0 });
  });

  it("stores -1.0 as the ones' complement of +1.0", () => {
    const neg = encodeRefsmmatElement(-1);
    expect(neg.hi).toBe(0o57777);
    expect(neg.lo).toBe(0o77777);
  });

  it("keeps every word inside the 15-bit AGC word", () => {
    for (const v of [1, -1, 0, 0.5, -0.5, 0.7071067811865476, -0.3]) {
      const { hi, lo } = encodeRefsmmatElement(v);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(0o77777);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThanOrEqual(0o77777);
    }
  });

  it("round-trips to better than one part in 2^27", () => {
    for (const v of [1, -1, 0.5, -0.5, 0.123456, -0.987654, Math.SQRT1_2]) {
      expect(decodeRefsmmatElement(encodeRefsmmatElement(v))).toBeCloseTo(v, 7);
    }
  });

  it("rejects elements outside [-1, 1] rather than silently wrapping", () => {
    expect(() => encodeRefsmmatElement(1.5)).toThrow(RangeError);
    expect(() => encodeRefsmmatElement(Number.NaN)).toThrow(RangeError);
  });

  it("serialises 9 elements into exactly 18 words, row-major", () => {
    const words = refsmmatToWords(ASYMMETRIC);
    expect(words).toHaveLength(REFSMMAT_WORD_COUNT);
    // Word pair k must be element k of the ROW-MAJOR flattening.
    for (let i = 0; i < 9; i++) {
      expect(decodeRefsmmatElement({ hi: words[i * 2], lo: words[i * 2 + 1] })).toBeCloseTo(
        ASYMMETRIC[i],
        7,
      );
    }
  });

  it("round-trips a full asymmetric matrix", () => {
    const back = wordsToRefsmmat(refsmmatToWords(ASYMMETRIC));
    for (let i = 0; i < 9; i++) expect(back[i]).toBeCloseTo(ASYMMETRIC[i], 7);
  });

  it("rejects a word array of the wrong length", () => {
    expect(() => wordsToRefsmmat([1, 2, 3])).toThrow(RangeError);
  });
});

describe("REFSMMAT transformation direction (reference -> stable member)", () => {
  it("matVec (Luminary MXV) and transposeMatVec (VXM) are mutual inverses", () => {
    const v = [0.3, -0.6, 0.2] as const;
    const sm = matVec(ASYMMETRIC, v);
    const back = transposeMatVec(ASYMMETRIC, sm);
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i], 12);
  });

  it("MXV and VXM give different results for an asymmetric matrix, so direction is observable", () => {
    const v = [1, 0, 0] as const;
    expect(matVec(ASYMMETRIC, v)).not.toEqual(transposeMatVec(ASYMMETRIC, v));
  });
});

describe("CDU counter representation (15-bit two's complement, 180 deg full scale)", () => {
  it("uses 0.010986 deg per count", () => {
    expect(CDU_DEGREES_PER_COUNT).toBeCloseTo(180 / 16384, 12);
    expect(CDU_COUNTS_PER_REVOLUTION).toBe(32768);
  });

  it("decodes zero counts as zero degrees", () => {
    expect(cduCountsToDegrees(0)).toBe(0);
  });

  it("decodes 2^14 counts as +180 deg and the two's-complement half as negative", () => {
    expect(cduCountsToDegrees(0o40000)).toBeCloseTo(-180, 9);
    expect(cduCountsToDegrees(0o20000)).toBeCloseTo(90, 9);
    expect(cduCountsToDegrees(0o60000)).toBeCloseTo(-90, 9);
  });

  it("round-trips degrees through the counter word", () => {
    for (const deg of [0, 12.5, -45, 90, -179.9]) {
      expect(cduCountsToDegrees(degreesToCduCounts(deg))).toBeCloseTo(deg, 2);
    }
  });

  it("wraps a full revolution back to the same counter word", () => {
    expect(degreesToCduCounts(370)).toBe(degreesToCduCounts(10));
  });
});

describe("XNB (body -> stable member) from CDU angles", () => {
  it("is the identity at zero gimbal angles", () => {
    const m = xnbFromCduDegrees(0, 0, 0);
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(IDENTITY_MATRIX3[i], 12);
  });

  it("row 1 matches the literal FLESHPOT expression (cosY cosZ, sinZ, -sinY cosZ)", () => {
    const d = Math.PI / 180;
    for (const [x, y, z] of [
      [0, 0, 0],
      [10, 20, 30],
      [-35, 15, -70],
      [120, -40, 5],
    ]) {
      const m = xnbFromCduDegrees(x, y, z);
      expect(m[0]).toBeCloseTo(Math.cos(y * d) * Math.cos(z * d), 12);
      expect(m[1]).toBeCloseTo(Math.sin(z * d), 12);
      expect(m[2]).toBeCloseTo(-Math.sin(y * d) * Math.cos(z * d), 12);
    }
  });

  it("is right-handed orthonormal for arbitrary gimbal angles", () => {
    for (const [x, y, z] of [
      [10, 20, 30],
      [-35, 15, -70],
      [120, -40, 5],
      [179, 179, 89],
    ]) {
      const m = xnbFromCduDegrees(x, y, z);
      expect(orthonormalityDefect(m)).toBeLessThan(1e-12);
      expect(determinant(m)).toBeCloseTo(1, 12);
    }
  });
});

describe("the bootstrap itself", () => {
  it("declares an identity REFSMMAT as a COORDINATE CHOICE, with the reference frame defined", () => {
    expect(BOOT.refsmmat).toEqual(IDENTITY_MATRIX3);
    // The identity is only legitimate because the reference triad is defined.
    expect(BOOT.coordinateConvention.referenceFrame.xAxis).toMatch(/UNIT\(RLS\)/);
    expect(BOOT.coordinateConvention.referenceFrame.handedness).toBe("right");
    expect(BOOT.coordinateConvention.referenceFrame.sourceCitation).toMatch(/P51-P53\.agc/);
  });

  it("is a right-handed orthonormal chain end to end", () => {
    expect(isRightHandedOrthonormal(BOOT.refsmmat)).toBe(true);
    expect(isRightHandedOrthonormal(BOOT.bodyToStableMember)).toBe(true);
  });

  it("passes full validation with no errors", () => {
    expect(validateFixedAttitudeBootstrap()).toEqual([]);
  });

  it("places the 18 REFSMMAT words at consecutive addresses from 0o1733", () => {
    expect(REFSMMAT_ECADR).toBe(0o1733);
    expect(BOOT.refsmmatWords).toHaveLength(18);
    BOOT.refsmmatWords.forEach((w, i) => {
      expect(w.address).toBe(0o1733 + i);
      expect(w.applyOrder).toBe(i);
      expect(w.sourceCitation.length).toBeGreaterThan(0);
      expect(w.priorStateReason.length).toBeGreaterThan(0);
    });
  });

  it("encodes identity as diagonal 0o20000 half-unit words and zeros elsewhere", () => {
    const words = BOOT.refsmmatWords.map((w) => w.rawWord);
    expect(words[0]).toBe(0o20000); // M11 hi
    expect(words[1]).toBe(0);
    expect(words[8]).toBe(0o20000); // M22 hi (element 4 -> words 8,9)
    expect(words[16]).toBe(0o20000); // M33 hi (element 8 -> words 16,17)
    for (const i of [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15]) expect(words[i]).toBe(0);
  });

  it("installs zero CDU counters at 0o32/0o33/0o34 and sets REFSMFLG in FLAGWRD3", () => {
    const bySymbol = Object.fromEntries(
      FIXED_ATTITUDE_STATE_INITIALIZERS.map((i) => [i.symbol.split(" ")[0], i]),
    );
    expect(bySymbol.CDUX.address).toBe(0o32);
    expect(bySymbol.CDUY.address).toBe(0o33);
    expect(bySymbol.CDUZ.address).toBe(0o34);
    for (const s of ["CDUX", "CDUY", "CDUZ"]) expect(bySymbol[s].rawWord).toBe(0);
    expect(bySymbol.FLAGWRD3.address).toBe(FLAGWRD3_ADDRESS);
    expect(FLAGWRD3_ADDRESS).toBe(0o77); // STATE (0o74) + 3
    expect(bySymbol.FLAGWRD3.rawWord).toBe(REFSMFLG_MASK);
    expect(REFSMFLG_MASK).toBe(0o10000); // BIT13
  });

  it("continues the deterministic apply order after the matrix words", () => {
    const orders = FIXED_ATTITUDE_STATE_INITIALIZERS.map((i) => i.applyOrder);
    expect(orders).toEqual([18, 19, 20, 21]);
  });

  it("maps DPS thrust along body +X onto stable-member +X", () => {
    expect(BOOT.coordinateConvention.thrustAxisBody).toEqual([1, 0, 0]);
    expect(BOOT.stableMemberSpecificForceAxis).toEqual([1, 0, 0]);
    const sm = stableMemberSpecificForceFromBody([9.81, 0, 0]);
    expect(sm[0]).toBeCloseTo(9.81, 12);
    expect(sm[1]).toBeCloseTo(0, 12);
    expect(sm[2]).toBeCloseTo(0, 12);
  });

  it("rotates an off-axis body force correctly through a non-identity attitude", () => {
    const tilted = {
      ...BOOT,
      initialCduCounts: {
        x: 0,
        y: 0,
        z: degreesToCduCounts(90),
      },
      bodyToStableMember: xnbFromCduDegrees(0, 0, 90),
      stableMemberSpecificForceAxis: matVec(xnbFromCduDegrees(0, 0, 90), [1, 0, 0]),
    } as typeof BOOT;
    // Consistency must still hold for a genuinely rotated attitude.
    expect(validateFixedAttitudeBootstrap(tilted)).toEqual([]);
    const sm = stableMemberSpecificForceFromBody([1, 0, 0], tilted);
    expect(sm[0]).toBeCloseTo(0, 9);
    expect(sm[1]).toBeCloseTo(-1, 9); // row2 col1 = sinX sinY - cosX cosY sinZ = -1
  });

  it("carries the primary citations required to defend each promoted constant", () => {
    const joined = BOOT.citations.map((c) => `${c.claim} ${c.source}`).join("\n");
    for (const needle of [
      "P40-P47.agc",
      "INTERPRETER.agc",
      "ERASABLE_ASSIGNMENTS.agc",
      "P51-P53.agc",
      "POWERED_FLIGHT_SUBROUTINES.agc",
      "SERVICER.agc",
      "FLAGWORD_ASSIGNMENTS.agc",
      "THE_LUNAR_LANDING.agc",
    ]) {
      expect(joined).toContain(needle);
    }
  });

  it("labels itself a synthetic scenario alignment, not the flown Apollo 11 REFSMMAT", () => {
    const text = BOOT.limitations.join(" ");
    expect(text).toMatch(/SYNTHETIC SCENARIO/i);
    expect(text).toMatch(/NOT the historical Apollo 11/i);
    expect(text).toMatch(/fixed/i);
  });

  it("is still gated: no installation path exists into a live rope", () => {
    expect(BOOTSTRAP_INSTALLATION_BLOCKER).toBe("imu-bootstrap-installation-path-unresolved");
    expect(BOOT.requiredForProfiles).toContain("descent-monitor-v1");
    expect(BOOT.limitations.join(" ")).toMatch(/BOOTSTRAP_INSTALLATION_BLOCKER/);
  });
});

describe("validation rejects an inconsistent bootstrap", () => {
  it("catches CDU counts that disagree with the declared body matrix", () => {
    const bad = { ...BOOT, initialCduCounts: { x: 0, y: 0, z: degreesToCduCounts(30) } };
    const errors = validateFixedAttitudeBootstrap(bad as typeof BOOT);
    expect(errors.some((e) => e.kind === "cdu-disagrees-with-body-matrix")).toBe(true);
  });

  it("catches a non-orthonormal REFSMMAT", () => {
    const bad = { ...BOOT, refsmmat: [1, 0, 0, 0, 1, 0, 0, 0, 0.5] as Matrix3 };
    const errors = validateFixedAttitudeBootstrap(bad as typeof BOOT);
    expect(errors.some((e) => e.kind === "matrix-not-orthonormal")).toBe(true);
  });

  it("catches a left-handed (mirrored) frame", () => {
    const bad = { ...BOOT, refsmmat: [1, 0, 0, 0, 1, 0, 0, 0, -1] as Matrix3 };
    const errors = validateFixedAttitudeBootstrap(bad as typeof BOOT);
    expect(errors.some((e) => e.kind === "matrix-determinant")).toBe(true);
  });

  it("catches words that do not decode back to the declared matrix", () => {
    const bad = {
      ...BOOT,
      refsmmatWords: BOOT.refsmmatWords.map((w, i) => (i === 0 ? { ...w, rawWord: 0 } : w)),
    };
    const errors = validateFixedAttitudeBootstrap(bad as typeof BOOT);
    expect(errors.some((e) => e.kind === "word-roundtrip")).toBe(true);
  });

  it("catches an illegal CDU counter value", () => {
    const bad = { ...BOOT, initialCduCounts: { x: 99999, y: 0, z: 0 } };
    const errors = validateFixedAttitudeBootstrap(bad as typeof BOOT);
    expect(errors.some((e) => e.kind === "cdu-out-of-range")).toBe(true);
  });

  it("catches a thrust axis that contradicts the body matrix", () => {
    const bad = { ...BOOT, stableMemberSpecificForceAxis: [0, 1, 0] as const };
    const errors = validateFixedAttitudeBootstrap(bad as unknown as typeof BOOT);
    expect(errors.some((e) => e.kind === "thrust-axis-mismatch")).toBe(true);
  });
});
