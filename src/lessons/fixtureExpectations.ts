// SPDX-License-Identifier: GPL-3.0-or-later
// Fixture-derived expectations for interactive lessons.
//
// This module is the SINGLE SOURCE of "what the authentic AGC produces" for
// lesson predicates. It loads the committed golden fixtures once at import
// time and re-exports only the checksums/keys/thresholds that the
// predicates need. If the fixtures change, this module changes with them —
// no lesson-side constants may drift out of sync.

import v35 from "../../tests/fixtures/v35-lamp-test.json";
import v16 from "../../tests/fixtures/v16-n65-met.json";
import { AGC_KEY } from "./keyCodes";
import { decodedDskyStructural } from "@/agc/dsky/DskyDecoder";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import type { LessonProvenance } from "./types";

export const FIXTURE_PROVENANCE: LessonProvenance = {
  ropeSha256: v35.metadata.rope.sha256,
  ropeSourceCommit: v35.metadata.rope.sourceCommit,
  emulatorCommit: v35.metadata.emulator.commit,
  decoderSchemaVersion: v35.metadata.decoderSchemaVersion,
};

// V35 lamp test —————————————————————————————————————————————————————————
export const V35_FIXTURE_ID = "v35-lamp-test";
export const V35_EXPECTED_KEY_SEQUENCE = [
  AGC_KEY.VERB,
  AGC_KEY.DIGIT_3,
  AGC_KEY.DIGIT_5,
  AGC_KEY.ENTR,
] as const;

/**
 * Structural (EC-independent) canonical of the fixture-defined peak DSKY
 * state. Retained for diagnostics; the predicate now compares the narrower
 * V35_PEAK_EVIDENCE_CHECKSUM below.
 */
export const V35_PEAK_CHECKSUM: string = decodedDskyStructural(
  v35.peak.decoded as unknown as DecodedDsky,
);
/** Tick range within which the peak was observed in the reference capture. */
export const V35_PEAK_TICK: number = v35.peak.tickIndex;
/**
 * Maximum ticks between an ENTR being accepted and the peak being reached in
 * the reference capture. We give predicates ~4x headroom over the reference
 * so slower rope executions still count, but we still require BOUNDED time
 * — a peak reached hours later is not evidence for this attempt.
 */
export const V35_MAX_TICKS_TO_PEAK: number = 400; // 8s of mission time @ 50Hz
/**
 * The set of annunciator names that are definitively lit at the fixture
 * peak — every one MUST be lit for lesson completion. Derived from the
 * committed fixture; do not hand-edit.
 */
export const V35_PEAK_LIT_ANNUNCIATORS: readonly string[] = Object.entries(
  v35.peak.decoded.annunciators,
)
  .filter(([, v]) => v === true)
  .map(([k]) => k);

/**
 * V35 authoritative evidence projection
 * ─────────────────────────────────────
 * The V35 lamp-test peak evidence is exactly:
 *   * every 7-segment digit reading '8' in PROG, VERB, NOUN, R1, R2, R3
 *   * every sign relay: PLUS latched, MINUS clear on R1/R2/R3
 *   * every AUTHORITATIVE annunciator matching its fixture value
 *
 * Two annunciators are excluded because they are inherently activity- or
 * flash-phase driven and cannot be deterministically sampled at the exact
 * digit-peak tick:
 *   * compActy      — Luminary099 toggles COMP ACTY on executive job
 *                     boundaries; on/off at digit-peak is not guaranteed.
 *   * verbNounFlash — Verb/Noun flash is a periodic display attribute; the
 *                     digit register holds '8' for multiple flash phases.
 * The fixture happens to record both `false` at the sampled tick — that is
 * a sampling artifact, not an authoritative expectation. Excluding them
 * from the evidence checksum keeps the digit / sign / restart / prog /
 * temp / gimbalLock / uplinkActy / operError / keyRelease / agcWarning /
 * standby / tracker / alt / vel / noAtt evidence intact.
 */
export const V35_EVIDENCE_IGNORED_ANNUNCIATORS: readonly string[] = [
  "compActy",
  "verbNounFlash",
];

export interface V35EvidenceProjection {
  program: readonly (number | null)[];
  verb: readonly (number | null)[];
  noun: readonly (number | null)[];
  r1: { digits: readonly (number | null)[]; sign: { plus: boolean; minus: boolean } };
  r2: { digits: readonly (number | null)[]; sign: { plus: boolean; minus: boolean } };
  r3: { digits: readonly (number | null)[]; sign: { plus: boolean; minus: boolean } };
  annunciators: Record<string, boolean>;
}

function projectRegDigits(reg: { digits: readonly { value: number | null }[] }): readonly (number | null)[] {
  return reg.digits.map((d) => d.value);
}

/** Project a DecodedDsky down to V35 authoritative peak evidence fields. */
export function projectV35PeakEvidence(decoded: DecodedDsky): V35EvidenceProjection {
  const anns: Record<string, boolean> = {};
  const rec = decoded.annunciators as unknown as Record<string, boolean>;
  const ignored = new Set<string>(V35_EVIDENCE_IGNORED_ANNUNCIATORS);
  for (const k of Object.keys(rec).sort()) {
    if (ignored.has(k)) continue;
    anns[k] = rec[k] === true;
  }
  const emptySign = { plus: false, minus: false };
  return {
    program: projectRegDigits(decoded.program),
    verb: projectRegDigits(decoded.verb),
    noun: projectRegDigits(decoded.noun),
    r1: { digits: projectRegDigits(decoded.r1), sign: decoded.r1.sign ?? emptySign },
    r2: { digits: projectRegDigits(decoded.r2), sign: decoded.r2.sign ?? emptySign },
    r3: { digits: projectRegDigits(decoded.r3), sign: decoded.r3.sign ?? emptySign },
    annunciators: anns,
  };
}

/** Deterministic canonical string of a V35 evidence projection. */
export function v35EvidenceCanonical(p: V35EvidenceProjection): string {
  const digits = (arr: readonly (number | null)[]) =>
    arr.map((d) => (d ?? "_").toString()).join("");
  const sign = (s: { plus: boolean; minus: boolean }) =>
    `${s.plus ? "+" : "."}${s.minus ? "-" : "."}`;
  const anns = Object.keys(p.annunciators)
    .sort()
    .map((k) => `${k}=${p.annunciators[k] ? 1 : 0}`)
    .join(",");
  return [
    `PROG:${digits(p.program)}`,
    `VERB:${digits(p.verb)}`,
    `NOUN:${digits(p.noun)}`,
    `R1:${sign(p.r1.sign)}${digits(p.r1.digits)}`,
    `R2:${sign(p.r2.sign)}${digits(p.r2.digits)}`,
    `R3:${sign(p.r3.sign)}${digits(p.r3.digits)}`,
    `ANN:${anns}`,
  ].join("|");
}

export interface V35EvidenceDiff {
  program?: { expected: readonly (number | null)[]; actual: readonly (number | null)[] };
  verb?:    { expected: readonly (number | null)[]; actual: readonly (number | null)[] };
  noun?:    { expected: readonly (number | null)[]; actual: readonly (number | null)[] };
  registers?: Record<string, { digits?: { expected: readonly (number | null)[]; actual: readonly (number | null)[] }; sign?: { expected: unknown; actual: unknown } }>;
  annunciators?: Record<string, { expected: boolean; actual: boolean }>;
}

function digitsEqual(a: readonly (number | null)[], b: readonly (number | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Field-level diff — empty object means the two projections are identical. */
export function diffV35Evidence(
  expected: V35EvidenceProjection,
  actual: V35EvidenceProjection,
): V35EvidenceDiff {
  const diff: V35EvidenceDiff = {};
  if (!digitsEqual(expected.program, actual.program)) diff.program = { expected: expected.program, actual: actual.program };
  if (!digitsEqual(expected.verb, actual.verb)) diff.verb = { expected: expected.verb, actual: actual.verb };
  if (!digitsEqual(expected.noun, actual.noun)) diff.noun = { expected: expected.noun, actual: actual.noun };
  const regs: Record<string, { digits?: { expected: readonly (number | null)[]; actual: readonly (number | null)[] }; sign?: { expected: unknown; actual: unknown } }> = {};
  let anyReg = false;
  for (const k of ["r1", "r2", "r3"] as const) {
    const e = expected[k], a = actual[k];
    const entry: { digits?: { expected: readonly (number | null)[]; actual: readonly (number | null)[] }; sign?: { expected: unknown; actual: unknown } } = {};
    if (!digitsEqual(e.digits, a.digits)) entry.digits = { expected: e.digits, actual: a.digits };
    if (e.sign.plus !== a.sign.plus || e.sign.minus !== a.sign.minus) entry.sign = { expected: e.sign, actual: a.sign };
    if (entry.digits || entry.sign) { regs[k] = entry; anyReg = true; }
  }
  if (anyReg) diff.registers = regs;
  const annDiff: Record<string, { expected: boolean; actual: boolean }> = {};
  const keys = new Set([...Object.keys(expected.annunciators), ...Object.keys(actual.annunciators)]);
  for (const k of keys) {
    const e = expected.annunciators[k] === true;
    const a = actual.annunciators[k] === true;
    if (e !== a) annDiff[k] = { expected: e, actual: a };
  }
  if (Object.keys(annDiff).length > 0) diff.annunciators = annDiff;
  return diff;
}

/** Reference V35 evidence projection derived from the committed fixture. */
export const V35_PEAK_EVIDENCE_PROJECTION: V35EvidenceProjection =
  projectV35PeakEvidence(v35.peak.decoded as unknown as DecodedDsky);
/** Canonical checksum of the authoritative V35 evidence projection. */
export const V35_PEAK_EVIDENCE_CHECKSUM: string = v35EvidenceCanonical(
  V35_PEAK_EVIDENCE_PROJECTION,
);

/**
 * Annunciators that are inherently periodic or activity-driven and MUST NOT
 * count as "display changes" for readiness quiet-window purposes. Excluding
 * them prevents a settled DSKY from being labelled unstable simply because
 * Luminary blinks COMP ACTY or toggles the Verb/Noun flash phase between
 * scans. The peak-checksum evidence rule is unaffected — this only relaxes
 * the pre-command settled-state gate.
 */
export const READINESS_PROJECTION_IGNORED_ANNUNCIATORS: readonly string[] = [
  "compActy",
  "uplinkActy",
  "verbNounFlash",
];

/**
 * Mission-tick length of the settled quiet window required before an
 * interactive V35 attempt may open. Derived from the committed capture: in
 * v35-lamp-test.json the AGC emits its last pre-command Channel 010 event
 * at tickIndex 6 and the first VERB press lands at tickIndex 41 — a
 * pre-command quiet interval of ~35 mission ticks (~700ms) during which the
 * decoder-relevant projection did not change. We require 20 ticks (400ms)
 * of unchanged projection with the AGC still advancing — well inside the
 * fixture-observed quiet interval, well outside snapshot cadence jitter.
 */
export const V35_READINESS_QUIET_TICKS: number = 20;

// V16 N65 mission-elapsed-time —————————————————————————————————————————
export const V16_FIXTURE_ID = "v16-n65-met";
export const V16_EXPECTED_KEY_SEQUENCE = [
  AGC_KEY.VERB,
  AGC_KEY.DIGIT_1,
  AGC_KEY.DIGIT_6,
  AGC_KEY.NOUN,
  AGC_KEY.DIGIT_6,
  AGC_KEY.DIGIT_5,
  AGC_KEY.ENTR,
] as const;

/** Minimum observations after ENTR before the predicate may complete. */
export const V16_MIN_POST_ENTER_OBSERVATIONS = 2;

/**
 * V16 requires stable VERB=16 and NOUN=65 in the decoded display. These are
 * the exact digit tuples the decoder emits when both registers are settled.
 * We check the .value fields (0..9 or null) — not `segments` — so a rope
 * that happens to use a different segment mask for the same digit still
 * matches.
 */
export const V16_STABLE_VERB_DIGITS: readonly (number | null)[] = [1, 6];
export const V16_STABLE_NOUN_DIGITS: readonly (number | null)[] = [6, 5];
