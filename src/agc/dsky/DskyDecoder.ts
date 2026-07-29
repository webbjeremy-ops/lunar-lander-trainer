// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pure, framework-independent DSKY decoder. Consumes ordered AGC channel
// writes (channel 010 for digits/selector-12 annunciator row, channel 011
// and channel 0163 for webAGC synthetic annunciators) and mutates a latched
// DecodedDsky in place.
//
// Guarantees:
//   * Deterministic: same event stream ⇒ identical DecodedDsky.
//   * Never manufactures output: fields only change when a corresponding
//     write directs them to change.
//   * Order-preserving: the caller is responsible for delivering events in
//     the exact order they left the AGC.
//
// All decoder tables in DskyChannelMap.ts are transcribed source-normative
// from michaelfranzl/virtualagc @ ddc65e7bed41f... — the exact revision
// that produced the pinned yaAGC.wasm.

import {
  ANNUNCIATORS_OFF,
  BLANK_DIGIT,
  makeEmptyDecodedDsky,
  SIGN_OFF,
  type DecodedDsky,
  type DskyAnnunciators,
  type DskyRegister,
} from "./DskyTypes";
import { decodeRelayCode } from "./DskyRelayTable";
import {
  CH010_ANNUNCIATOR_MASKS,
  CH011_ANNUNCIATOR_MASKS,
  CH0163_ANNUNCIATOR_MASKS,
  isAnnunciatorRow,
  parseCh010,
  SELECTOR_TABLE,
  type FieldTarget,
} from "./DskyChannelMap";

function writeField(state: DecodedDsky, tgt: FieldTarget, code5: number): void {
  const reg = state[tgt.register] as DskyRegister;
  reg.digits[tgt.digit] = decodeRelayCode(code5);
}

/**
 * Apply one channel-010 write to `state`, mutating it in place.
 * Handles digit-row selectors 1..11 AND the selector-12 annunciator row.
 */
export function applyDskyOutput(state: DecodedDsky, word: number): DecodedDsky {
  state.eventCount += 1;
  const raw = word & 0o77777;

  // Annunciator row is identified by tag bits, NOT by the selector field
  // alone (though they coincide when the tag matches).
  if (isAnnunciatorRow(raw)) {
    for (const { key, mask } of CH010_ANNUNCIATOR_MASKS) {
      state.annunciators[key] = (raw & mask) !== 0;
    }
    return state;
  }

  const p = parseCh010(raw);
  const target = SELECTOR_TABLE[p.selector];
  if (!target) return state; // selector 0 / 12..15 with no matching row → ignore

  if (target.fieldA) writeField(state, target.fieldA, p.codeA);
  if (target.fieldB) writeField(state, target.fieldB, p.codeB);
  if (target.signLatch) {
    const reg = state[target.signLatch.register] as DskyRegister;
    if (reg.sign) {
      // Independent latch: S=1 sets the row's kind, S=0 clears it.
      reg.sign[target.signLatch.kind] = p.sign === 1;
    }
  }
  return state;
}

/** Apply a channel-011 write (webAGC synthetic annunciators). */
export function applyDskyChannel011(state: DecodedDsky, word: number): DecodedDsky {
  state.eventCount += 1;
  applyAnnunciatorMasks(state.annunciators, word, CH011_ANNUNCIATOR_MASKS);
  return state;
}

/** Apply a channel-0163 write (webAGC synthetic annunciators). */
export function applyDskyChannel0163(state: DecodedDsky, word: number): DecodedDsky {
  state.eventCount += 1;
  applyAnnunciatorMasks(state.annunciators, word, CH0163_ANNUNCIATOR_MASKS);
  return state;
}

function applyAnnunciatorMasks(
  ann: DskyAnnunciators,
  word: number,
  masks: ReadonlyArray<{ key: keyof DskyAnnunciators; mask: number }>,
): void {
  for (const { key, mask } of masks) ann[key] = (word & mask) !== 0;
}

/** Route a raw AGC channel write to the appropriate decoder handler.
 *  Returns true when the channel was consumed by the decoder. */
export function applyDskyChannelEvent(state: DecodedDsky, channel: number, word: number): boolean {
  switch (channel) {
    case 0o10:  applyDskyOutput(state, word);       return true;
    case 0o11:  applyDskyChannel011(state, word);   return true;
    case 0o163: applyDskyChannel0163(state, word);  return true;
    default:    return false;
  }
}

/** Apply a batch of channel-010 words in order (back-compat helper). */
export function applyDskyOutputBatch(state: DecodedDsky, words: readonly number[]): DecodedDsky {
  for (const w of words) applyDskyOutput(state, w);
  return state;
}

/** Force the decoder to a completely blank starting state. */
export function resetDecodedDsky(state: DecodedDsky): DecodedDsky {
  const fresh = makeEmptyDecodedDsky();
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

/**
 * Structural (EC-independent) canonical of a DecodedDsky. Suitable for
 * identity comparisons across decoder instances that started from different
 * baselines (e.g. LessonHost's shadow decoder seeded from an attempt
 * boundary vs. the Worker-owned decoder that has been running since public
 * phase start). Two states with identical digits/signs/annunciators produce
 * the same structural canonical regardless of how many events each decoder
 * has processed.
 */
export function decodedDskyStructural(state: DecodedDsky): string {
  const c = decodedDskyCanonical(state);
  return c.replace(/\|EC:\d+$/, "");
}

export { makeEmptyDecodedDsky, BLANK_DIGIT, SIGN_OFF };
