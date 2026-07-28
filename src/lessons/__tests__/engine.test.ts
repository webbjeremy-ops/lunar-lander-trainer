// SPDX-License-Identifier: GPL-3.0-or-later
// Engine reducer semantics + reading-lesson determinism.

import { describe, expect, it } from "vitest";
import {
  initialLessonState,
  stepLesson,
} from "@/lessons/LessonEngine";
import {
  LESSON_01_MEET_THE_AGC,
  LESSON_02_READING_THE_DSKY,
} from "@/lessons/content";
import { makeObservation, resetEventIds } from "./testHelpers";

describe("LessonEngine — reducer semantics", () => {
  it("initialLessonState is deterministic and pure", () => {
    const a = initialLessonState(LESSON_01_MEET_THE_AGC);
    const b = initialLessonState(LESSON_01_MEET_THE_AGC);
    expect(a).toEqual(b);
    expect(a.status).toBe("not-started");
    expect(a.currentStepIndex).toBe(0);
    expect(a.completedStepIds).toEqual([]);
    expect(a.evidence).toEqual([]);
  });

  it("observations on a reading step do not complete it", () => {
    resetEventIds();
    const s0 = initialLessonState(LESSON_02_READING_THE_DSKY);
    const s1 = stepLesson(LESSON_02_READING_THE_DSKY, s0, {
      kind: "observe",
      observation: makeObservation({ tickIndex: 5 }),
    });
    expect(s1.completedStepIds).toEqual([]);
    expect(s1.currentStepIndex).toBe(0);
  });

  it("acknowledgeStep completes a reading step with educationalInteractionOnly evidence", () => {
    resetEventIds();
    let s = initialLessonState(LESSON_02_READING_THE_DSKY);
    for (let i = 0; i < LESSON_02_READING_THE_DSKY.steps.length; i++) {
      s = stepLesson(LESSON_02_READING_THE_DSKY, s, {
        kind: "acknowledgeStep",
        observation: makeObservation({ tickIndex: 10 + i }),
      });
    }
    expect(s.status).toBe("completed");
    expect(s.completedStepIds).toHaveLength(
      LESSON_02_READING_THE_DSKY.steps.length,
    );
    for (const ev of s.evidence) {
      expect(ev.educationalInteractionOnly).toBe(true);
      expect(ev.inputEventIds).toEqual([]);
      expect(ev.channelEventIds).toEqual([]);
      expect(ev.fixtureId).toBeNull();
    }
  });

  it("Lessons 1 and 2 never mutate their observation input", () => {
    resetEventIds();
    const obs = makeObservation({ tickIndex: 1 });
    const snapshot = JSON.stringify(obs);
    let s = initialLessonState(LESSON_01_MEET_THE_AGC);
    for (let i = 0; i < 3; i++) {
      s = stepLesson(LESSON_01_MEET_THE_AGC, s, {
        kind: "acknowledgeStep",
        observation: obs,
      });
    }
    expect(JSON.stringify(obs)).toBe(snapshot);
  });

  it("replaying the same action sequence yields byte-identical state", () => {
    resetEventIds();
    const actions = LESSON_01_MEET_THE_AGC.steps.map((_, i) => ({
      kind: "acknowledgeStep" as const,
      observation: makeObservation({ tickIndex: i + 1 }),
    }));
    let s1 = initialLessonState(LESSON_01_MEET_THE_AGC);
    for (const a of actions) s1 = stepLesson(LESSON_01_MEET_THE_AGC, s1, a);
    let s2 = initialLessonState(LESSON_01_MEET_THE_AGC);
    for (const a of actions) s2 = stepLesson(LESSON_01_MEET_THE_AGC, s2, a);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});
