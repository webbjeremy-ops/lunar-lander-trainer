// SPDX-License-Identifier: GPL-3.0-or-later
//
// Source-normative decoder tables for the DSKY. Transcribed from
//   michaelfranzl/virtualagc @ ddc65e7bed41f1301921b934fcbaaee93db99dda
// (the exact source revision that produced the pinned yaAGC.wasm shipped
// in michaelfranzl/webAGC @ 0575ea7). Do NOT modify these tables to make
// captured traces "look right" — modify them only when the upstream source
// says so.
//
// Channel 010 word layout (15 bits, MSB→LSB, bit-14 down to bit-0):
//   bit 14..11 | bit 10 | bit 9..5 | bit 4..0
//     WWWW        S        AAAAA      BBBBB
//   WWWW   (4 bits) — selector 1..11 for digit rows; 12 is the annunciator
//                     row (also identified by tag (word & 0o74000) == 0o60000).
//   S      (1 bit)  — sign relay drive (row-dependent semantics; test 0x0400)
//   AAAAA  (5 bits) — relay code A (left digit field of the row)
//   BBBBB  (5 bits) — relay code B (right digit field of the row)
//
// This is the exact layout implemented by the pinned yaDSKY2 source
// (michaelfranzl/virtualagc @ ddc65e7b, matching webAGC @ 0575ea7):
//   selector = (word >>> 11) & 0x0f
//   signBit  = (word >>> 10) & 0x01
//   left     = (word >>>  5) & 0x1f
//   right    =  word         & 0x1f
//
// An earlier revision of this decoder shifted every payload field by one
// bit (WWWW AAAAA BBBBB S), which mis-parsed digit code 29 ("8") as code
// 14 with an unrelated sign bit. Any regression that reintroduces that
// off-by-one will fail the DskyDecoder unit tests and the golden traces.

import type { DskyAnnunciators } from "./DskyTypes";

export type RegKey = "program" | "verb" | "noun" | "r1" | "r2" | "r3";

/** Parsed channel-010 word. */
export interface ParsedCh010 {
  selector: number; // bits 14..11
  sign: number;     // bit 10  (0 or 1)
  codeA: number;    // bits 9..5   (left field)
  codeB: number;    // bits 4..0   (right field)
  raw: number;
}

export function parseCh010(word: number): ParsedCh010 {
  const w = word & 0o77777;
  return {
    selector: (w >>> 11) & 0x0f,
    sign:     (w >>> 10) & 0x01,
    codeA:    (w >>>  5) & 0x1f,
    codeB:     w         & 0x1f,
    raw:      w,
  };
}

/** A single (register, digit-index) target for one of the two 5-bit fields. */
export interface FieldTarget {
  register: RegKey;
  /** 0-based digit index in the target register's digits[] array. */
  digit: number;
}

export interface SelectorTarget {
  /** What the left/high field (bits 15..11) drives; null if unused. */
  fieldA: FieldTarget | null;
  /** What the right/low field (bits 10..6) drives; null if unused. */
  fieldB: FieldTarget | null;
  /** Which sign latch (if any) the S bit toggles for this row. */
  signLatch?: { register: "r1" | "r2" | "r3"; kind: "plus" | "minus" };
}

/**
 * Digit-row selectors 1..11 exactly as documented in yaDSKY2 at the pinned
 * source commit. Selector 12 is intentionally absent — the annunciator row
 * is decoded via `isAnnunciatorRow` / `ANNUNCIATOR_ROW_MASKS` below.
 */
export const SELECTOR_TABLE: Readonly<Record<number, SelectorTarget>> = {
  11: { fieldA: { register: "program", digit: 0 }, fieldB: { register: "program", digit: 1 } },
  10: { fieldA: { register: "verb",    digit: 0 }, fieldB: { register: "verb",    digit: 1 } },
   9: { fieldA: { register: "noun",    digit: 0 }, fieldB: { register: "noun",    digit: 1 } },
   8: { fieldA: null,                              fieldB: { register: "r1", digit: 0 } },
   7: { fieldA: { register: "r1", digit: 1 },      fieldB: { register: "r1", digit: 2 },
        signLatch: { register: "r1", kind: "plus"  } },
   6: { fieldA: { register: "r1", digit: 3 },      fieldB: { register: "r1", digit: 4 },
        signLatch: { register: "r1", kind: "minus" } },
   5: { fieldA: { register: "r2", digit: 0 },      fieldB: { register: "r2", digit: 1 },
        signLatch: { register: "r2", kind: "plus"  } },
   4: { fieldA: { register: "r2", digit: 2 },      fieldB: { register: "r2", digit: 3 },
        signLatch: { register: "r2", kind: "minus" } },
   3: { fieldA: { register: "r2", digit: 4 },      fieldB: { register: "r3", digit: 0 } },
   2: { fieldA: { register: "r3", digit: 1 },      fieldB: { register: "r3", digit: 2 },
        signLatch: { register: "r3", kind: "plus"  } },
   1: { fieldA: { register: "r3", digit: 3 },      fieldB: { register: "r3", digit: 4 },
        signLatch: { register: "r3", kind: "minus" } },
};

// ─── Selector 12 annunciator row (channel 010) ────────────────────────────

/** Row-tag mask and expected value that identify the annunciator write. */
export const ANNUNCIATOR_ROW_TAG_MASK = 0o74000;
export const ANNUNCIATOR_ROW_TAG_VALUE = 0o60000;

export function isAnnunciatorRow(word: number): boolean {
  return ((word & 0o77777) & ANNUNCIATOR_ROW_TAG_MASK) === ANNUNCIATOR_ROW_TAG_VALUE;
}

/**
 * Annunciator bit masks applied against the raw channel-010 word when the
 * row tag matches. Values from the pinned yaDSKY2 source.
 */
export const CH010_ANNUNCIATOR_MASKS: ReadonlyArray<{ key: keyof DskyAnnunciators; mask: number }> = [
  { key: "noAtt",      mask: 0o10  },
  { key: "prioDisp",   mask: 0o1   },
  { key: "noDap",      mask: 0o2   },
  { key: "gimbalLock", mask: 0o40  },
  { key: "prog",       mask: 0o400 },
  { key: "tracker",    mask: 0o200 },
  { key: "alt",        mask: 0o20  },
  { key: "vel",        mask: 0o4   },
];

// ─── Channel 011 (webAGC synthetic) ───────────────────────────────────────

export const CH011_ANNUNCIATOR_MASKS: ReadonlyArray<{ key: keyof DskyAnnunciators; mask: number }> = [
  { key: "compActy",   mask: 0o2 }, // bit 2
  { key: "uplinkActy", mask: 0o4 }, // bit 3
];

// ─── Channel 0163 (webAGC synthetic) ──────────────────────────────────────

export const CH0163_ANNUNCIATOR_MASKS: ReadonlyArray<{ key: keyof DskyAnnunciators; mask: number }> = [
  { key: "agcWarning",    mask: 0o1    }, // bit 1
  { key: "temp",          mask: 0o10   }, // bit 4
  { key: "keyRelease",    mask: 0o20   }, // bit 5
  { key: "verbNounFlash", mask: 0o40   }, // bit 6
  { key: "operError",     mask: 0o100  }, // bit 7
  { key: "restart",       mask: 0o200  }, // bit 8
  { key: "standby",       mask: 0o400  }, // bit 9
  { key: "elOff",         mask: 0o1000 }, // bit 10
];
