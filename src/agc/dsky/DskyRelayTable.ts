// SPDX-License-Identifier: GPL-3.0-or-later
// 5-bit DSKY relay-code → 7-segment digit lookup.
//
// Channel 010 packs two 5-bit relay patterns (A = bits 11..15, B = bits 6..10)
// under a 4-bit selector (bits 1..4). Each 5-bit code (0..31) maps to a decimal
// digit 0..9 or a blank; there are 32 codes but only 11 meaningful values. The
// authentic mapping comes from the Block-II DSKY relay decoding matrix as
// implemented by Virtual AGC's yaDSKY.
//
// References:
//   - virtualagc/virtualagc yaDSKY/src/DecodeDigits.c
//   - MIT/IL R-700 "Apollo Guidance and Navigation, Block II Guidance
//     Computer, Assembly and Test Report", DSKY section
//
// Codes not listed below are latched as BLANK to match the historically
// observed behavior (illegal codes render dim/blank rather than random).

/** Bit mask indices for 7-segment output. */
export const SEG = {
  A: 1 << 0,
  B: 1 << 1,
  C: 1 << 2,
  D: 1 << 3,
  E: 1 << 4,
  F: 1 << 5,
  G: 1 << 6,
} as const;

/** 7-segment patterns for the decimal digits 0..9, in canonical A..G order. */
const SEG_DIGIT: Record<number, number> = {
  0: SEG.A | SEG.B | SEG.C | SEG.D | SEG.E | SEG.F,
  1: SEG.B | SEG.C,
  2: SEG.A | SEG.B | SEG.G | SEG.E | SEG.D,
  3: SEG.A | SEG.B | SEG.G | SEG.C | SEG.D,
  4: SEG.F | SEG.G | SEG.B | SEG.C,
  5: SEG.A | SEG.F | SEG.G | SEG.C | SEG.D,
  6: SEG.A | SEG.F | SEG.G | SEG.E | SEG.C | SEG.D,
  7: SEG.A | SEG.B | SEG.C,
  8: SEG.A | SEG.B | SEG.C | SEG.D | SEG.E | SEG.F | SEG.G,
  9: SEG.A | SEG.B | SEG.C | SEG.D | SEG.F | SEG.G,
};

/**
 * Block-II relay code → decimal digit mapping.
 * Only these 5-bit codes are meaningful; every other code is BLANK.
 * Values verified against yaDSKY DecodeDigits.c switch statement.
 */
const CODE_TO_DIGIT: ReadonlyMap<number, number> = new Map([
  [0b00000, -1], // BLANK
  [0b10101, 0],
  [0b00011, 1],
  [0b11001, 2],
  [0b11011, 3],
  [0b01111, 4],
  [0b11110, 5],
  [0b11100, 6],
  [0b10011, 7],
  [0b11101, 8],
  [0b11111, 9],
]);

/** Decode one 5-bit relay code to { value, segments }. Unlisted codes = blank. */
export function decodeRelayCode(code5: number): { value: number | null; segments: number } {
  const code = code5 & 0b11111;
  const d = CODE_TO_DIGIT.get(code);
  if (d === undefined || d < 0) return { value: null, segments: 0 };
  return { value: d, segments: SEG_DIGIT[d] };
}

/** Enumerate all 32 codes; used by determinism tests. */
export function allRelayCodes(): { code: number; value: number | null; segments: number }[] {
  const out: { code: number; value: number | null; segments: number }[] = [];
  for (let c = 0; c < 32; c++) {
    const { value, segments } = decodeRelayCode(c);
    out.push({ code: c, value, segments });
  }
  return out;
}
