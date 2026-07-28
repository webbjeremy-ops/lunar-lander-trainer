// SPDX-License-Identifier: GPL-3.0-or-later
// Authentic AGC/DSKY decoded state. Framework-independent; safe to import
// from Worker, main thread, and tests.
//
// The decoder is a *latched event stream*: it starts from a well-defined
// initial state and each AGC channel write updates zero or more fields. It
// never fabricates values that the AGC did not emit.
//
// Source-normative references (pinned to the exact revision that produced
// the vendored yaAGC.wasm):
//   * yaAGC/yaDSKY2 at michaelfranzl/virtualagc
//     @ ddc65e7bed41f1301921b934fcbaaee93db99dda
//     — selector table, sign-relay semantics, selector-12 annunciator row
//   * michaelfranzl/webAGC @ 0575ea7 (vendored under src/third-party/webagc/)
//     — synthetic channel 011 / 0163 annunciator masks

/** A single 7-segment DSKY digit position. Value 0..9 or null (blank). */
export interface DskyDigit {
  value: number | null;
  segments: number;
}

export const BLANK_DIGIT: DskyDigit = { value: null, segments: 0 };

/**
 * Independent +/- relays. The AGC drives PLUS and MINUS as *separate* latches.
 * yaDSKY2 gives PLUS display priority when both are set; we store both raw
 * so diagnostics can surface the both-on state.
 */
export interface SignRelays {
  plus: boolean;
  minus: boolean;
}

export const SIGN_OFF: SignRelays = { plus: false, minus: false };

export interface DskyRegister {
  digits: DskyDigit[];
  sign?: SignRelays;
}

/**
 * DSKY annunciator lamps. This set is the union of:
 *   * yaDSKY2 selector-12 row annunciators (NO ATT, PRIO DISP, NO DAP,
 *     GIMBAL LOCK, PROG, TRACKER, ALT, VEL)
 *   * webAGC synthetic annunciators driven from channel 011 (COMP ACTY,
 *     UPLINK ACTY) and channel 0163 (AGC warning, TEMP, KEY REL,
 *     VERB/NOUN flash, OPR ERR, RESTART, STBY, EL OFF).
 * Each field is independently latched — no field is inferred from another.
 */
export interface DskyAnnunciators {
  // — selector-12 row (channel 010, tag 060000) —
  noAtt: boolean;
  prioDisp: boolean;
  noDap: boolean;
  gimbalLock: boolean;
  prog: boolean;        // "PROG" lamp — program alarm
  tracker: boolean;
  alt: boolean;
  vel: boolean;
  // — channel 011 (webAGC synthetic) —
  compActy: boolean;
  uplinkActy: boolean;
  // — channel 0163 (webAGC synthetic) —
  agcWarning: boolean;
  temp: boolean;
  keyRelease: boolean;
  verbNounFlash: boolean;
  operError: boolean;
  restart: boolean;
  standby: boolean;
  elOff: boolean;
}

export const ANNUNCIATORS_OFF: DskyAnnunciators = {
  noAtt: false, prioDisp: false, noDap: false, gimbalLock: false,
  prog: false, tracker: false, alt: false, vel: false,
  compActy: false, uplinkActy: false,
  agcWarning: false, temp: false, keyRelease: false, verbNounFlash: false,
  operError: false, restart: false, standby: false, elOff: false,
};

/**
 * The complete latched DSKY output. Determinism note: two runs that receive
 * the same ordered event stream MUST produce identical DecodedDsky values.
 */
export interface DecodedDsky {
  program: DskyRegister; // 2 digits, no sign
  verb: DskyRegister;    // 2 digits, no sign
  noun: DskyRegister;    // 2 digits, no sign
  r1: DskyRegister;      // 5 digits + sign
  r2: DskyRegister;      // 5 digits + sign
  r3: DskyRegister;      // 5 digits + sign
  annunciators: DskyAnnunciators;
  /** Monotonic count of DSKY-relevant channel events applied. */
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
