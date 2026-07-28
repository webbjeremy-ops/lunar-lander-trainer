// SPDX-License-Identifier: GPL-3.0-or-later
// Lessons 5 and 6 are reading-only. These tests prove:
//   1. They are pure content — every step cites at least one registered source.
//   2. They never mutate AGC state (no interactive predicate).
//   3. Their worked examples reproduce from the committed V35 fixture.
//   4. The engine completes them via explicit acknowledgment only.

import { describe, expect, it } from "vitest";
import {
  LESSON_05_DECODING_CH010,
  LESSON_06_ANNUNCIATORS,
} from "@/lessons/content";
import { SOURCE_REGISTRY } from "@/lessons/SourceRegistry";
import { initialLessonState, stepLesson } from "@/lessons/LessonEngine";
import { parseCh010 } from "@/agc/dsky/DskyChannelMap";
import { makeObservation, resetEventIds } from "./testHelpers";
import v35 from "../../../tests/fixtures/v35-lamp-test.json";

describe("Lesson 5 — Decoding Channel 010", () => {
  it("every step is reading-only, cites at least one registered source, and has a valid classification", () => {
    for (const step of LESSON_05_DECODING_CH010.steps) {
      expect(step.kind).toBe("reading");
      expect(step.sources.length).toBeGreaterThan(0);
      for (const s of step.sources) {
        expect(SOURCE_REGISTRY[s.id], `unregistered source id ${s.id}`).toBeDefined();
      }
      expect(["historically-grounded", "educational-visualization"]).toContain(
        step.classification,
      );
    }
  });

  it("worked-example PROG '88' word 0o55675 decodes as claimed and is present in the V35 fixture", () => {
    const p = parseCh010(0o55675);
    expect(p.selector).toBe(11);
    expect(p.sign).toBe(0);
    expect(p.codeA).toBe(29);
    expect(p.codeB).toBe(29);
    const evs = (v35 as { dskyEvents: { channel: number; value: number }[] }).dskyEvents;
    expect(evs.some((e) => e.channel === 0o10 && e.value === 0o55675)).toBe(true);
  });

  it("worked-example R1 word 0o37675 decodes with R1-PLUS asserted and is present in the V35 fixture", () => {
    const p = parseCh010(0o37675);
    expect(p.selector).toBe(7);
    expect(p.sign).toBe(1);
    expect(p.codeA).toBe(29);
    expect(p.codeB).toBe(29);
    const evs = (v35 as { dskyEvents: { channel: number; value: number }[] }).dskyEvents;
    expect(evs.some((e) => e.channel === 0o10 && e.value === 0o37675)).toBe(true);
  });

  it("engine completes the lesson only through explicit acknowledgment, never from observations alone", () => {
    resetEventIds();
    let s = initialLessonState(LESSON_05_DECODING_CH010);
    // Observations should not advance a reading lesson.
    for (let i = 0; i < 5; i++) {
      s = stepLesson(LESSON_05_DECODING_CH010, s, {
        kind: "observe",
        observation: makeObservation({ tickIndex: i }),
      });
    }
    expect(s.completedStepIds).toEqual([]);
    // Explicit acknowledgment walks the steps.
    for (let i = 0; i < LESSON_05_DECODING_CH010.steps.length; i++) {
      s = stepLesson(LESSON_05_DECODING_CH010, s, {
        kind: "acknowledgeStep",
        observation: makeObservation({ tickIndex: 100 + i }),
      });
    }
    expect(s.status).toBe("completed");
    expect(s.evidence.every((e) => e.educationalInteractionOnly)).toBe(true);
  });
});

describe("Lesson 6 — Annunciators", () => {
  it("every step is reading-only and cites at least one registered source", () => {
    for (const step of LESSON_06_ANNUNCIATORS.steps) {
      expect(step.kind).toBe("reading");
      expect(step.sources.length).toBeGreaterThan(0);
      for (const s of step.sources) {
        expect(SOURCE_REGISTRY[s.id], `unregistered source id ${s.id}`).toBeDefined();
      }
    }
  });

  it("engine completes the lesson only through explicit acknowledgment", () => {
    resetEventIds();
    let s = initialLessonState(LESSON_06_ANNUNCIATORS);
    for (let i = 0; i < LESSON_06_ANNUNCIATORS.steps.length; i++) {
      s = stepLesson(LESSON_06_ANNUNCIATORS, s, {
        kind: "acknowledgeStep",
        observation: makeObservation({ tickIndex: 200 + i }),
      });
    }
    expect(s.status).toBe("completed");
    expect(s.evidence.every((e) => e.educationalInteractionOnly)).toBe(true);
  });
});
