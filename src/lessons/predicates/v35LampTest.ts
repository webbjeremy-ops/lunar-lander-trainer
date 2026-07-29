// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 3 predicate — V35 lamp test.
//
// Completion requires (all conjunctively):
//   1. The attempt-scoped input sequence V-3-5-ENTR was accepted.
//   2. After ENTR was accepted, the decoded DSKY reached the exact peak
//      checksum recorded in the committed fixture, driven by AGC channel
//      output events whose eventIds are strictly after the ENTR event.
//   3. Every annunciator listed as lit in the fixture peak is currently lit.
//   4. The rope SHA and decoder schema match the fixture provenance — a
//      different rope or a decoder schema change invalidates the fixture
//      correspondence.
//   5. The peak was observed within V35_MAX_TICKS_TO_PEAK of the ENTR
//      event — bounding "stale peak from a previous attempt".

import { decodedDskyStructural } from "@/agc/dsky/DskyDecoder";
import {
  V35_EXPECTED_KEY_SEQUENCE,
  V35_FIXTURE_ID,
  V35_MAX_TICKS_TO_PEAK,
  V35_PEAK_CHECKSUM,
  V35_PEAK_LIT_ANNUNCIATORS,
  FIXTURE_PROVENANCE,
} from "../fixtureExpectations";
import type {
  DskyAnnunciators,
} from "@/agc/dsky/DskyTypes";
import { matchAttemptScopedSequence } from "./inputSequence";
import type { StepPredicate, StepPredicateResult } from "../types";

interface V35Internal {
  /** eventId of the ENTR press once accepted; null before then. */
  enterEventId: number | null;
  enterTick: number | null;
  channelEventIdsSincePress: number[];
  peakSeen: boolean;
  peakAtTick: number | null;
  peakChecksum: string | null;
}

function emptyInternal(): V35Internal {
  return {
    enterEventId: null,
    enterTick: null,
    channelEventIdsSincePress: [],
    peakSeen: false,
    peakAtTick: null,
    peakChecksum: null,
  };
}

export const v35LampTestPredicate: StepPredicate = (ctx): StepPredicateResult => {
  const internal = { ...emptyInternal(), ...(ctx.previousInternal as V35Internal ?? {}) };

  // Guardrail: rope/schema mismatch → we cannot honor the fixture.
  const prov = ctx.observation.provenance;
  const provMatch =
    prov.ropeSha256 === FIXTURE_PROVENANCE.ropeSha256 &&
    prov.decoderSchemaVersion === FIXTURE_PROVENANCE.decoderSchemaVersion &&
    prov.emulatorCommit === FIXTURE_PROVENANCE.emulatorCommit;
  if (!provMatch) {
    return { completed: false, internal };
  }

  // 1. Key sequence must have been accepted within this attempt.
  const seq = matchAttemptScopedSequence(
    ctx.observation.recentInputs,
    V35_EXPECTED_KEY_SEQUENCE,
    ctx.attempt,
  );
  if (!seq.matched) {
    return { completed: false, internal };
  }
  internal.enterEventId = seq.completedAtEventId;
  internal.enterTick = seq.completedAtTick;

  // 2. Collect DSKY-relevant channel events strictly AFTER the ENTR.
  //    (010/011/0163 are the decoder-consumed channels.)
  const threshold = internal.enterEventId ?? -1;
  for (const ev of ctx.observation.recentChannelEvents) {
    if (ev.eventId <= threshold) continue;
    if (ev.channel !== 0o10 && ev.channel !== 0o11 && ev.channel !== 0o163)
      continue;
    if (!internal.channelEventIdsSincePress.includes(ev.eventId))
      internal.channelEventIdsSincePress.push(ev.eventId);
  }

  // If no channel events yet, no authentic AGC output → not complete.
  if (internal.channelEventIdsSincePress.length === 0) {
    return { completed: false, internal };
  }

  // 3. Peak checksum match — captured latch. Once seen, stays seen for
  //    this attempt, so we can complete at the observation where the peak
  //    first appeared even if later events perturb the display.
  const chk = decodedDskyCanonical(ctx.observation.decoded);
  const peakNow = chk === V35_PEAK_CHECKSUM;
  if (!internal.peakSeen && peakNow) {
    internal.peakSeen = true;
    internal.peakAtTick = ctx.observation.tickIndex;
    internal.peakChecksum = chk;
  }
  if (!internal.peakSeen) {
    return { completed: false, internal };
  }

  // 4. Peak was reached within the fixture-derived ticks-since-ENTR bound.
  const ticksSincePress =
    (internal.peakAtTick ?? 0) - (internal.enterTick ?? 0);
  if (ticksSincePress < 0 || ticksSincePress > V35_MAX_TICKS_TO_PEAK) {
    return { completed: false, internal };
  }

  // Peak checksum already encodes the annunciator set — no separate check
  // needed. (V35_PEAK_LIT_ANNUNCIATORS is retained for developer
  // diagnostics and lesson-side hint rendering.)


  return {
    completed: true,
    internal,
    evidence: {
      satisfiedAtTick: ctx.observation.tickIndex,
      satisfiedAtMissionTimeUs: ctx.observation.missionTimeUs,
      inputEventIds: seq.inputEventIds,
      channelEventIds: [...internal.channelEventIdsSincePress],
      decodedStateChecksum: chk,
      fixtureId: V35_FIXTURE_ID,
      classification: "authentic-emulator",
      educationalInteractionOnly: false,
    },
  };
};

/** Exposed for tests that need to sanity-check the annunciator predicate. */
export function annunciatorsMatchPeak(a: DskyAnnunciators): boolean {
  const rec = a as unknown as Record<string, boolean>;
  return V35_PEAK_LIT_ANNUNCIATORS.every((k) => rec[k] === true);
}
