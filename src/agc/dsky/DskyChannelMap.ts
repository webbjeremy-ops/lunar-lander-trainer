// SPDX-License-Identifier: GPL-3.0-or-later
// Channel-010 word format and the 12-selector routing table used by the DSKY
// decoder. All bit ranges are 1-based to match Virtual AGC's yaAGC/yaDSKY
// documentation.
//
// Channel 010 word layout (15 bits, MSB→LSB, 1-indexed):
//   bit 15 . . 11 | bit 10 . . 6 | bit 5 | bit 4 . . 1
//        AAAAA        BBBBB         S       CCCC
//   AAAAA (5 bits) — relay code A (drives the "A" digit for the selector)
//   BBBBB (5 bits) — relay code B (drives the "B" digit for the selector)
//   S     (1 bit)  — sign / auxiliary latch (semantics depend on selector)
//   CCCC  (4 bits) — selector 1..12; other values are reserved / ignored
//
// Reference: virtualagc yaDSKY DecodeDskyChannel; corroborated by webAGC
// (vendored at src/third-party/webagc/, pinned 0575ea7).
//
// The 12-selector routing:
//   1  → R3 D4 (A) + R3 D5 (B), no sign
//   2  → R3 D2 (A) + R3 D3 (B), no sign
//   3  → R3 D1 (A),             sign latch = R3 plus/minus (bit S selects
//        which latch; a companion selector-3 write with different code sets
//        the opposite polarity)
//   4  → R2 D4 (A) + R2 D5 (B)
//   5  → R2 D2 (A) + R2 D3 (B)
//   6  → R2 D1 (A),             sign latch = R2 plus/minus
//   7  → R1 D4 (A) + R1 D5 (B)
//   8  → R1 D2 (A) + R1 D3 (B)
//   9  → R1 D1 (A),             sign latch = R1 plus/minus
//   10 → NOUN D1 (A) + NOUN D2 (B)
//   11 → VERB D1 (A) + VERB D2 (B)
//   12 → PROG D1 (A) + PROG D2 (B) + annunciator flag bits
//
// The historical selectors 12/13 also carry annunciator/flag bits. The
// authentic block-II DSKY drives ANN lines via a companion 12-code write
// whose A/B fields hold flag bits rather than digits. When SELECTOR === 12,
// the decoder ALSO applies annunciator updates (see AnnFlag below); the
// digits latch is preserved because both are physically wired.

import type { SignRelays } from "./DskyTypes";

/** Parsed channel-010 word. */
export interface ParsedCh010 {
  codeA: number;
  codeB: number;
  sign: number;   // 0 or 1
  selector: number; // 1..12 meaningful
  raw: number;
}

export function parseCh010(word: number): ParsedCh010 {
  const w = word & 0o77777;
  return {
    codeA: (w >>> 10) & 0b11111,
    codeB: (w >>> 5) & 0b11111,
    sign: (w >>> 4) & 0b1,
    selector: w & 0b1111,
    raw: w,
  };
}

/** Which register + digit indices a selector's A/B fields drive. */
export interface SelectorTarget {
  register: "program" | "verb" | "noun" | "r1" | "r2" | "r3";
  digitA: number | null; // 0-based index into the register's digits[]
  digitB: number | null;
  /** True when this selector also latches a sign relay for its register. */
  hasSign: boolean;
}

export const SELECTOR_TABLE: Readonly<Record<number, SelectorTarget>> = {
  1:  { register: "r3", digitA: 3, digitB: 4, hasSign: false },
  2:  { register: "r3", digitA: 1, digitB: 2, hasSign: false },
  3:  { register: "r3", digitA: 0, digitB: null, hasSign: true },
  4:  { register: "r2", digitA: 3, digitB: 4, hasSign: false },
  5:  { register: "r2", digitA: 1, digitB: 2, hasSign: false },
  6:  { register: "r2", digitA: 0, digitB: null, hasSign: true },
  7:  { register: "r1", digitA: 3, digitB: 4, hasSign: false },
  8:  { register: "r1", digitA: 1, digitB: 2, hasSign: false },
  9:  { register: "r1", digitA: 0, digitB: null, hasSign: true },
  10: { register: "noun", digitA: 0, digitB: 1, hasSign: false },
  11: { register: "verb", digitA: 0, digitB: 1, hasSign: false },
  12: { register: "program", digitA: 0, digitB: 1, hasSign: false },
};

/**
 * Annunciator bit assignments applied when SELECTOR === 12. The A and B code
 * bits carry annunciator latches; the S bit carries VERB/NOUN flash. Each is
 * an INDEPENDENT latch — a bit set to 1 latches the annunciator ON; a bit set
 * to 0 latches it OFF. No annunciator is inferred from another.
 */
export interface AnnunciatorBitPlan {
  fromA: Partial<Record<keyof import("./DskyTypes").DskyAnnunciators, number>>; // mask bit within A
  fromB: Partial<Record<keyof import("./DskyTypes").DskyAnnunciators, number>>;
  fromSign?: keyof import("./DskyTypes").DskyAnnunciators;
}

export const SELECTOR_12_ANNUNCIATORS: AnnunciatorBitPlan = {
  fromA: {
    compActy: 1 << 0,
    uplinkActy: 1 << 1,
    temp: 1 << 2,
    noAtt: 1 << 3,
    gimbalLock: 1 << 4,
  },
  fromB: {
    standby: 1 << 0,
    progAlarm: 1 << 1,
    keyRelease: 1 << 2,
    restart: 1 << 3,
    operError: 1 << 4,
  },
  fromSign: "verbNounFlash",
};

/** Signed-register sign application semantics. */
export function applySignLatch(prev: SignRelays, signBit: number, codeA: number): SignRelays {
  // Block-II DSKY drives PLUS and MINUS as independent latches. A selector 3/6/9
  // write with S=1 latches PLUS; codeA bit 0 latches MINUS. We treat both as
  // independent set/reset commands so both-on and both-off states are
  // preserved (both-on is surfaced by the UI as an anomaly rather than masked).
  return {
    plus: signBit === 1,
    minus: (codeA & 1) === 1,
  };
}
