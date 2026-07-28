// SPDX-License-Identifier: GPL-3.0-or-later
// Authentic AGC/DSKY decoded state produced from ordered channel-010 events.
// Framework-independent; safe to import from Worker, main thread, and tests.
//
// The decoder is a *latched event stream*: it starts from a well-defined
// initial state and each channel-010 write updates zero or more fields. It
// never fabricates values that the AGC did not emit.
//
// References:
//   - Virtual AGC Project, yaDSKY selector table
//     https://github.com/virtualagc/virtualagc/blob/master/yaDSKY/src/main.c
//   - webAGC pinned at michaelfranzl/webAGC @ 0575ea7 (vendored under
//     src/third-party/webagc/) which itself wraps the same yaAGC/yaDSKY
//     conventions.

/** A single 7-segment DSKY digit position. Value 0..9 or null (blank). */
export interface DskyDigit {
  /** 0..9 or null when the digit is blank. */
  value: number | null;
  /** 7-segment bit mask (bit 0 = seg A .. bit 6 = seg G). */
  segments: number;
}

export const BLANK_DIGIT: DskyDigit = { value: null, segments: 0 };

/**
 * Independent +/- relays. The AGC drives PLUS and MINUS as *separate* latches:
 * both off = blank, one on = signed digit, both on = illegal (surfaced for
 * diagnostics rather than silently masked).
 */
export interface SignRelays {
  plus: boolean;
  minus: boolean;
}

export const SIGN_OFF: SignRelays = { plus: false, minus: false };

export interface DskyRegister {
  /** Digits in display order (leftmost = index 0). Program = 2, R1/R2/R3 = 5. */
  digits: DskyDigit[];
  /** Sign relays for signed registers (R1, R2, R3). undefined for unsigned. */
  sign?: SignRelays;
}

/**
 * Selector-12 annunciator + flag bits latched from channel 010. Every field is
 * independently latched — no field is inferred from another.
 * The set here corresponds to authentic block-II DSKY annunciator lines that
 * yaDSKY drives from selector-12 writes.
 */
export interface DskyAnnunciators {
  /** VERB/NOUN 2Hz flash flag. */
  verbNounFlash: boolean;
  /** OPR ERR indicator. */
  operError: boolean;
  /** KEY REL indicator. */
  keyRelease: boolean;
  /** COMP ACTY indicator (computer activity). */
  compActy: boolean;
  /** STBY indicator. */
  standby: boolean;
  /** NO ATT indicator. */
  noAtt: boolean;
  /** GIMBAL LOCK indicator. */
  gimbalLock: boolean;
  /** PROG indicator (program alarm). */
  progAlarm: boolean;
  /** TRACKER indicator. */
  tracker: boolean;
  /** TEMP indicator. */
  temp: boolean;
  /** UPLINK ACTY indicator. */
  uplinkActy: boolean;
  /** RESTART indicator. */
  restart: boolean;
}

export const ANNUNCIATORS_OFF: DskyAnnunciators = {
  verbNounFlash: false,
  operError: false,
  keyRelease: false,
  compActy: false,
  standby: false,
  noAtt: false,
  gimbalLock: false,
  progAlarm: false,
  tracker: false,
  temp: false,
  uplinkActy: false,
  restart: false,
};

/**
 * The complete latched DSKY output as decoded from channel-010 traffic.
 * Determinism note: two runs that receive the same ordered event stream MUST
 * produce identical DecodedDsky values. This is enforced in tests.
 */
export interface DecodedDsky {
  program: DskyRegister; // 2 digits, no sign
  verb: DskyRegister;    // 2 digits, no sign
  noun: DskyRegister;    // 2 digits, no sign
  r1: DskyRegister;      // 5 digits + sign
  r2: DskyRegister;      // 5 digits + sign
  r3: DskyRegister;      // 5 digits + sign
  annunciators: DskyAnnunciators;
  /** Monotonic count of channel-010 events applied. Included in determinism checksum. */
  eventCount: number;
}

export function makeEmptyDecodedDsky(): DecodedDsky {
  return {
    program: { digits: [{ ...BLANK_DIGIT }, { ...BLANK_DIGIT }] },
    verb: { digits: [{ ...BLANK_DIGIT }, { ...BLANK_DIGIT }] },
    noun: { digits: [{ ...BLANK_DIGIT }, { ...BLANK_DIGIT }] },
    r1: { digits: Array.from({ length: 5 }, () => ({ ...BLANK_DIGIT })), sign: { ...SIGN_OFF } },
    r2: { digits: Array.from({ length: 5 }, () => ({ ...BLANK_DIGIT })), sign: { ...SIGN_OFF } },
    r3: { digits: Array.from({ length: 5 }, () => ({ ...BLANK_DIGIT })), sign: { ...SIGN_OFF } },
    annunciators: { ...ANNUNCIATORS_OFF },
    eventCount: 0,
  };
}
