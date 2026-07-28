// SPDX-License-Identifier: GPL-3.0-or-later
// Pure deterministic lesson engine.
//
// The engine is a reducer:
//     nextState = stepLesson(definition, previous, action)
//
// It never touches the emulator, never reads wall-clock time, never
// mutates its inputs, and produces byte-identical output for identical
// input streams — this is the property tested by the determinism suite.
//
// Contract details live in ./types.ts. Predicates live under ./predicates/.

import { decodedDskyCanonical } from "@/agc/dsky/DskyDecoder";
import type {
  LessonAction,
  LessonAttempt,
  LessonDefinition,
  LessonEvidence,
  LessonObservation,
  LessonState,
  LessonStep,
} from "./types";

export function initialLessonState(def: LessonDefinition): LessonState {
  return {
    lessonId: def.id,
    status: "not-started",
    attempt: null,
    currentStepIndex: 0,
    completedStepIds: [],
    evidence: [],
    internal: {},
    lastObservationTick: -1,
  };
}

function makeAttempt(id: string, obs: LessonObservation): LessonAttempt {
  return {
    attemptId: id,
    startedAtTick: obs.tickIndex,
    startedAtCursor: obs.eventLogCursor,
    startedAtMissionTimeUs: obs.missionTimeUs,
    startDecodedChecksum: decodedDskyCanonical(obs.decoded),
  };
}

function currentStep(def: LessonDefinition, prev: LessonState): LessonStep | null {
  return def.steps[prev.currentStepIndex] ?? null;
}

function withCompletedStep(
  prev: LessonState,
  def: LessonDefinition,
  step: LessonStep,
  evidence: LessonEvidence,
): LessonState {
  const nextIdx = prev.currentStepIndex + 1;
  const done = nextIdx >= def.steps.length;
  const nextInternal = { ...prev.internal };
  delete (nextInternal as Record<string, unknown>)[step.id];
  return {
    ...prev,
    status: done ? "completed" : "in-progress",
    currentStepIndex: Math.min(nextIdx, def.steps.length - 1),
    completedStepIds: [...prev.completedStepIds, step.id],
    evidence: [...prev.evidence, evidence],
    internal: nextInternal,
  };
}

export function stepLesson(
  def: LessonDefinition,
  prev: LessonState,
  action: LessonAction,
): LessonState {
  if (prev.lessonId !== def.id) {
    throw new Error(
      `stepLesson: lessonId mismatch ${prev.lessonId} vs ${def.id}`,
    );
  }

  // Handle attempt lifecycle actions first (they never inspect predicates).
  if (action.kind === "beginAttempt") {
    return {
      ...initialLessonState(def),
      status: "in-progress",
      attempt: makeAttempt(action.attemptId, action.observation),
      lastObservationTick: action.observation.tickIndex,
    };
  }

  if (action.kind === "restart") {
    // Clears evidence and per-step scratch, but does NOT reset AGC.
    return {
      ...initialLessonState(def),
      status: "in-progress",
      attempt: makeAttempt(action.attemptId, action.observation),
      lastObservationTick: action.observation.tickIndex,
    };
  }

  if (prev.status === "completed") return prev;

  const step = currentStep(def, prev);
  if (!step) return prev;

  if (action.kind === "acknowledgeStep") {
    if (step.kind !== "reading") return prev;
    // Reading steps do not need an attempt to have been opened.
    const attemptId = prev.attempt?.attemptId ?? `ack-${step.id}`;
    const evidence: LessonEvidence = {
      lessonId: def.id,
      stepId: step.id,
      attemptId,
      satisfiedAtTick: action.observation.tickIndex,
      satisfiedAtMissionTimeUs: action.observation.missionTimeUs,
      inputEventIds: [],
      channelEventIds: [],
      decodedStateChecksum: decodedDskyCanonical(action.observation.decoded),
      fixtureId: null,
      ropeSha256: action.observation.provenance.ropeSha256,
      emulatorCommit: action.observation.provenance.emulatorCommit,
      decoderSchemaVersion: action.observation.provenance.decoderSchemaVersion,
      classification: step.classification === "educational-visualization"
        ? "educational-visualization"
        : "historically-grounded",
      educationalInteractionOnly: true,
    };
    return withCompletedStep(prev, def, step, evidence);
  }

  if (action.kind !== "observe") return prev;
  const obs = action.observation;

  if (step.kind === "reading") {
    // Reading steps NEVER complete from observations; only via
    // acknowledgeStep. This is what "does not claim an AGC result" means.
    return { ...prev, lastObservationTick: obs.tickIndex };
  }

  // Interactive step. Must have an open attempt.
  if (!prev.attempt) {
    return { ...prev, lastObservationTick: obs.tickIndex };
  }

  const previousInternal =
    (prev.internal as Record<string, unknown>)[step.id];
  const result = step.predicate({
    observation: obs,
    attempt: prev.attempt,
    previousInternal,
  });

  const nextInternal = {
    ...prev.internal,
    [step.id]: result.internal,
  } as Readonly<Record<string, unknown>>;
  const nextBase: LessonState = {
    ...prev,
    internal: nextInternal,
    status: "in-progress",
    lastObservationTick: obs.tickIndex,
  };

  if (!result.completed) return nextBase;
  if (!result.evidence) return nextBase;

  const ev: LessonEvidence = {
    lessonId: def.id,
    stepId: step.id,
    attemptId: prev.attempt.attemptId,
    ropeSha256: obs.provenance.ropeSha256,
    emulatorCommit: obs.provenance.emulatorCommit,
    decoderSchemaVersion: obs.provenance.decoderSchemaVersion,
    ...result.evidence,
  };
  return withCompletedStep(nextBase, def, step, ev);
}
