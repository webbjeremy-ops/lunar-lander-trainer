// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Learning campaign acceptance: progress persistence, defensive
// import, lesson⇄game handoff, track coverage, and lesson determinism.

import { describe, expect, it } from "vitest";
import {
  emptyProgress,
  parseProgress,
  reduceProgress,
  serializeProgress,
  PROGRESS_SCHEMA,
  PROGRESS_VERSION,
} from "@/learning/progress";
import {
  decodeChallengeRequest,
  encodeChallengeRequest,
  parseChallengeResult,
  serializeChallengeResult,
  type ChallengeRequest,
  type ChallengeResult,
} from "@/learning/handoff";
import {
  LEARNING_TRACKS,
  recommendNextLesson,
  trackForLesson,
  unlockedMissionsFor,
} from "@/learning/tracks";
import { ALL_LESSONS } from "@/lessons/content";
import { SOURCE_REGISTRY } from "@/lessons/SourceRegistry";
import { MISSIONS } from "@/game/play";

const ALLOWED_CLASSIFICATIONS = new Set([
  "authentic-emulator",
  "source-derived",
  "historically-grounded",
  "educational-visualization",
  "gameplay-tuned",
  "approximation",
]);

describe("M4.2 learning progress", () => {
  it("reduces lesson completion idempotently and deterministically", () => {
    const a = reduceProgress(emptyProgress(), {
      kind: "lessonCompleted",
      lessonId: "lesson-08-why-the-lm-falls",
      atMs: 1000,
      unlocks: ["terminal-descent"],
    });
    const b = reduceProgress(a, {
      kind: "lessonCompleted",
      lessonId: "lesson-08-why-the-lm-falls",
      atMs: 2000,
      unlocks: ["terminal-descent"],
    });
    expect(a.completedLessons).toEqual(["lesson-08-why-the-lm-falls"]);
    expect(b.completedLessons).toEqual(a.completedLessons);
    expect(b.unlockedMissions).toContain("terminal-descent");
  });

  it("keeps only the best challenge score but counts every attempt", () => {
    let p = emptyProgress();
    p = reduceProgress(p, {
      kind: "challengeResult",
      missionId: "terminal-descent",
      difficulty: "instructor",
      score: 620,
      grade: "C",
      outcome: "landed",
      atMs: 1,
    });
    p = reduceProgress(p, {
      kind: "challengeResult",
      missionId: "terminal-descent",
      difficulty: "pilot",
      score: 410,
      grade: "D",
      outcome: "hard-landing",
      atMs: 2,
    });
    const rec = p.challenges["terminal-descent"]!;
    expect(rec.bestScore).toBe(620);
    expect(rec.bestGrade).toBe("C");
    expect(rec.attempts).toBe(2);
    expect(rec.difficultiesCompleted).toEqual(["instructor"]);
  });

  it("round-trips through serialize/parse", () => {
    const p = reduceProgress(emptyProgress(), {
      kind: "lessonVisited",
      lessonId: "lesson-15-orbit-is-free-fall",
      atMs: 77,
    });
    const parsed = parseProgress(serializeProgress(p));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.progress).toEqual(p);
  });

  it("fails safely on corrupt, foreign or wrong-version payloads", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "[]",
      "42",
      JSON.stringify({ schema: "something.else", version: 1 }),
      JSON.stringify({ schema: PROGRESS_SCHEMA, version: PROGRESS_VERSION + 1 }),
      JSON.stringify({ schema: PROGRESS_SCHEMA, version: PROGRESS_VERSION, completedLessons: "no" }),
    ]) {
      const r = parseProgress(raw as string | null);
      expect(r.ok).toBe(false);
    }
  });
});

describe("M4.2 lesson ⇄ game handoff", () => {
  const req: ChallengeRequest = {
    version: 1,
    lessonId: "lesson-13-fly-the-terminal-descent",
    stepId: "step-fly",
    missionId: "terminal-descent",
    assistance: "instructor",
    controlMode: "quick-manual",
    passingScore: 500,
  };

  it("round-trips a challenge request through the query string", () => {
    expect(decodeChallengeRequest(encodeChallengeRequest(req))).toEqual(req);
  });

  it("rejects malformed or unrelated query strings", () => {
    expect(decodeChallengeRequest("")).toBeNull();
    expect(decodeChallengeRequest("?foo=bar")).toBeNull();
    expect(decodeChallengeRequest("cv=99&lesson=a&step=b&mission=c&assist=d&mode=e&pass=1")).toBeNull();
  });

  it("round-trips a challenge result and rejects corrupt results", () => {
    const result: ChallengeResult = {
      version: 1,
      lessonId: req.lessonId,
      stepId: req.stepId,
      missionId: req.missionId,
      difficulty: "instructor",
      score: 720,
      maxScore: 1000,
      grade: "B",
      outcome: "landed",
      passed: true,
      flight: {
        verticalSpeedMps: -0.7,
        horizontalSpeedMps: 0.3,
        propellantRemainingKg: 410,
        landingZoneErrorM: 62,
        missionTimeS: 143.5,
      },
      atMs: 12345,
    };
    expect(parseChallengeResult(serializeChallengeResult(result))).toEqual(result);
    expect(parseChallengeResult("{}")).toBeNull();
    expect(parseChallengeResult("garbage")).toBeNull();
    expect(parseChallengeResult(null)).toBeNull();
  });
});

describe("M4.2 tracks", () => {
  it("references only real lessons and real missions", () => {
    const lessonIds = new Set(ALL_LESSONS.map((l) => l.id));
    for (const t of LEARNING_TRACKS) {
      expect(t.lessonIds.length).toBeGreaterThan(0);
      for (const id of t.lessonIds) expect(lessonIds.has(id)).toBe(true);
      for (const m of t.unlocksMissions) expect(Object.keys(MISSIONS)).toContain(m);
    }
  });

  it("covers every lesson in at least one track", () => {
    for (const l of ALL_LESSONS) expect(trackForLesson(l.id)).not.toBeNull();
  });

  it("unlocks a track's missions only once every lesson is complete", () => {
    const track = LEARNING_TRACKS[0]!;
    const none = unlockedMissionsFor([]);
    const partial = unlockedMissionsFor(track.lessonIds.slice(0, 1));
    const full = unlockedMissionsFor(track.lessonIds);
    // Nothing beyond the always-available missions before any lesson is done.
    for (const m of track.unlocksMissions) expect(none).not.toContain(m);
    // Partial credit unlocks the track's first mission only.
    expect(partial).toContain(track.unlocksMissions[0]);
    for (const m of track.unlocksMissions.slice(1)) expect(partial).not.toContain(m);
    for (const m of track.unlocksMissions) expect(full).toContain(m);
  });

  it("recommends a deterministic next lesson", () => {
    const track = LEARNING_TRACKS[0]!;
    const first = track.lessonIds[0]!;
    const a = recommendNextLesson(first, [first]);
    const b = recommendNextLesson(first, [first]);
    expect(a).toBe(b);
    expect(a).toBe(track.lessonIds[1]);
  });
});

describe("M4.2 lesson content integrity", () => {
  it("labels every step and cites only registered sources", () => {
    const known = new Set(Object.keys(SOURCE_REGISTRY));
    for (const lesson of ALL_LESSONS) {
      expect(lesson.steps.length).toBeGreaterThan(0);
      for (const step of lesson.steps) {
        expect(ALLOWED_CLASSIFICATIONS.has(step.classification)).toBe(true);
        for (const s of step.sources ?? []) expect(known.has(s.id)).toBe(true);
      }
    }
  });

  it("keeps lesson ids unique", () => {
    const ids = ALL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every lesson challenge at a real mission", () => {
    for (const lesson of ALL_LESSONS) {
      for (const step of lesson.steps) {
        if (step.kind !== "reading" || !step.challenge) continue;
        expect(Object.keys(MISSIONS)).toContain(step.challenge.missionId);
        expect(step.challenge.passingScore).toBeGreaterThan(0);
      }
    }
  });
});
