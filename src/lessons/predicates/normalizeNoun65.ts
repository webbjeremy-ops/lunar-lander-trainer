// SPDX-License-Identifier: GPL-3.0-or-later
// Fixture-derived normalization for V16 N65 (mission-elapsed-time monitor).
//
// R1/R2/R3 for N65 hold sampled AGC time. yaAGC/Luminary drives every digit
// position as an independent 5-bit relay code, so the display can be blank
// on any position mid-decode. This normalizer:
//
//   1. Reads each register's 5 digits in order.
//   2. Preserves blanks (null) and rejects unsupported relay glyphs — a
//      DskyDigit with segments !== 0 but value === null is treated as an
//      invalid/unsupported code and disqualifies the register from being
//      considered "settled".
//   3. Returns a stable, ordered representation suitable for both display
//      and monotone-progress comparison.
//
// Noun 65 semantics per COLOSSUS/LUMINARY Users Guide: R1=hhh, R2=mm,
// R3=ss.cc (centiseconds). Sign relays are not asserted by Noun 65 in
// steady state; if either sign latch is set the state is not treated as a
// clean N65 display.

import type { DskyRegister } from "@/agc/dsky/DskyTypes";

export interface RegisterReading {
  /** 5-position array; null = blank (relay off). */
  digits: readonly (number | null)[];
  /** True iff every position is either a valid digit 0..9 or a blank. */
  valid: boolean;
  /** True iff no position is blank. */
  complete: boolean;
  /** Numeric interpretation if `complete`, else null. Leading blanks in
   *  `valid && !complete` cases can still yield a partial value via
   *  `partialValue`. */
  value: number | null;
  /** Partial integer value ignoring leading blanks (blanks in middle → null). */
  partialValue: number | null;
  sign: "plus" | "minus" | "both" | "none";
}

export function readRegister(reg: DskyRegister): RegisterReading {
  let valid = true;
  const digits: (number | null)[] = [];
  for (const d of reg.digits) {
    if (d.segments === 0) {
      digits.push(null);
    } else if (typeof d.value === "number" && d.value >= 0 && d.value <= 9) {
      digits.push(d.value);
    } else {
      // Unsupported relay code: refuse.
      digits.push(null);
      valid = false;
    }
  }
  const complete = valid && digits.every((d) => d !== null);
  let value: number | null = null;
  if (complete) {
    value = 0;
    for (const d of digits) value = value! * 10 + (d as number);
  }
  // Partial: leading blanks allowed only if all remaining positions are
  // filled. i.e. "__945" is partial=945; "_9_45" is not partial.
  let partial: number | null = null;
  if (valid) {
    const firstNonBlank = digits.findIndex((d) => d !== null);
    if (firstNonBlank >= 0) {
      const tail = digits.slice(firstNonBlank);
      if (tail.every((d) => d !== null)) {
        partial = 0;
        for (const d of tail) partial = partial! * 10 + (d as number);
      }
    }
  }
  let sign: RegisterReading["sign"] = "none";
  if (reg.sign) {
    if (reg.sign.plus && reg.sign.minus) sign = "both";
    else if (reg.sign.plus) sign = "plus";
    else if (reg.sign.minus) sign = "minus";
  }
  return { digits, valid, complete, value, partialValue: partial, sign };
}

export interface Noun65Reading {
  r1: RegisterReading;
  r2: RegisterReading;
  r3: RegisterReading;
  /** True iff none of R1/R2/R3 carries an unsupported relay glyph. */
  allValid: boolean;
  /** True iff at least one register has a usable partialValue for progress. */
  hasProgressAnchor: boolean;
  /** True iff no register asserts an unexpected sign latch. */
  signsClean: boolean;
}

export function readNoun65(
  r1: DskyRegister,
  r2: DskyRegister,
  r3: DskyRegister,
): Noun65Reading {
  const a = readRegister(r1);
  const b = readRegister(r2);
  const c = readRegister(r3);
  return {
    r1: a,
    r2: b,
    r3: c,
    allValid: a.valid && b.valid && c.valid,
    hasProgressAnchor:
      a.partialValue !== null ||
      b.partialValue !== null ||
      c.partialValue !== null,
    signsClean: a.sign !== "both" && b.sign !== "both" && c.sign !== "both",
  };
}

/**
 * Forward-progress test per Noun 65 semantics: R1=hhh, R2=mm, R3=ss.cc.
 * Time advances if (h,m,s) tuple compares strictly greater with lexical
 * priority. Missing components fall back to per-register partialValue
 * comparison; if EVERY register is fully blank the reading provides no
 * anchor and we return false (undecided → no progress).
 *
 * Blank-in-middle positions from either reading disqualify that register
 * for the comparison, matching the fixture note that "individual captured
 * frames may occur during display updates".
 */
export function noun65Advanced(prev: Noun65Reading, next: Noun65Reading): boolean {
  if (!prev.allValid || !next.allValid) return false;
  const p = compositeAnchor(prev);
  const n = compositeAnchor(next);
  if (p === null || n === null) return false;
  return n > p;
}

function compositeAnchor(r: Noun65Reading): number | null {
  // Prefer full h/m/s. Missing partials → skip this reading.
  const h = r.r1.partialValue;
  const m = r.r2.partialValue;
  const s = r.r3.partialValue;
  if (h !== null && m !== null && s !== null) return h * 10000000 + m * 100000 + s;
  // Fall back to R3 (ss.cc) alone — for MET-only displays.
  if (s !== null) return s;
  if (m !== null) return m * 100000;
  if (h !== null) return h * 10000000;
  return null;
}
