// SPDX-License-Identifier: GPL-3.0-or-later
// Pure, framework-independent DSKY decoder. Consumes ordered channel-010
// events (one per AGC OUTPUT to channel 010, in original order and never
// coalesced) and mutates a latched DecodedDsky.
//
// Guarantees:
//   * Deterministic: same event stream ⇒ identical DecodedDsky.
//   * Never manufactures output: fields only change when a corresponding
//     channel-010 write directs them to change.
//   * Order-preserving: the caller is responsible for delivering events in
//     the exact order they left the AGC (see AgcCoreAdapter.drainIo which
//     preserves per-tick output order).

import {
  ANNUNCIATORS_OFF,
  BLANK_DIGIT,
  makeEmptyDecodedDsky,
  SIGN_OFF,
  type DecodedDsky,
  type DskyRegister,
} from "./DskyTypes";
import { decodeRelayCode } from "./DskyRelayTable";
import {
  applySignLatch,
  parseCh010,
  SELECTOR_12_ANNUNCIATORS,
  SELECTOR_TABLE,
} from "./DskyChannelMap";

/**
 * Apply one channel-010 write to `state`, mutating it in place, and return
 * the mutated state for convenience.
 */
export function applyDskyOutput(state: DecodedDsky, word: number): DecodedDsky {
  state.eventCount += 1;
  const p = parseCh010(word);
  const target = SELECTOR_TABLE[p.selector];
  if (!target) return state; // selector out of range 1..12 → ignored

  const reg = state[target.register] as DskyRegister;

  // Digit A
  if (target.digitA !== null) {
    reg.digits[target.digitA] = decodeRelayCode(p.codeA);
  }
  // Digit B
  if (target.digitB !== null) {
    reg.digits[target.digitB] = decodeRelayCode(p.codeB);
  }
  // Sign latch
  if (target.hasSign && reg.sign) {
    reg.sign = applySignLatch(reg.sign, p.sign, p.codeA);
  }
  // Selector 12 also carries annunciator + flag bits
  if (p.selector === 12) {
    const ann = state.annunciators;
    const plan = SELECTOR_12_ANNUNCIATORS;
    for (const [k, mask] of Object.entries(plan.fromA)) {
      (ann as unknown as Record<string, boolean>)[k] = (p.codeA & (mask as number)) !== 0;
    }
    for (const [k, mask] of Object.entries(plan.fromB)) {
      (ann as unknown as Record<string, boolean>)[k] = (p.codeB & (mask as number)) !== 0;
    }
    if (plan.fromSign) {
      (ann as unknown as Record<string, boolean>)[plan.fromSign] = p.sign === 1;
    }
  }
  return state;
}

/** Apply a batch of channel-010 words in order. */
export function applyDskyOutputBatch(state: DecodedDsky, words: readonly number[]): DecodedDsky {
  for (const w of words) applyDskyOutput(state, w);
  return state;
}

/** Force the decoder to a completely blank starting state. */
export function resetDecodedDsky(state: DecodedDsky): DecodedDsky {
  const fresh = makeEmptyDecodedDsky();
  // in-place copy so external references stay valid
  state.program = fresh.program;
  state.verb = fresh.verb;
  state.noun = fresh.noun;
  state.r1 = fresh.r1;
  state.r2 = fresh.r2;
  state.r3 = fresh.r3;
  state.annunciators = { ...ANNUNCIATORS_OFF };
  state.eventCount = 0;
  return state;
}

/** Small helper: does register have any lit segment? */
export function registerIsBlank(reg: DskyRegister): boolean {
  return reg.digits.every((d) => d.segments === 0) &&
    (!reg.sign || (!reg.sign.plus && !reg.sign.minus));
}

/**
 * Serialize a DecodedDsky to a stable canonical string. Used by determinism
 * checksums so two runs can compare latched DSKY state byte-for-byte.
 */
export function decodedDskyCanonical(state: DecodedDsky): string {
  const digitStr = (r: DskyRegister) =>
    r.digits.map((d) => (d.value ?? "_").toString()).join("");
  const signStr = (r: DskyRegister) =>
    r.sign ? `${r.sign.plus ? "+" : "."}${r.sign.minus ? "-" : "."}` : "";
  const annKeys = Object.keys(state.annunciators).sort();
  const annStr = annKeys
    .map((k) => `${k}=${(state.annunciators as unknown as Record<string, boolean>)[k] ? 1 : 0}`)
    .join(",");
  return [
    `PROG:${digitStr(state.program)}`,
    `VERB:${digitStr(state.verb)}`,
    `NOUN:${digitStr(state.noun)}`,
    `R1:${signStr(state.r1)}${digitStr(state.r1)}`,
    `R2:${signStr(state.r2)}${digitStr(state.r2)}`,
    `R3:${signStr(state.r3)}${digitStr(state.r3)}`,
    `ANN:${annStr}`,
    `EC:${state.eventCount}`,
  ].join("|");
}

export { makeEmptyDecodedDsky, BLANK_DIGIT, SIGN_OFF };
