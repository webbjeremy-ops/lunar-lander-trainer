// SPDX-License-Identifier: GPL-3.0-or-later
//
// M2.2 Step 5 regression suite — parent state committer.
//
// applyLessonStateUpdate is the pure function pulled out of the /learn
// route's handleLessonState callback. These tests pin the two invariants
// that Branch B (mis-routed completion) and the delayed-prop downgrade
// bug exposed:
//
//   (a) Writes are keyed by `next.lessonId`, so a persistent LessonHost
//       listener created during Lesson 1 that eventually completes
//       Lesson 3 or Lesson 4 lands in the correct bucket — never in
//       Lesson 1's bucket.
//   (b) A `completed` attempt is terminal for its attemptId; a delayed
//       or stale callback carrying an earlier status for the same
//       attempt cannot downgrade the parent bucket back to
//       `in-progress`.
//
// The Playwright /learn suite exercises the end-to-end path; these
// tests pin the specific reducer so future refactors cannot regress
// the invariants silently.

import { describe, expect, it } from "vitest";
import { applyLessonStateUpdate } from "@/routes/learn";
import type { LessonState } from "@/lessons/types";

function makeState(
  lessonId: string,
  status: LessonState["status"],
  attemptId: string | null,
  currentStepIndex = 0,
  evidenceLen = 0,
): LessonState {
  return {
    lessonId,
    status,
    attempt: attemptId
      ? {
          attemptId,
          startedAtTick: 0,
          startedAtCursor: 0,
          startedAtMissionTimeUs: 0,
          startDecodedChecksum: "seed",
        }
      : null,
    currentStepIndex,
    completedStepIds: [],
    evidence: Array.from({ length: evidenceLen }, (_, i) => ({
      lessonId,
      stepId: `s${i}`,
      attemptId: attemptId ?? "",
      satisfiedAtTick: 0,
      satisfiedAtMissionTimeUs: 0,
      inputEventIds: [],
      channelEventIds: [],
      decodedStateChecksum: "x",
      fixtureId: null,
      ropeSha256: "0".repeat(64),
      emulatorCommit: "test",
      decoderSchemaVersion: 1,
      classification: "authentic-emulator",
      educationalInteractionOnly: false,
    })),
    internal: {},
    lastObservationTick: 0,
  };
}

describe("applyLessonStateUpdate — routing", () => {
  it("writes into the bucket named by next.lessonId (not a caller-captured id)", () => {
    // Simulates: a listener persisted from Lesson 1's mount completes
    // Lesson 3. The callback carries a state whose lessonId is 'lesson3'.
    const initial: Record<string, LessonState> = {
      lesson1: makeState("lesson1", "in-progress", "att-1"),
      lesson3: makeState("lesson3", "in-progress", "att-3"),
    };
    const completed3 = makeState("lesson3", "completed", "att-3", 2, 1);
    const next = applyLessonStateUpdate(initial, completed3);
    expect(next.lesson3.status).toBe("completed");
    expect(next.lesson1.status).toBe("in-progress"); // untouched
    expect(next.lesson1).toBe(initial.lesson1);       // same reference
  });

  it("adds a new bucket when the state's lessonId has no prior entry", () => {
    const initial: Record<string, LessonState> = {
      lesson1: makeState("lesson1", "in-progress", "att-1"),
    };
    const s4 = makeState("lesson4", "in-progress", "att-4");
    const next = applyLessonStateUpdate(initial, s4);
    expect(next.lesson4.status).toBe("in-progress");
    expect(next.lesson1).toBe(initial.lesson1);
  });
});

describe("applyLessonStateUpdate — terminal completion monotonicity", () => {
  it("rejects a completed → in-progress downgrade for the same attempt", () => {
    const prior = makeState("lesson3", "completed", "att-3", 2, 1);
    const initial = { lesson3: prior };
    const stale = makeState("lesson3", "in-progress", "att-3", 1, 0);
    const next = applyLessonStateUpdate(initial, stale);
    // Same object identity — no mutation.
    expect(next).toBe(initial);
    expect(next.lesson3).toBe(prior);
  });

  it("rejects a completed → not-started downgrade for the same attempt", () => {
    const prior = makeState("lesson3", "completed", "att-3", 2, 1);
    const initial = { lesson3: prior };
    const stale = makeState("lesson3", "not-started", "att-3");
    const next = applyLessonStateUpdate(initial, stale);
    expect(next).toBe(initial);
  });

  it("allows a fresh attempt to overwrite a completed bucket (real restart, not a downgrade)", () => {
    const prior = makeState("lesson3", "completed", "att-3", 2, 1);
    const initial = { lesson3: prior };
    const restarted = makeState("lesson3", "in-progress", "att-3b");
    const next = applyLessonStateUpdate(initial, restarted);
    expect(next.lesson3.attempt?.attemptId).toBe("att-3b");
    expect(next.lesson3.status).toBe("in-progress");
  });

  it("allows a completed → completed re-commit (idempotent)", () => {
    const prior = makeState("lesson3", "completed", "att-3", 2, 1);
    const initial = { lesson3: prior };
    const again = makeState("lesson3", "completed", "att-3", 2, 1);
    const next = applyLessonStateUpdate(initial, again);
    expect(next.lesson3.status).toBe("completed");
  });

  it("does not block a synchronous completion arriving after in-progress prop", () => {
    // Parent has an in-progress state; LessonHost delivers a completion
    // for the SAME attempt. Must land.
    const prior = makeState("lesson3", "in-progress", "att-3");
    const initial = { lesson3: prior };
    const completed = makeState("lesson3", "completed", "att-3", 2, 1);
    const next = applyLessonStateUpdate(initial, completed);
    expect(next.lesson3.status).toBe("completed");
    expect(next.lesson3.evidence.length).toBe(1);
  });
});
