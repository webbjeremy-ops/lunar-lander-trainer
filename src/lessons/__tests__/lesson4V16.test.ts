// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 4 (V16 N65) predicate tests.
//
// The committed V16 fixture records only two snapshot samples with
// verb/noun in a mid-decode state; it does not preserve a raw
// dskyEvent stream that would let the pure decoder settle to VERB=16 /
// NOUN=65 through replay. The lesson's predicate is therefore validated
// with hand-constructed decoder states that mirror what an authentic
// V16 N65 monitor cycle would produce, plus assertions that the
// committed fixture's provenance matches lesson expectations.
//
// Documented ambiguity: see docs/M2_2_LESSONENGINE_REPORT.md.

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

const V16 = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/v16-n65-met.json"), "utf8"),
) as { metadata: { rope: { sha256: string }; emulator: { commit: string } } };

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
  // r3 is 5 digits: ss.cc → represent as 5-digit integer
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

describe("Lesson 4 — V16 N65 mission time", () => {
  it("committed V16 fixture provenance matches lesson expectations", () => {
    expect(V16.metadata.rope.sha256).toBe(FIXTURE_PROVENANCE.ropeSha256);
    expect(V16.metadata.emulator.commit).toBe(FIXTURE_PROVENANCE.emulatorCommit);
  });

  it("valid sequence + advancing V16 N65 display completes the lesson", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs: LessonInputEvent[] = [
      keyInput(AGC_KEY.VERB, 5),
      keyInput(AGC_KEY.DIGIT_1, 10),
      keyInput(AGC_KEY.DIGIT_6, 15),
      keyInput(AGC_KEY.NOUN, 20),
      keyInput(AGC_KEY.DIGIT_6, 25),
      keyInput(AGC_KEY.DIGIT_5, 30),
      keyInput(AGC_KEY.ENTR, 35),
    ];
    const channels: ChannelEventLite[] = [
      channelEv(0o10, 0o12345, 40),
      channelEv(0o10, 0o12346, 41),
    ];
    // Observation 1: stable V16 N65, r3=00100
    state = stepLesson(LESSON_04_V16_N65, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 40,
        decoded: makeV16Display(100),
        recentInputs: inputs,
        recentChannelEvents: channels,
        eventLogCursor: 20,
        snapshot: { totalAgcSteps: 100_000 },
      }),
    });
    expect(state.status).not.toBe("completed");
    // Observation 2: stable V16 N65, r3=00200 (advanced), tick/steps up
    state = stepLesson(LESSON_04_V16_N65, state, {
      kind: "observe",
      observation: makeObservation({
        tickIndex: 45,
        decoded: makeV16Display(200),
        recentInputs: inputs,
        recentChannelEvents: [
          ...channels,
          channelEv(0o10, 0o12347, 44),
        ],
        eventLogCursor: 21,
        snapshot: { totalAgcSteps: 100_500 },
      }),
    });
    expect(state.status).toBe("completed");
    const ev = state.evidence.find((e) => e.stepId === "type-v16-n65-entr");
    expect(ev).toBeDefined();
    expect(ev!.classification).toBe("authentic-emulator");
    expect(ev!.inputEventIds).toHaveLength(7);
    expect(ev!.channelEventIds.length).toBeGreaterThan(0);
    expect(ev!.fixtureId).toBe("v16-n65-met");
  });

  it("VERB/NOUN stable but display NOT advancing does not complete", () => {
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
          decoded: makeV16Display(100), // same value both times
          recentInputs: inputs,
          recentChannelEvents: ch,
          eventLogCursor: 20,
          snapshot: { totalAgcSteps: 100_000 + t },
        }),
      });
    }
    expect(state.status).not.toBe("completed");
  });

  it("register change BEFORE Enter does not complete", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    // Only VERB pressed. Provide advancing display.
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

  it("unsupported relay glyph in a register prevents completion", () => {
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
      // Corrupt one r3 digit: segments != 0 but value === null (unsupported code).
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

  it("restart clears prior attempt evidence and requires new inputs", () => {
    resetEventIds();
    let state = ackReading(initialLessonState(LESSON_04_V16_N65));
    state = beginAttempt(state);
    const inputs: LessonInputEvent[] = [
      keyInput(AGC_KEY.VERB, 5), keyInput(AGC_KEY.DIGIT_1, 10),
      keyInput(AGC_KEY.DIGIT_6, 15), keyInput(AGC_KEY.NOUN, 20),
      keyInput(AGC_KEY.DIGIT_6, 25), keyInput(AGC_KEY.DIGIT_5, 30),
      keyInput(AGC_KEY.ENTR, 35),
    ];
    // Restart at tick 100 with cursor beyond all old input eventIds.
    state = stepLesson(LESSON_04_V16_N65, state, {
      kind: "restart",
      attemptId: "attempt-2",
      observation: makeObservation({
        tickIndex: 100,
        eventLogCursor: 99_999,
      }),
    });
    expect(state.evidence).toEqual([]);
    // Feed stale inputs — must NOT complete (their eventIds are pre-restart).
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

  it("identical action streams yield byte-identical evidence (determinism)", () => {
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
    // Freeze eventIds by resetting inside each run — ids should match.
    const a = runOnce();
    const b = runOnce();
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
  });
});
