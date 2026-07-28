// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 4 predicate — V16 N65 mission-elapsed-time monitor.
//
// Completion requires (all conjunctively):
//   1. Attempt-scoped V-1-6-N-6-5-ENTR key sequence accepted.
//   2. Decoded VERB digits stably == [1,6] across at least
//      V16_MIN_POST_ENTER_OBSERVATIONS successive observations after ENTR.
//   3. Decoded NOUN digits stably == [6,5] across the same window.
//   4. Worker mission time and totalAgcSteps strictly increase across the
//      observations in that window.
//   5. Displayed Noun 65 registers show forward change — at least one
//      register's fixture-derived numeric interpretation advanced across
//      the observations, without introducing an unsupported relay glyph.
//
// Explicitly NOT part of completion:
//   * Any hard-coded R3 string like "__9_5". The fixture is only used to
//     define provenance and the direction of "forward" per Noun 65.
//   * OPR ERR being latched. It neither completes nor fails the lesson
//     unless the fixture explicitly required it (this fixture does not).
//
// A changing single digit in isolation (without stable VERB/NOUN) does not
// complete: the register progress check runs INSIDE the stable-VNP window.

import { decodedDskyCanonical } from "@/agc/dsky/DskyDecoder";
import { readNoun65, noun65Advanced } from "./normalizeNoun65";
import { matchAttemptScopedSequence } from "./inputSequence";
import {
  FIXTURE_PROVENANCE,
  V16_EXPECTED_KEY_SEQUENCE,
  V16_FIXTURE_ID,
  V16_MIN_POST_ENTER_OBSERVATIONS,
  V16_STABLE_NOUN_DIGITS,
  V16_STABLE_VERB_DIGITS,
} from "../fixtureExpectations";
import type { StepPredicate, StepPredicateResult } from "../types";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";

interface Snap {
  tick: number;
  missionTimeUs: number;
  agcSteps: number;
  n65Anchor: number | null;
  checksum: string;
}

interface V16Internal {
  enterEventId: number | null;
  enterTick: number | null;
  channelEventIdsSinceEnter: number[];
  postEnterSnaps: Snap[];
  inputEventIds: number[];
}

function emptyInternal(): V16Internal {
  return {
    enterEventId: null,
    enterTick: null,
    channelEventIdsSinceEnter: [],
    postEnterSnaps: [],
    inputEventIds: [],
  };
}

function verbNounStable(decoded: DecodedDsky): boolean {
  const verbOk = decoded.verb.digits.every(
    (d, i) => d.value === V16_STABLE_VERB_DIGITS[i],
  );
  const nounOk = decoded.noun.digits.every(
    (d, i) => d.value === V16_STABLE_NOUN_DIGITS[i],
  );
  return verbOk && nounOk;
}

export const v16N65Predicate: StepPredicate = (ctx): StepPredicateResult => {
  const internal: V16Internal = {
    ...emptyInternal(),
    ...(ctx.previousInternal as V16Internal ?? {}),
    channelEventIdsSinceEnter: [
      ...(((ctx.previousInternal as V16Internal)?.channelEventIdsSinceEnter) ?? []),
    ],
    postEnterSnaps: [
      ...(((ctx.previousInternal as V16Internal)?.postEnterSnaps) ?? []),
    ],
    inputEventIds: [
      ...(((ctx.previousInternal as V16Internal)?.inputEventIds) ?? []),
    ],
  };

  const prov = ctx.observation.provenance;
  const provMatch =
    prov.ropeSha256 === FIXTURE_PROVENANCE.ropeSha256 &&
    prov.decoderSchemaVersion === FIXTURE_PROVENANCE.decoderSchemaVersion &&
    prov.emulatorCommit === FIXTURE_PROVENANCE.emulatorCommit;
  if (!provMatch) return { completed: false, internal };

  const seq = matchAttemptScopedSequence(
    ctx.observation.recentInputs,
    V16_EXPECTED_KEY_SEQUENCE,
    ctx.attempt,
  );
  if (!seq.matched) return { completed: false, internal };
  internal.enterEventId = seq.completedAtEventId;
  internal.enterTick = seq.completedAtTick;
  internal.inputEventIds = [...seq.inputEventIds];

  // Collect post-ENTER channel events.
  const threshold = internal.enterEventId ?? -1;
  for (const ev of ctx.observation.recentChannelEvents) {
    if (ev.eventId <= threshold) continue;
    if (ev.channel !== 0o10 && ev.channel !== 0o11 && ev.channel !== 0o163) continue;
    if (!internal.channelEventIdsSinceEnter.includes(ev.eventId))
      internal.channelEventIdsSinceEnter.push(ev.eventId);
  }

  // Only observations strictly AFTER the ENTR press are eligible.
  if (
    internal.enterTick === null ||
    ctx.observation.tickIndex < internal.enterTick
  ) {
    return { completed: false, internal };
  }

  // Require VERB=[1,6] AND NOUN=[6,5] in the current observation.
  if (!verbNounStable(ctx.observation.decoded)) {
    // Displays are transient during writes; do not record this snapshot as
    // a stable-window sample. Do not fail either.
    return { completed: false, internal };
  }

  const n65 = readNoun65(
    ctx.observation.decoded.r1,
    ctx.observation.decoded.r2,
    ctx.observation.decoded.r3,
  );
  if (!n65.allValid) {
    // Unsupported relay glyph → refuse.
    return { completed: false, internal };
  }

  const snap: Snap = {
    tick: ctx.observation.tickIndex,
    missionTimeUs: ctx.observation.missionTimeUs,
    agcSteps: ctx.observation.snapshot?.totalAgcSteps ?? 0,
    n65Anchor: n65AnchorScalar(n65),
    checksum: decodedDskyCanonical(ctx.observation.decoded),
  };
  // Only snapshots with a usable Noun 65 progress anchor participate in the
  // stable-window monotone-advance check. Frames where R1/R2/R3 are entirely
  // blank produce anchor=null and cannot serve as evidence of forward time.
  if (snap.n65Anchor === null) {
    return { completed: false, internal };
  }
  internal.postEnterSnaps.push(snap);

  if (internal.postEnterSnaps.length < V16_MIN_POST_ENTER_OBSERVATIONS) {
    return { completed: false, internal };
  }

  // Verify monotone advance across the last N stable snapshots.
  const window = internal.postEnterSnaps.slice(
    -V16_MIN_POST_ENTER_OBSERVATIONS,
  );
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1]!;
    const b = window[i]!;
    if (b.tick <= a.tick) return { completed: false, internal };
    if (b.missionTimeUs <= a.missionTimeUs)
      return { completed: false, internal };
    if (b.agcSteps <= a.agcSteps) return { completed: false, internal };
    if (a.n65Anchor === null || b.n65Anchor === null)
      return { completed: false, internal };
    if (!(b.n65Anchor > a.n65Anchor)) return { completed: false, internal };
  }


  return {
    completed: true,
    internal,
    evidence: {
      satisfiedAtTick: ctx.observation.tickIndex,
      satisfiedAtMissionTimeUs: ctx.observation.missionTimeUs,
      inputEventIds: internal.inputEventIds,
      channelEventIds: [...internal.channelEventIdsSinceEnter],
      decodedStateChecksum: snap.checksum,
      fixtureId: V16_FIXTURE_ID,
      classification: "authentic-emulator",
      educationalInteractionOnly: false,
    },
  };
};

function n65AnchorScalar(n: ReturnType<typeof readNoun65>): number | null {
  const h = n.r1.partialValue;
  const m = n.r2.partialValue;
  const s = n.r3.partialValue;
  if (h !== null && m !== null && s !== null)
    return h * 10_000_000 + m * 100_000 + s;
  if (s !== null) return s;
  if (m !== null) return m * 100_000;
  if (h !== null) return h * 10_000_000;
  return null;
}
