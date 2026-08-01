// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — Lesson attempt readiness contract.
//
// The /learn interactive lessons used to expose readiness as a bare React
// state string ("idle" | "gating" | "opening" | "ready"). That was observable
// but not *contractual*: nothing prevented a cancelled workflow from writing a
// later phase, and nothing tied the published phase to the attempt identity it
// belonged to. The browser acceptance suite therefore polled a value that
// could, under a specific effect-ordering race, never arrive.
//
// This module is the single monotonic source of truth. It is pure (no React,
// no DOM, no timers) so the guarantees are unit-testable:
//
//   * readiness is published only with a complete identity;
//   * a published `ready` never downgrades for the same workflow token;
//   * a stale token (superseded workflow) can never mutate anything;
//   * repeated reads return the identical identity object;
//   * invalidation is explicit and always attributable to a reason.

export type AttemptPhase = "idle" | "gating" | "opening" | "ready" | "error";

/** The published readiness record. Frozen; identity-stable per attempt. */
export interface LessonAttemptReadyV1 {
  readonly version: 1;
  readonly lessonId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly agcEpoch: number;
  readonly boundaryEventId: number;
  readonly boundaryTick: number;
  readonly listenerAttachedEventId: number | null;
  readonly phase: "ready";
}

export interface AttemptReadinessSnapshot {
  readonly token: number;
  readonly phase: AttemptPhase;
  readonly ready: LessonAttemptReadyV1 | null;
  readonly error: string | null;
  /** Diagnostics — counts of refused mutations. Never used for control flow. */
  readonly staleWrites: number;
  readonly downgradeAttempts: number;
  readonly lastInvalidationReason: string | null;
}

export interface PublishReadyInput {
  lessonId: string;
  stepId: string;
  attemptId: string;
  agcEpoch: number;
  boundaryEventId: number;
  boundaryTick: number;
  listenerAttachedEventId?: number | null;
}

const PHASE_RANK: Record<AttemptPhase, number> = {
  idle: 0,
  gating: 1,
  opening: 2,
  ready: 3,
  error: 3,
};

export class AttemptReadinessPublisher {
  private token = 0;
  private phase: AttemptPhase = "idle";
  private ready: LessonAttemptReadyV1 | null = null;
  private error: string | null = null;
  private staleWrites = 0;
  private downgradeAttempts = 0;
  private lastInvalidationReason: string | null = null;
  private snap: AttemptReadinessSnapshot;

  constructor() {
    this.snap = this.build();
  }

  /** Invalidate any in-flight workflow and start a new one. */
  begin(reason: string): number {
    this.token += 1;
    this.phase = "idle";
    this.ready = null;
    this.error = null;
    this.lastInvalidationReason = reason;
    this.snap = this.build();
    return this.token;
  }

  /** Invalidate without starting a new workflow (lesson change, AGC reset). */
  invalidate(reason: string): number {
    return this.begin(reason);
  }

  isCurrent(token: number): boolean {
    return token === this.token;
  }

  /** Advance the phase. Refuses stale tokens and refuses to downgrade. */
  setPhase(token: number, phase: AttemptPhase): boolean {
    if (!this.isCurrent(token)) {
      this.staleWrites += 1;
      this.snap = this.build();
      return false;
    }
    if (PHASE_RANK[phase] < PHASE_RANK[this.phase]) {
      this.downgradeAttempts += 1;
      this.snap = this.build();
      return false;
    }
    if (this.phase === "ready" && phase !== "ready") {
      this.downgradeAttempts += 1;
      this.snap = this.build();
      return false;
    }
    this.phase = phase;
    this.snap = this.build();
    return true;
  }

  /** Publish readiness. Only legal from `opening`, and only once per token. */
  publishReady(token: number, input: PublishReadyInput): LessonAttemptReadyV1 | null {
    if (!this.isCurrent(token)) {
      this.staleWrites += 1;
      this.snap = this.build();
      return null;
    }
    if (this.ready) return this.ready; // idempotent: identical identity
    const record: LessonAttemptReadyV1 = Object.freeze({
      version: 1 as const,
      lessonId: input.lessonId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      agcEpoch: input.agcEpoch,
      boundaryEventId: input.boundaryEventId,
      boundaryTick: input.boundaryTick,
      listenerAttachedEventId: input.listenerAttachedEventId ?? null,
      phase: "ready" as const,
    });
    this.ready = record;
    this.phase = "ready";
    this.snap = this.build();
    return record;
  }

  fail(token: number, message: string): boolean {
    if (!this.isCurrent(token)) {
      this.staleWrites += 1;
      this.snap = this.build();
      return false;
    }
    if (this.phase === "ready") {
      this.downgradeAttempts += 1;
      this.snap = this.build();
      return false;
    }
    this.phase = "error";
    this.error = message;
    this.snap = this.build();
    return true;
  }

  /** Read-only reflection. Stable object identity between mutations. */
  read(): AttemptReadinessSnapshot {
    return this.snap;
  }

  private build(): AttemptReadinessSnapshot {
    return Object.freeze({
      token: this.token,
      phase: this.phase,
      ready: this.ready,
      error: this.error,
      staleWrites: this.staleWrites,
      downgradeAttempts: this.downgradeAttempts,
      lastInvalidationReason: this.lastInvalidationReason,
    });
  }
}
