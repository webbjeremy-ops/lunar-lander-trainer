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

/** Canonical checksum of the fixture-defined peak DSKY state. */
export const V35_PEAK_CHECKSUM: string = v35.peak.checksum;
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
