// SPDX-License-Identifier: GPL-3.0-or-later
// AGC/DSKY key codes, encoded as the raw numeric values the AGC accepts on
// channel 015. Values match Luminary099 / Block II AGC (see MIT/IL R-393).
// These integers are what recentInputs[i].keyCode carries when a real key
// press has been accepted by the emulator.
//
// The fixture captures use the same integer values, so tests can compare
// captured commands to the sequences below directly.

export const AGC_KEY = {
  DIGIT_0: 0o20, // 16
  DIGIT_1: 0o01, //  1
  DIGIT_2: 0o02,
  DIGIT_3: 0o03,
  DIGIT_4: 0o04,
  DIGIT_5: 0o05, //  5
  DIGIT_6: 0o06, //  6
  DIGIT_7: 0o07,
  DIGIT_8: 0o10,
  DIGIT_9: 0o11,
  VERB: 0o21, // 17
  NOUN: 0o37, // 31
  ENTR: 0o34, // 28
  CLR:  0o36, // 30
  PLUS: 0o32, // 26
  MINUS:0o33, // 27
  RSET: 0o22, // 18
  KEY_REL: 0o31, // 25
  PRO:  0o35, // 29 (stateful — PROCEED is held)
} as const;

export function digitKey(n: number): number {
  if (n === 0) return AGC_KEY.DIGIT_0;
  if (n < 1 || n > 9) throw new Error(`digitKey out of range: ${n}`);
  return n; // 1..9 map to their own octal code
}
