// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 4 (V16 N65) predicate tests.
//
// AUTHORITATIVE test: `authentic fixture stream completes Lesson 4` replays
// the committed V16 golden trace — real Worker output, real Luminary099,
// real Ch010/011/0163 relay events — through the pure LessonEngine and
// asserts completion. This is Step 3.1's acceptance criterion.
//
// The remaining tests are labelled `[synthetic]` and use hand-constructed
// decoded frames to isolate individual failure modes (missing progression,
// pre-Enter input, unsupported glyphs, restart-cursor scoping, determinism).
// They are focused predicate unit tests, not milestone acceptance.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialLessonState, stepLesson } from "@/lessons/LessonEngine";
import { LESSON_04_V16_N65 } from "@/lessons/content";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import type { DecodedDsky, DskyRegister } from "@/agc/dsky/DskyTypes";
import { AGC_KEY } from "@/lessons/keyCodes";
import {
  channelEv,
  keyInput,
  makeObservation,
  resetEventIds,
} from "./testHelpers";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";
import type { LessonInputEvent, LessonState } from "@/lessons/types";
import type { ChannelEventLite } from "@/agc/protocol";

interface V16Fixture {
  metadata: {
    rope: { sha256: string };
    emulator: { commit: string };
    decoderSchemaVersion: number;
    enterTick: number;
    enterEventId: number | null;
  };
  commands: Array<{ tickIndex: number; missionTimeUs: number; kind: string; payload: { keyCode?: number } | null }>;
  dskyEvents: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; channel: number; value: number }>;
  decodedTimeline: Array<{ tickIndex: number; missionTimeUs: number; decoded: DecodedDsky; checksum: string }>;
  stableCheckpoints: Array<{ tickIndex: number; missionTimeUs: number; checksum: string; r3Anchor: number }>;
}

const V16 = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/v16-n65-met.json"), "utf8"),
) as V16Fixture;

function setDigits(reg: DskyRegister, values: readonly (number | null)[]) {
  values.forEach((v, i) => {
    reg.digits[i]!.value = v;
    reg.digits[i]!.segments = v === null ? 0 : 127;
  });
}

function makeV16Display(r3Seconds: number): DecodedDsky {
  const dec = makeEmptyDecodedDsky();
  setDigits(dec.verb, [1, 6]);
  setDigits(dec.noun, [6, 5]);
  setDigits(dec.r1, [0, 0, 0, 0, 0]);
  setDigits(dec.r2, [0, 0, 0, 0, 0]);
  const s = Math.max(0, Math.min(99999, Math.floor(r3Seconds))).toString().padStart(5, "0");
  setDigits(dec.r3, s.split("").map((c) => Number(c)));
  return dec;
}

function beginAttempt(state: LessonState) {
  return stepLesson(LESSON_04_V16_N65, state, {
    kind: "beginAttempt",
    attemptId: "v16-attempt",
    observation: makeObservation({ tickIndex: 0, eventLogCursor: 0 }),
  });
}

function ackReading(state: LessonState) {
  return stepLesson(LESSON_04_V16_N65, state, {
    kind: "acknowledgeStep",
    observation: makeObservation({ tickIndex: 0 }),
  });
}

// —— Authoritative fixture-driven acceptance —————————————————————————————
describe("Lesson 4 — authentic V16 N65 fixture", () => {
  it("committed fixture provenance matches lesson expectations", () => {
    expect(V16.metadata.rope.sha256).toBe(FIXTURE_PROVENANCE.ropeSha256);
    expect(V16.metadata.emulator.commit).toBe(FIXTURE_PROVENANCE.emulatorCommit);
    expect(V16.metadata.decoderSchemaVersion).toBe(FIXTURE_PROVENANCE.decoderSchemaVersion);
    expect(V16.stableCheckpoints.length).toBeGreaterThanOrEqual(3);
  });

  it("real fixture observation stream completes Lesson 4 with authentic evidence", () => {
    // Build lesson-scoped inputs from the fixture's recorded command stream.
    // The 7 dskyKeyDown commands captured by /capture are the *same* inputs
    // that produced every downstream Ch010 event in this fixture. Assign
    // eventIds strictly less than the first captured dskyEvent so
    // matchAttemptScopedSequence sees them as pre-channel input.
    const keyCmds = V16.commands.filter(
      (c) => c.kind === "dskyKeyDown" && typeof c.payload?.keyCode === "number",
    );
    expect(keyCmds.length).toBe(7);
    const firstEventId = V16.dskyEvents[0]?.eventId ?? 100;
    const inputs: LessonInputEvent[] = keyCmds.map((c, i) => ({
      eventId: i + 1, // 1..7, all < firstEventId (guaranteed >= 100)
      tickIndex: c.tickIndex,
      missionTimeUs: c.missionTimeUs,
      kind: "dskyKeyDown",
      keyCode: c.payload!.keyCode as number,
    }));
    expect(firstEventId).toBeGreaterThan(inputs[inputs.length - 1]!.eventId);

    // Convert fixture dskyEvents to ChannelEventLite; predicate reads
    // recentChannelEvents to collect post-Enter event ids for evidence.
    const allChannel: ChannelEventLite[] = V16.dskyEvents.map((e) => ({
      eventId: e.eventId,
      tickIndex: e.tickIndex,
      missionTimeUs: e.missionTimeUs,
      channel: e.channel,
      value: e.value,
      seq: e.eventId,
    }));

    let state: LessonState = initialLessonState(LESSON_04_V16_N65);
    state = ackReading(state);
    state = beginAttempt(state);

    // Drive one observe() per captured decoded frame that lies at or after
    // the recorded Enter tick. This mirrors what the live app would feed
    // the engine while the AGC executes the monitor loop.
    const enterTick = V16.metadata.enterTick;
    for (const rec of V16.decodedTimeline) {
      if (rec.tickIndex < enterTick) continue;
      const recentChannelEvents = allChannel.filter((e) => e.tickIndex <= rec.tickIndex);
      state = stepLesson(LESSON_04_V16_N65, state, {
        kind: "observe",
        observation: makeObservation({
          tickIndex: rec.tickIndex,
          missionTimeUs: rec.missionTimeUs,
          decoded: rec.decoded,
          recentInputs: inputs,
          recentChannelEvents,
          eventLogCursor: (recentChannelEvents.at(-1)?.eventId ?? 0) + 1,
          snapshot: { totalAgcSteps: rec.tickIndex * 1706 + 1 },
        }),
      });
      if (state.status === "completed") break;
    }

    expect(state.status).toBe("completed");
    const ev = state.evidence.find((e) => e.stepId === "type-v16-n65-entr");
    expect(ev, "lesson evidence for V16 step must be recorded").toBeDefined();
    expect(ev!.classification).toBe("authentic-emulator");
    expect(ev!.fixtureId).toBe("v16-n65-met");
    expect(ev!.inputEventIds).toHaveLength(7);
    // Every recorded channel-event id must exist in the authentic fixture.
    const fixtureIds = new Set(V16.dskyEvents.map((e) => e.eventId));
    for (const id of ev!.channelEventIds) expect(fixtureIds.has(id)).toBe(true);
    // Evidence checksum must appear in the fixture's decoded timeline.
    const timelineChecksums = new Set(V16.decodedTimeline.map((r) => r.checksum));
    expect(timelineChecksums.has(ev!.decodedStateChecksum)).toBe(true);
    // Provenance carried through unchanged.
    expect(ev!.ropeSha256).toBe(FIXTURE_PROVENANCE.ropeSha256);
    expect(ev!.emulatorCommit).toBe(FIXTURE_PROVENANCE.emulatorCommit);
  });
});

// —— [synthetic] focused predicate unit tests ————————————————————————————
describe("Lesson 4 — [synthetic] predicate false-completion coverage", () => {
  it("[synthetic] VERB/NOUN stable but display NOT advancing does not complete", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs: LessonInputEvent[] = [
      keyInput(AGC_KEY.VERB, 5), keyInput(AGC_KEY.DIGIT_1, 10),
      keyInput(AGC_KEY.DIGIT_6, 15), keyInput(AGC_KEY.NOUN, 20),
      keyInput(AGC_KEY.DIGIT_6, 25), keyInput(AGC_KEY.DIGIT_5, 30),
      keyInput(AGC_KEY.ENTR, 35),
    ];
    const ch = [channelEv(0o10, 0o12345, 40)];
    for (const t of [40, 45]) {
      state = stepLesson(LESSON_04_V16_N65, state, {
        kind: "observe",
        observation: makeObservation({
          tickIndex: t,
          decoded: makeV16Display(100),
          recentInputs: inputs,
          recentChannelEvents: ch,
          eventLogCursor: 20,
          snapshot: { totalAgcSteps: 100_000 + t },
        }),
      });
    }
    expect(state.status).not.toBe("completed");
  });

  it("[synthetic] register change BEFORE Enter does not complete", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs = [keyInput(AGC_KEY.VERB, 5)];
    for (const [t, r3] of [[10, 100], [15, 200]] as const) {
      state = stepLesson(LESSON_04_V16_N65, state, {
        kind: "observe",
        observation: makeObservation({
          tickIndex: t,
          decoded: makeV16Display(r3),
          recentInputs: inputs,
          recentChannelEvents: [channelEv(0o10, 0o1, t)],
          eventLogCursor: 5,
          snapshot: { totalAgcSteps: 10_000 * t },
        }),
      });
    }
    expect(state.status).not.toBe("completed");
  });

  it("[synthetic] unsupported relay glyph in a register prevents completion", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs: LessonInputEvent[] = [
      keyInput(AGC_KEY.VERB, 5), keyInput(AGC_KEY.DIGIT_1, 10),
      keyInput(AGC_KEY.DIGIT_6, 15), keyInput(AGC_KEY.NOUN, 20),
      keyInput(AGC_KEY.DIGIT_6, 25), keyInput(AGC_KEY.DIGIT_5, 30),
      keyInput(AGC_KEY.ENTR, 35),
    ];
    for (const [t, r3] of [[40, 100], [45, 200]] as const) {
      const dec = makeV16Display(r3);
      dec.r3.digits[0]!.value = null;
      dec.r3.digits[0]!.segments = 42;
      state = stepLesson(LESSON_04_V16_N65, state, {
        kind: "observe",
        observation: makeObservation({
          tickIndex: t,
          decoded: dec,
          recentInputs: inputs,
          recentChannelEvents: [channelEv(0o10, 0o1, t)],
          eventLogCursor: 20,
          snapshot: { totalAgcSteps: 10_000 * t },
        }),
      });
    }
    expect(state.status).not.toBe("completed");
  });

  it("[synthetic] restart clears prior attempt evidence and rejects stale inputs", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs: LessonInputEvent[] = [
      keyInput(AGC_KEY.VERB, 5), keyInput(AGC_KEY.DIGIT_1, 10),
      keyInput(AGC_KEY.DIGIT_6, 15), keyInput(AGC_KEY.NOUN, 20),
      keyInput(AGC_KEY.DIGIT_6, 25), keyInput(AGC_KEY.DIGIT_5, 30),
      keyInput(AGC_KEY.ENTR, 35),
    ];
    state = stepLesson(LESSON_04_V16_N65, state, {
      kind: "restart",
      attemptId: "attempt-2",
      observation: makeObservation({ tickIndex: 100, eventLogCursor: 99_999 }),
    });
    expect(state.evidence).toEqual([]);
    state = stepLesson(LESSON_04_V16_N65, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 110,
        decoded: makeV16Display(100),
        recentInputs: inputs,
        recentChannelEvents: [channelEv(0o10, 0o1, 110)],
        eventLogCursor: 100_000,
        snapshot: { totalAgcSteps: 500_000 },
      }),
    });
    expect(state.status).not.toBe("completed");
  });

  it("[synthetic] identical action streams yield byte-identical evidence (determinism)", () => {
    const runOnce = () => {
      resetEventIds();
      let s = ackReading(initialLessonState(LESSON_04_V16_N65));
      s = beginAttempt(s);
      const inputs: LessonInputEvent[] = [
        keyInput(AGC_KEY.VERB, 5), keyInput(AGC_KEY.DIGIT_1, 10),
        keyInput(AGC_KEY.DIGIT_6, 15), keyInput(AGC_KEY.NOUN, 20),
        keyInput(AGC_KEY.DIGIT_6, 25), keyInput(AGC_KEY.DIGIT_5, 30),
        keyInput(AGC_KEY.ENTR, 35),
      ];
      const ch = [channelEv(0o10, 0o1, 40), channelEv(0o10, 0o2, 41)];
      for (const [t, r3] of [[40, 100], [45, 200]] as const) {
        s = stepLesson(LESSON_04_V16_N65, s, {
          kind: "observe",
          observation: makeObservation({
            tickIndex: t, decoded: makeV16Display(r3),
            recentInputs: inputs, recentChannelEvents: ch,
            eventLogCursor: 21, snapshot: { totalAgcSteps: 100_000 + t },
          }),
        });
      }
      return s;
    };
    const a = runOnce();
    const b = runOnce();
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
  });
});
