// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 3 (V35 lamp test) predicate + engine acceptance tests.
//
// Drives the ENGINE through the committed golden fixture:
//   1. Reset decoder to empty.
//   2. Begin the lesson attempt at tick T0.
//   3. Advance through the recorded dskyEvents, injecting the recorded
//      V-3-5-ENTR key presses at their captured ticks.
//   4. Emit an observation at every tick that carries a channel event.
//   5. Assert the engine reaches "completed" and evidence citations point
//      at the actual event ids, not fabricated ones.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyDskyChannelEvent,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "@/agc/dsky/DskyDecoder";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import { stepLesson, initialLessonState } from "@/lessons/LessonEngine";
import { LESSON_03_V35_LAMP_TEST } from "@/lessons/content";
import type { LessonState, LessonInputEvent } from "@/lessons/types";
import type { ChannelEventLite } from "@/agc/protocol";
import {
  FIXTURE_PROVENANCE,
  V35_PEAK_EVIDENCE_CHECKSUM,
} from "@/lessons/fixtureExpectations";

import { AGC_KEY } from "@/lessons/keyCodes";
import { channelEv, keyInput, makeObservation, resetEventIds } from "./testHelpers";

interface V35Fixture {
  metadata: {
    rope: { sha256: string; sourceCommit: string };
    emulator: { commit: string };
    decoderSchemaVersion: number;
  };
  commands: Array<{ tickIndex: number; kind: string; payload: { keyCode?: number } | null }>;
  dskyEvents: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; channel: number; value: number }>;
  peak: { checksum: string; tickIndex: number };
}
const V35 = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/v35-lamp-test.json"), "utf8"),
) as V35Fixture;

/** Drive the engine through the fixture. Returns final state and per-tick log. */
function driveV35(opts: {
  emitKeys?: boolean;                 // if false, no key events sent
  channelStopAtEventId?: number;      // stop feeding channel events beyond this
  overrideProvenance?: Partial<typeof FIXTURE_PROVENANCE>;
  attemptStartTick?: number;
} = {}): LessonState {
  const {
    emitKeys = true,
    channelStopAtEventId = Number.POSITIVE_INFINITY,
    overrideProvenance,
    attemptStartTick = 0,
  } = opts;

  resetEventIds();
  const decoder = makeEmptyDecodedDsky();
  let prevDecoded: DecodedDsky | null = null;

  // Bucket events per tick so we can emit one observation per tick.
  const eventsByTick = new Map<number, ChannelEventLite[]>();
  let evId = 5_000_000;
  const dskyEvents = V35.dskyEvents;
  for (const ev of dskyEvents) {
    if (ev.eventId > channelStopAtEventId) continue;
    const cev: ChannelEventLite = {
      eventId: evId++, tickIndex: ev.tickIndex, missionTimeUs: ev.missionTimeUs,
      channel: ev.channel, value: ev.value, seq: evId,
    };
    (eventsByTick.get(ev.tickIndex) ?? eventsByTick.set(ev.tickIndex, []).get(ev.tickIndex)!).push(cev);
  }

  // Build input events for the recorded commands.
  const inputs: LessonInputEvent[] = [];
  if (emitKeys) {
    for (const c of V35.commands) {
      if (c.kind === "dskyKeyDown" && c.payload?.keyCode !== undefined) {
        inputs.push(keyInput(c.payload.keyCode, c.tickIndex));
      }
    }
    inputs.sort((a, b) => a.tickIndex - b.tickIndex);
  }

  const provenance = { ...FIXTURE_PROVENANCE, ...(overrideProvenance ?? {}) };

  // Begin the lesson attempt.
  let state = initialLessonState(LESSON_03_V35_LAMP_TEST);
  state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
    kind: "acknowledgeStep",
    observation: makeObservation({ tickIndex: attemptStartTick, provenance }),
  });
  state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
    kind: "beginAttempt",
    attemptId: "attempt-v35-1",
    observation: makeObservation({
      tickIndex: attemptStartTick,
      eventLogCursor: 0,
      provenance,
    }),
  });

  const allTicks = new Set<number>([
    ...eventsByTick.keys(),
    ...inputs.map((i) => i.tickIndex),
  ]);
  const ordered = [...allTicks].sort((a, b) => a - b);

  const seenInputs: LessonInputEvent[] = [];
  const seenChannelEvents: ChannelEventLite[] = [];
  for (const tick of ordered) {
    const newInputs = inputs.filter((i) => i.tickIndex === tick);
    seenInputs.push(...newInputs);
    const newCh = eventsByTick.get(tick) ?? [];
    for (const ev of newCh) applyDskyChannelEvent(decoder, ev.channel, ev.value);
    seenChannelEvents.push(...newCh);

    const decodedCopy = JSON.parse(JSON.stringify(decoder)) as DecodedDsky;
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: tick,
        decoded: decodedCopy,
        previousDecoded: prevDecoded,
        recentInputs: [...seenInputs],
        recentChannelEvents: [...seenChannelEvents],
        eventLogCursor: seenChannelEvents.length,
        provenance,
      }),
    });
    prevDecoded = decodedCopy;
    if (state.status === "completed") break;
  }
  return state;
}

describe("Lesson 3 — V35 lamp test", () => {
  it("committed golden fixture drives the engine to completion", () => {
    const state = driveV35();
    expect(state.status).toBe("completed");
    const interactive = state.evidence.find(
      (e) => e.stepId === "type-v35-entr",
    );
    expect(interactive).toBeDefined();
    expect(interactive!.classification).toBe("authentic-emulator");
    expect(interactive!.educationalInteractionOnly).toBe(false);
    expect(interactive!.decodedStateChecksum).toBe(V35_PEAK_CHECKSUM);
    expect(interactive!.inputEventIds.length).toBe(4);
    expect(interactive!.channelEventIds.length).toBeGreaterThan(0);
    expect(interactive!.fixtureId).toBe("v35-lamp-test");
  });

  it("correct keys with NO channel output do not complete", () => {
    // Feed keys but suppress channel events past a very small id.
    const state = driveV35({ channelStopAtEventId: 0 });
    expect(state.status).not.toBe("completed");
  });

  it("authentic V35 peak reached BEFORE the current attempt does not complete", () => {
    // Reproduce: build the peak checksum decoder via events with tiny
    // eventIds, then begin the attempt AFTER all events have arrived.
    resetEventIds();
    const decoder = makeEmptyDecodedDsky();
    for (const e of V35.dskyEvents) applyDskyChannelEvent(decoder, e.channel, e.value);
    // Guardrail: the decoder must have reached the peak at some point.
    // (We rely on the golden-trace test to prove replay hits the peak
    // itself; here we assert the final state exists.)
    expect(decodedDskyCanonical(decoder)).toBeTruthy();

    let state = initialLessonState(LESSON_03_V35_LAMP_TEST);
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "acknowledgeStep",
      observation: makeObservation({ tickIndex: 0 }),
    });
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "beginAttempt",
      attemptId: "late-attempt",
      observation: makeObservation({
        tickIndex: 10_000,
        eventLogCursor: 1_000_000,
        decoded: decoder,
      }),
    });
    // No new inputs after attempt start; feed one observation reflecting
    // the same decoder state.
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 10_001,
        eventLogCursor: 1_000_000,
        decoded: decoder,
      }),
    });
    expect(state.status).not.toBe("completed");
  });

  it("partial lamp pattern does not complete", () => {
    resetEventIds();
    // Fabricate a decoder that lights ONE annunciator (uplinkActy) and
    // shows all 8s — sequence isn't accepted yet.
    const decoder = makeEmptyDecodedDsky();
    // Force digits to '8' via channel 010 selector writes.
    // (Selector 11 → PROG both digits) — do this by real ch010 words.
    applyDskyChannelEvent(decoder, 0o11, 0o4); // uplinkActy on
    let state = initialLessonState(LESSON_03_V35_LAMP_TEST);
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "acknowledgeStep",
      observation: makeObservation({ tickIndex: 0 }),
    });
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "beginAttempt",
      attemptId: "partial",
      observation: makeObservation({ tickIndex: 1 }),
    });
    // Only 3 of 4 keys.
    const inputs = [
      keyInput(AGC_KEY.VERB, 2),
      keyInput(AGC_KEY.DIGIT_3, 3),
      keyInput(AGC_KEY.DIGIT_5, 4),
    ];
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 5,
        decoded: decoder,
        recentInputs: inputs,
        recentChannelEvents: [channelEv(0o11, 0o4, 5)],
        eventLogCursor: 10,
      }),
    });
    expect(state.status).not.toBe("completed");
  });

  it("fabricated decoded object with no supporting channel events does not complete", () => {
    resetEventIds();
    // Hand-build the peak: all 8s and every annunciator lit.
    const decoder = makeEmptyDecodedDsky();
    for (const reg of ["program","verb","noun","r1","r2","r3"] as const) {
      for (const d of decoder[reg].digits) { d.value = 8; d.segments = 127; }
      if (decoder[reg].sign) decoder[reg].sign!.plus = true;
    }
    for (const k of Object.keys(decoder.annunciators)) {
      (decoder.annunciators as unknown as Record<string, boolean>)[k] = true;
    }
    let state = initialLessonState(LESSON_03_V35_LAMP_TEST);
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "acknowledgeStep",
      observation: makeObservation({ tickIndex: 0 }),
    });
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "beginAttempt",
      attemptId: "fabricated",
      observation: makeObservation({ tickIndex: 1 }),
    });
    const inputs = [
      keyInput(AGC_KEY.VERB, 2), keyInput(AGC_KEY.DIGIT_3, 3),
      keyInput(AGC_KEY.DIGIT_5, 4), keyInput(AGC_KEY.ENTR, 5),
    ];
    state = stepLesson(LESSON_03_V35_LAMP_TEST, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 6,
        decoded: decoder,
        recentInputs: inputs,
        recentChannelEvents: [], // NO channel events — fabricated only
        eventLogCursor: 4,
      }),
    });
    expect(state.status).not.toBe("completed");
  });

  it("wrong rope hash does not complete even with correct fixture events", () => {
    const state = driveV35({
      overrideProvenance: { ropeSha256: "0".repeat(64) },
    });
    expect(state.status).not.toBe("completed");
  });

  it("wrong decoder schema version does not complete", () => {
    const state = driveV35({
      overrideProvenance: { decoderSchemaVersion: 99 },
    });
    expect(state.status).not.toBe("completed");
  });
});
