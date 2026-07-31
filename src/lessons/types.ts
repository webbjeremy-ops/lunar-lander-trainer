// SPDX-License-Identifier: GPL-3.0-or-later
// Framework-independent LessonEngine type surface.
//
// The engine is PURE:
//   * no callbacks, no emulator handles, no timers, no wall-clock reads
//   * only inputs and previous state may influence the next state
//   * evidence describes *what was observed* — it is never fed back into
//     the emulator or replayable command log
//
// Every field an interactive predicate uses to decide "did the student
// achieve this?" must originate from AGC channel output or from user input
// that the AGC actually accepted. A DecodedDsky created by hand in the UI
// (e.g. an animation) does not qualify because it will not carry channel
// event ids that survive the checks below.

import type { ChannelEventLite, StateSnapshot } from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";

/** AGC-authentic key code (octal-numeric, e.g. VERB=0o21=17). */
export type AgcKeyCode = number;

export interface LessonInputEvent {
  /** Monotonic per-worker id assigned when the user press was accepted. */
  eventId: number;
  tickIndex: number;
  missionTimeUs: number;
  kind: "dskyKeyDown" | "dskyKeyUp" | "proceedKey";
  keyCode?: AgcKeyCode;
  pressed?: boolean;
}

export interface LessonProvenance {
  ropeSha256: string;
  ropeSourceCommit: string;
  emulatorCommit: string;
  decoderSchemaVersion: number;
}

/**
 * Snapshot of "what the world looks like right now" for one observation
 * tick. Nothing in here may reference the emulator directly. Everything
 * must have been produced by the worker or by fixture replay.
 */
export interface LessonObservation {
  decoded: DecodedDsky;
  previousDecoded: DecodedDsky | null;
  snapshot: StateSnapshot | null;
  /** Input events attributed to the human, ordered oldest→newest. */
  recentInputs: readonly LessonInputEvent[];
  /** Channel events observed since the previous observation, ordered. */
  recentChannelEvents: readonly ChannelEventLite[];
  /**
   * Monotone cursor into the worker's event log. The engine uses this to
   * scope attempts — evidence produced by events with cursor < attempt.start
   * is stale.
   */
  eventLogCursor: number;
  tickIndex: number;
  missionTimeUs: number;
  provenance: LessonProvenance;
}

export type LessonClassification =
  | "authentic-emulator"
  | "source-derived"
  | "historically-grounded"
  | "educational-visualization"
  | "gameplay-tuned"
  | "approximation";

export interface LessonSourceRef {
  /** Registry id, e.g. "luminary099", "yaDSKY2-ddc65e7b". */
  id: string;
  /** Optional pinpoint (file:line, section, page). */
  cite?: string;
}

export interface LessonAttempt {
  attemptId: string;
  startedAtTick: number;
  startedAtCursor: number;
  startedAtMissionTimeUs: number;
  startDecodedChecksum: string;
}

export interface LessonEvidence {
  lessonId: string;
  stepId: string;
  attemptId: string;
  satisfiedAtTick: number;
  satisfiedAtMissionTimeUs: number;
  inputEventIds: readonly number[];
  channelEventIds: readonly number[];
  decodedStateChecksum: string;
  fixtureId: string | null;
  ropeSha256: string;
  emulatorCommit: string;
  decoderSchemaVersion: number;
  classification: LessonClassification;
  /**
   * Set true when the step was satisfied purely by explicit UI
   * acknowledgment (reading steps). Never true for interactive steps.
   */
  educationalInteractionOnly: boolean;
}

export interface StepPredicateContext {
  observation: LessonObservation;
  attempt: LessonAttempt;
  previousInternal: unknown;
}

export interface StepPredicateResult {
  completed: boolean;
  internal: unknown;
  /** Fields the engine will merge with lessonId/stepId/attemptId. */
  evidence?: Omit<
    LessonEvidence,
    | "lessonId"
    | "stepId"
    | "attemptId"
    | "ropeSha256"
    | "emulatorCommit"
    | "decoderSchemaVersion"
  >;
}

export type StepPredicate = (ctx: StepPredicateContext) => StepPredicateResult;

export interface LessonReadingStep {
  id: string;
  kind: "reading";
  title: string;
  body: string;
  ackLabel?: string;
  sources: readonly LessonSourceRef[];
  classification: Exclude<LessonClassification, "authentic-emulator">;
  /**
   * M4.2 — optional pure interactive diagram rendered above the ack button.
   * The id resolves through src/ui/learn/diagrams. Diagrams are always
   * "educational-visualization" regardless of the step classification.
   */
  diagramId?: string;
  /**
   * M4.2 — optional handoff into a configured /play scenario. When present
   * the /learn UI shows a "Fly it" launcher instead of a plain ack button;
   * the step is acknowledged when a flight result returns for this lesson.
   */
  challenge?: LessonChallengeSpec;
}

export interface LessonChallengeSpec {
  /** MissionId from src/game/play — kept as a string to avoid a game import. */
  readonly missionId: string;
  /** AssistanceLevel from src/game/play. */
  readonly assistance: string;
  /** ControlModeId from src/game/play. */
  readonly controlMode: string;
  /** Minimum mission score (points) that marks the challenge as passed. */
  readonly passingScore: number;
}


export interface LessonInteractiveStep {
  id: string;
  kind: "interactive";
  title: string;
  body: string;
  predicate: StepPredicate;
  sources: readonly LessonSourceRef[];
  classification: "authentic-emulator";
  /** Fixture id used to derive expected state, if any. */
  fixtureId?: string;
}

export type LessonStep = LessonReadingStep | LessonInteractiveStep;

export interface LessonDefinition {
  id: string;
  title: string;
  summary: string;
  steps: readonly LessonStep[];
  /**
   * When true, interactive attempts for this lesson may not be opened until
   * the AGC has reached authentic readiness (RESTART cleared, stable
   * decoded state across two complete Channel 010 selector scans, event
   * stream advancing). See src/lessons/ReadinessTracker.ts.
   */
  requiresReadinessGate?: boolean;
}

export type LessonStatus = "not-started" | "in-progress" | "completed";

export interface LessonState {
  lessonId: string;
  status: LessonStatus;
  attempt: LessonAttempt | null;
  currentStepIndex: number;
  completedStepIds: readonly string[];
  evidence: readonly LessonEvidence[];
  /**
   * Opaque per-step scratchpad the predicate uses across observations.
   * Keyed by step id. The engine never inspects the value.
   */
  internal: Readonly<Record<string, unknown>>;
  lastObservationTick: number;
}

export type LessonAction =
  | { kind: "observe"; observation: LessonObservation }
  | {
      kind: "beginAttempt";
      attemptId: string;
      observation: LessonObservation;
    }
  | { kind: "acknowledgeStep"; observation: LessonObservation }
  | { kind: "restart"; attemptId: string; observation: LessonObservation };
