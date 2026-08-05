// SPDX-License-Identifier: GPL-3.0-or-later
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { ALL_LESSONS } from "@/lessons/content";
import { SOURCE_REGISTRY } from "@/lessons/SourceRegistry";
import { initialLessonState, stepLesson } from "@/lessons/LessonEngine";
import type { LessonDefinition, LessonObservation, LessonState } from "@/lessons/types";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import { LessonHost } from "@/lessons/LessonHost";
import { Dsky } from "@/ui/dsky/Dsky";
import { ropeById } from "@/sim/agc/roms";
import { useAgcSession } from "@/agc/AgcSession";
import type { EventBoundaryPayload, StateSnapshot } from "@/agc/protocol";
import { ReadinessTracker, type ReadinessSnapshot } from "@/lessons/ReadinessTracker";
import {
  AttemptReadinessPublisher,
  type LessonAttemptReadyV1,
} from "@/lessons/attemptReadiness";
import { LessonDiagram } from "@/ui/learn/diagrams";
import { ChallengeLauncher, ChallengeResultCard } from "@/ui/learn/ChallengeLauncher";
import { ProgressPanel } from "@/ui/learn/ProgressPanel";
import { useLearningProgress } from "@/ui/learn/useLearningProgress";
import { drainChallengeResult, type ChallengeResult } from "@/learning/handoff";
import { LEARNING_TRACKS, recommendNextLesson } from "@/learning/tracks";

export const Route = createFileRoute("/learn")({
  head: () => ({
    meta: [
      { title: "Learn the AGC · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Guided lessons on the real Apollo Guidance Computer: DSKY operation, channel decoding, and annunciators — every claim cited to primary sources.",
      },
      { property: "og:title", content: "Learn the Apollo Guidance Computer" },
      {
        property: "og:description",
        content:
          "Deterministic lessons backed by Luminary099 and the pinned yaDSKY2 source. No hand-waving; every step cites its source.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: LearnPage,
});

function classificationLabel(c: string): string {
  switch (c) {
    case "authentic-emulator":
      return "Authentic AGC output";
    case "historically-grounded":
      return "Historically grounded";
    case "educational-visualization":
      return "Educational visualization";
    case "approximation":
      return "Approximation";
    default:
      return c;
  }
}

function classificationTone(c: string): string {
  switch (c) {
    case "authentic-emulator":
      return "border-emerald-500 text-emerald-300";
    case "historically-grounded":
      return "border-sky-500 text-sky-300";
    case "educational-visualization":
      return "border-amber-500 text-amber-300";
    default:
      return "border-neutral-500 text-neutral-300";
  }
}

function inertObservation(tick: number): LessonObservation {
  return {
    decoded: makeEmptyDecodedDsky(),
    previousDecoded: null,
    snapshot: null,
    recentInputs: [],
    recentChannelEvents: [],
    eventLogCursor: 0,
    tickIndex: tick,
    missionTimeUs: tick * 20000,
    provenance: FIXTURE_PROVENANCE,
  };
}

/** Seed observation for an attempt from a Worker-allocated event boundary.
 *  The boundary id is drawn from the SAME monotonic counter used for
 *  inputAccepted and channelUpdate, so every subsequent event has id >
 *  boundaryEventId. Setting startedAtCursor = boundaryEventId + 1 keeps the
 *  existing matcher's `eventId >= startedAtCursor` semantics correct while
 *  guaranteeing strict exclusion of any pre-boundary evidence. */
function boundarySeedObservation(
  boundary: EventBoundaryPayload,
  snap: StateSnapshot | null,
): LessonObservation {
  return {
    // Prefer the worker-authoritative decoded baseline that corresponds to
    // the SAME id as boundaryEventId. Snapshots are wall-clock coalesced
    // and can be stale relative to the boundary allocation, so their
    // decodedDsky may not match. The boundary payload never lies.
    decoded: boundary.decodedDsky ?? snap?.decodedDsky ?? makeEmptyDecodedDsky(),
    previousDecoded: null,
    snapshot: snap,
    recentInputs: [],
    recentChannelEvents: [],
    eventLogCursor: boundary.boundaryEventId + 1,
    tickIndex: boundary.tickIndex,
    missionTimeUs: boundary.missionTimeUs,
    provenance: FIXTURE_PROVENANCE,
  };
}

let ATTEMPT_SEQ = 0;
function nextAttemptId(lessonId: string): string {
  return `att-${lessonId}-${Date.now().toString(36)}-${++ATTEMPT_SEQ}`;
}

/** Pure state committer used by the /learn parent to route incoming
 *  LessonState updates by `next.lessonId`. Extracted to make the
 *  routing + monotonic-completion invariants directly testable.
 *
 *  Invariants:
 *   - Writes into `s[next.lessonId]` — never into a caller-captured id,
 *     so a listener wired up during Lesson 1 that completes Lesson 3
 *     cannot stomp Lesson 1's bucket.
 *   - Never downgrades a completed attempt back to a non-completed status
 *     when the attemptId matches (delayed / stale callbacks).
 *   - A distinct attemptId (new attempt) is allowed to overwrite the
 *     bucket — that is a real reset, not a downgrade.
 */
export function applyLessonStateUpdate(
  s: Record<string, LessonState>,
  next: LessonState,
): Record<string, LessonState> {
  const prev = s[next.lessonId];
  if (
    prev &&
    prev.status === "completed" &&
    next.status !== "completed" &&
    prev.attempt?.attemptId === next.attempt?.attemptId
  ) {
    return s;
  }
  return { ...s, [next.lessonId]: next };
}


type AttemptPhase = "idle" | "gating" | "opening" | "ready" | "error";

function LearnPage() {
  const rope = useMemo(() => ropeById("Luminary099"), []);
  const [selectedId, setSelectedId] = useState<string>(
    LEARNING_TRACKS[0]?.lessonIds[0] ?? ALL_LESSONS[0]!.id,
  );
  const [states, setStates] = useState<Record<string, LessonState>>(() => {
    const init: Record<string, LessonState> = {};
    for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
    return init;
  });

  // ---- M4.2 learning campaign: local progress + lesson⇄game handoff.
  const progressApi = useLearningProgress();
  const [pendingResult, setPendingResult] = useState<ChallengeResult | null>(null);
  const drainedRef = useRef(false);

  useEffect(() => {
    if (drainedRef.current) return;
    drainedRef.current = true;
    const result = drainChallengeResult();
    if (!result) return;
    setPendingResult(result);
    setSelectedId(result.lessonId);
    progressApi.dispatch({
      kind: "challengeResult",
      missionId: result.missionId,
      difficulty:
        result.difficulty === "pilot" || result.difficulty === "commander"
          ? result.difficulty
          : "instructor",
      score: result.score,
      grade: result.grade,
      outcome: result.outcome,
      atMs: result.atMs || Date.now(),
    });
  }, [progressApi]);



  // Stable, lesson-agnostic state committer. Routes writes by the state's own
  // lessonId (NOT by a captured `lesson.id` closure), so a listener wired up
  // on a prior render cannot stomp a completed state into the wrong bucket.
  // This is the fix for Branch B (completion propagated from LessonHost's
  // stateRef but never landed in the parent because the callback closed over
  // the initial lesson's id).
  const handleLessonState = useCallback((next: LessonState) => {
    setStates((s) => applyLessonStateUpdate(s, next));
  }, []);



  // ---- Shared AGC session (owned by AgcSessionProvider in __root). The
  //      client, epoch, and reset behavior all come from the provider so that
  //      navigating away to /explore and back preserves the same emulator.
  const session = useAgcSession();
  const agcClient = session.client;
  const agcEpoch = session.sessionEpoch;
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);

  // ---- Attempt handshake state.
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>("idle");
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [attemptReady, setAttemptReady] = useState<LessonAttemptReadyV1 | null>(null);
  const [lastBoundary, setLastBoundary] = useState<EventBoundaryPayload | null>(null);
  const [readinessSnap, setReadinessSnap] = useState<ReadinessSnapshot | null>(null);
  const openingTokenRef = useRef(0);
  // M4.5 — the single monotonic readiness authority. React state below is a
  // rendering mirror of this object, never an independent source of truth.
  const readinessRef = useRef<AttemptReadinessPublisher | null>(null);
  if (readinessRef.current === null) readinessRef.current = new AttemptReadinessPublisher();
  const readinessTrackerRef = useRef<ReadinessTracker | null>(null);
  const instanceIdRef = useRef<string>("");
  if (instanceIdRef.current === "") {
    instanceIdRef.current = `learn-${Math.random().toString(36).slice(2, 10)}`;
  }

  // Test-only diagnostic ring. Kept tiny; never printed in production paths.
  const diagRef = useRef<Array<Record<string, unknown>>>([]);
  const testOnlyLog = useCallback((entry: Record<string, unknown>) => {
    const withMeta = { ...entry, t: Date.now(), instanceId: instanceIdRef.current };
    const buf = diagRef.current;
    buf.push(withMeta);
    if (buf.length > 200) buf.shift();
    if (typeof window !== "undefined") {
      (window as unknown as { __learnLifecycle?: unknown[] }).__learnLifecycle = buf;
    }
  }, []);

  const handleSnapshot = useCallback((s: StateSnapshot) => {
    latestSnapshotRef.current = s;
  }, []);

  const lesson = useMemo<LessonDefinition>(
    () => ALL_LESSONS.find((l) => l.id === selectedId) ?? ALL_LESSONS[0]!,
    [selectedId],
  );
  const state = states[lesson.id] ?? initialLessonState(lesson);
  const step = lesson.steps[state.currentStepIndex] ?? null;
  const isInteractive = step?.kind === "interactive";
  const isComplete = state.status === "completed";
  // The DSKY panel is only pertinent to lessons that actually drive the AGC.
  // Non-AGC tracks keep the persistent session mounted (no worker churn) but
  // never show the hardware panel.
  const lessonUsesDsky = useMemo(
    () => lesson.steps.some((s) => s.kind === "interactive"),
    [lesson],
  );


  // M4.2 — mirror lesson completion into local progress storage.
  useEffect(() => {
    if (state.status === "completed") progressApi.completeLesson(lesson.id);
  }, [state.status, lesson.id, progressApi]);

  // M4.2 — a returning challenge result acknowledges its own lesson step.
  useEffect(() => {
    if (!pendingResult) return;
    if (pendingResult.lessonId !== lesson.id) return;
    if (!step || step.kind !== "reading" || step.id !== pendingResult.stepId) return;
    if (isComplete) return;
    setStates((s) => {
      const cur = s[lesson.id];
      if (!cur) return s;
      const next = stepLesson(lesson, cur, {
        kind: "acknowledgeStep",
        observation: inertObservation(cur.lastObservationTick + 1),
      });
      return { ...s, [lesson.id]: next };
    });
  }, [pendingResult, lesson, step, isComplete]);

  const nextLessonId = useMemo(
    () => recommendNextLesson(lesson.id, progressApi.progress.completedLessons),
    [lesson.id, progressApi.progress.completedLessons],
  );





  // Semantic keys. `openKey` identifies exactly one attempt-opening workflow;
  // `resetKey` identifies a true session/reset boundary. Neither includes
  // rapidly-changing runtime values (snapshots, mission time, event counts).
  const openKey = `${agcEpoch}:${lesson.id}:${step?.id ?? "-"}`;
  const resetKey = `${agcEpoch}:${lesson.id}`;

  // Single choke point for every token mutation. Callers MUST supply a reason
  // so lifecycle diagnostics can attribute cancellations.
  const invalidateOpening = useCallback((reason: string): number => {
    const previous = openingTokenRef.current;
    // The publisher owns the token; React refs merely mirror it so existing
    // call sites keep reading a plain number.
    const next = readinessRef.current!.begin(reason);
    openingTokenRef.current = next;
    setAttemptReady(null);
    testOnlyLog({
      type: "opening-invalidated",
      reason,
      previous,
      next,
      openKey,
      resetKey,
      agcEpoch,
      lessonId: lesson.id,
      stepId: step?.id ?? null,
    });
    return next;
  }, [testOnlyLog, openKey, resetKey, agcEpoch, lesson.id, step?.id]);

  /** Mirror a phase transition through the monotonic publisher. Returns false
   *  when the write was refused (stale token or a downgrade). */
  const applyPhase = useCallback((token: number, phase: AttemptPhase): boolean => {
    if (!readinessRef.current!.setPhase(token, phase)) return false;
    setAttemptPhase(phase);
    return true;
  }, []);

  // Mount / unmount lifecycle probe.
  useEffect(() => {
    testOnlyLog({ type: "component-mount" });
    return () => {
      testOnlyLog({ type: "component-unmount" });
    };
  }, [testOnlyLog]);

  // Render-updated context for the async open workflow. Refs (not closure
  // captures) so a workflow started on an earlier render still publishes the
  // step/epoch it is actually running against.
  const openContextRef = useRef<{ stepId: string | null; agcEpoch: number }>({
    stepId: step?.id ?? null,
    agcEpoch,
  });
  openContextRef.current = { stepId: step?.id ?? null, agcEpoch };

  /** Read-only reflection of LessonHost's listener attachment. Diagnostic
   *  only — LessonHost buffers and replays any event that predates its
   *  listener, so readiness does not depend on this value being present. */
  function readListenerAttachedEventId(): number | null {
    if (typeof window === "undefined") return null;
    const d = (window as unknown as { __learnDiag?: { listenerAttachedEventId?: number | null } })
      .__learnDiag;
    return d?.listenerAttachedEventId ?? null;
  }

  /** Perform the barrier handshake and open a fresh lesson attempt.
   *  MUST be called only when there is a live client and an interactive
   *  step. The keypad remains locked until phase transitions to "ready". */
  const openAttempt = useCallback(async (
    forLesson: LessonDefinition,
    action: "beginAttempt" | "restart",
  ) => {
    const client = agcClient;
    if (!client) return;
    const token = invalidateOpening("new-open-request");
    setAttemptError(null);
    testOnlyLog({ type: "openAttempt-entry", token, action, lessonId: forLesson.id, gate: !!forLesson.requiresReadinessGate });

    try {
      if (forLesson.requiresReadinessGate) {
        applyPhase(token, "gating");
        const tracker = new ReadinessTracker();
        readinessTrackerRef.current = tracker;
        testOnlyLog({ type: "boundary-request-sent", token, purpose: "readiness-baseline" });
        const seed = await client.requestEventBoundary();
        testOnlyLog({ type: "boundary-response-received", token, purpose: "readiness-baseline", tokenMatch: openingTokenRef.current === token, boundaryEventId: seed.boundaryEventId });
        if (openingTokenRef.current !== token) return;
        tracker.noteBaseline(seed);
        setReadinessSnap(tracker.snapshot());
        if (!tracker.isReady()) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              unsub();
              reject(new Error(`Timed out waiting for AGC readiness (${tracker.snapshot().blockingReason ?? "unknown"}).`));
            }, 45_000);
            const unsub = client.addListener({
              onChannelUpdate: (chEv) => {
                if (openingTokenRef.current !== token) {
                  clearTimeout(timer); unsub(); resolve(); return;
                }
                tracker.applyChannelEvent(chEv);
                setReadinessSnap(tracker.snapshot());
                if (tracker.isReady()) {
                  clearTimeout(timer); unsub(); resolve();
                }
              },
              onSnapshot: (snap) => {
                if (openingTokenRef.current !== token) {
                  clearTimeout(timer); unsub(); resolve(); return;
                }
                tracker.noteTickAdvance({
                  tickIndex: snap.tickIndex,
                  missionTimeUs: snap.missionTimeUs,
                  totalAgcSteps: snap.totalAgcSteps,
                });
                setReadinessSnap(tracker.snapshot());
                if (tracker.isReady()) {
                  clearTimeout(timer); unsub(); resolve();
                }
              },
            });
          });
          testOnlyLog({ type: "readiness-resolved", token, tokenMatch: openingTokenRef.current === token });
          if (openingTokenRef.current !== token) return;
        }
      }

      applyPhase(token, "opening");
      testOnlyLog({ type: "boundary-request-sent", token, purpose: "attempt-open" });
      const boundary = await client.requestEventBoundary();
      testOnlyLog({ type: "boundary-response-received", token, purpose: "attempt-open", tokenMatch: openingTokenRef.current === token, boundaryEventId: boundary.boundaryEventId });
      if (openingTokenRef.current !== token) return;
      setLastBoundary(boundary);
      const seedObs = boundarySeedObservation(boundary, latestSnapshotRef.current);
      const attemptId = nextAttemptId(forLesson.id);
      setStates((prev) => {
        const cur = prev[forLesson.id] ?? initialLessonState(forLesson);
        const next = stepLesson(forLesson, cur, {
          kind: action,
          attemptId,
          observation: seedObs,
        });
        return { ...prev, [forLesson.id]: next };
      });
      // Readiness is published last, and only with a complete identity:
      // lesson + step + attempt + epoch + boundary. Nothing downstream may
      // observe "ready" before the attempt exists in engine state.
      const ctx = openContextRef.current;
      const record = readinessRef.current!.publishReady(token, {
        lessonId: forLesson.id,
        stepId: ctx.stepId ?? "-",
        attemptId,
        agcEpoch: ctx.agcEpoch,
        boundaryEventId: boundary.boundaryEventId,
        boundaryTick: boundary.tickIndex,
        listenerAttachedEventId: readListenerAttachedEventId(),
      });
      if (record) {
        setAttemptReady(record);
        setAttemptPhase("ready");
      }
    } catch (err) {
      if (openingTokenRef.current !== token) return;
      const message = err instanceof Error ? err.message : String(err);
      if (readinessRef.current!.fail(token, message)) {
        setAttemptError(message);
        setAttemptPhase("error");
      }
    }
  }, [agcClient, invalidateOpening, testOnlyLog, applyPhase]);

  // ---- ROOT-CAUSE FIX (M4.5) ------------------------------------------
  // These two effects MUST be declared reset-first. React runs effects in
  // declaration order within a commit. Previously the open-effect was
  // declared first, so a lesson change ran:
  //
  //   open-effect:  openedKeyRef = newKey; openAttempt(token N)
  //   reset-effect: invalidateOpening()  -> token N+1 (cancels N)
  //                 openedKeyRef = null; phase = "idle"
  //
  // The just-started workflow was cancelled, and because no dependency of
  // the open-effect changed afterwards it never re-ran: `attemptPhase`
  // stayed "idle" forever and the keypad stayed locked. That is the
  // intermittent /learn acceptance timeout — a real product deadlock,
  // reachable whenever a lesson is selected while its current step is
  // already interactive (revisiting a partially-completed lesson).
  //
  // Reset now runs first, and additionally bumps `resetNonce`, which is a
  // dependency of the open-effect. Either mechanism alone would fix it;
  // both together make the ordering guarantee explicit rather than
  // incidental.
  const openedKeyRef = useRef<string | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const prevResetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    testOnlyLog({ type: "reset-effect-start", resetKey, prev: prevResetKeyRef.current });
    if (prevResetKeyRef.current === null) {
      prevResetKeyRef.current = resetKey;
      return;
    }
    if (prevResetKeyRef.current === resetKey) return;
    prevResetKeyRef.current = resetKey;
    openedKeyRef.current = null;
    invalidateOpening("explicit-reset");
    setAttemptPhase("idle");
    setLastBoundary(null);
    setAttemptError(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
    setResetNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Auto-open an attempt for the current interactive step. Depends on the
  // stable semantic `openKey` plus the essentials — NOT snapshot, decoded
  // state, readiness, or state.attempt (openAttempt sets state.attempt on
  // success, which would otherwise re-trigger this effect).
  useEffect(() => {
    testOnlyLog({ type: "open-effect-start", hasClient: !!agcClient, isInteractive, isComplete, openKey, opened: openedKeyRef.current, phase: attemptPhase });
    if (!agcClient || !isInteractive || isComplete) return;
    if (openedKeyRef.current === openKey) return; // one active workflow per openKey
    openedKeyRef.current = openKey;
    void openAttempt(lesson, "beginAttempt");
    return () => {
      testOnlyLog({ type: "open-effect-cleanup", openKey });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agcClient, openKey, isInteractive, isComplete, openAttempt, resetNonce]);

  // Committed-phase diagnostic — the only reliable observation that
  // setAttemptPhase actually flushed before any subsequent cancellation.
  useEffect(() => {
    testOnlyLog({ type: "attempt-phase-committed", attemptPhase, openKey });
  }, [attemptPhase, openKey, testOnlyLog]);


  function ackCurrent() {
    if (!step || step.kind !== "reading") return;
    const next = stepLesson(lesson, state, {
      kind: "acknowledgeStep",
      observation: inertObservation(state.lastObservationTick + 1),
    });
    setStates((s) => ({ ...s, [lesson.id]: next }));
  }

  function resetLesson() {
    openedKeyRef.current = null;
    invalidateOpening("reset-lesson");
    setAttemptPhase("idle");
    setLastBoundary(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
    setResetNonce((n) => n + 1);
    setStates((s) => ({ ...s, [lesson.id]: initialLessonState(lesson) }));
  }

  function restartInteractive() {
    if (!isInteractive || !agcClient) return;
    openedKeyRef.current = null;
    void openAttempt(lesson, "restart");
  }

  function resetAgc() {
    openedKeyRef.current = null;
    invalidateOpening("reset-agc");
    setAttemptPhase("idle");
    setLastBoundary(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
    setResetNonce((n) => n + 1);
    setStates(() => {
      const init: Record<string, LessonState> = {};
      for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
      return init;
    });
    latestSnapshotRef.current = null;
    session.resetSession();
  }

  // Test hook: expose current lesson/state/epoch/handshake diagnostics
  // for E2E introspection. Boundary IDs and the latest observed global
  // eventId make cursor-namespace bugs directly assertable. Everything here
  // is a READ-ONLY reflection of production state — no test-only mutation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __learnTest?: unknown }).__learnTest = {
      lessonId: lesson.id,
      stepId: step?.id ?? null,
      state,
      states,
      agcEpoch,
      attemptPhase,
      attemptError,
      attemptReady,
      readinessContract: readinessRef.current?.read() ?? null,
      boundaryEventId: lastBoundary?.boundaryEventId ?? null,
      boundaryTick: lastBoundary?.tickIndex ?? null,
      latestEventId: latestSnapshotRef.current?.latestEventId ?? null,
      snapshot: latestSnapshotRef.current,
      readiness: readinessSnap,
      readinessRequired: lesson.requiresReadinessGate === true,
    };
  }, [lesson, step, state, states, agcEpoch, attemptPhase, attemptError, attemptReady, lastBoundary, readinessSnap]);

  // Interaction lock: DSKY input is suppressed until the readiness contract
  // for THIS exact (lesson, step, attempt, epoch) is published. Reading the
  // contract rather than the phase alone closes the window where the phase
  // said "ready" but the attempt identity belonged to a previous step.
  const dskyDisabled =
    isInteractive &&
    !isComplete &&
    !(
      attemptPhase === "ready" &&
      attemptReady !== null &&
      attemptReady.lessonId === lesson.id &&
      attemptReady.stepId === (step?.id ?? "-") &&
      attemptReady.agcEpoch === agcEpoch
    );



  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400">
              AGC · Tranquility
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Learn the AGC</h1>
          </div>
          <nav className="flex gap-3 font-mono text-xs uppercase tracking-widest">
            <Link to="/" className="text-neutral-400 hover:text-neutral-100">Home</Link>
            <Link to="/sim" className="text-neutral-400 hover:text-neutral-100">DSKY</Link>
            <Link to="/sources" className="text-neutral-400 hover:text-neutral-100">Sources</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-[minmax(260px,320px)_1fr]">
        <aside aria-label="Lesson list" className="space-y-4">
          <ProgressPanel api={progressApi} totalLessons={ALL_LESSONS.length} />
          {LEARNING_TRACKS.map((track, ti) => (
            <nav key={track.id} aria-label={track.title}>
              <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
                {track.title}
              </h2>
              <p className="mb-2 text-[11px] text-neutral-600">{track.blurb}</p>

              <ol className="space-y-1">
                {track.lessonIds.map((lessonId, i) => {
                  const l = ALL_LESSONS.find((x) => x.id === lessonId);
                  if (!l) return null;
                  const st = states[l.id];
                  const done = st?.status === "completed";
                  const active = l.id === selectedId;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        data-testid={`lesson-nav-${l.id}`}
                        onClick={() => {
                          setSelectedId(l.id);
                          progressApi.visitLesson(l.id);
                        }}
                        aria-current={active ? "true" : undefined}
                        className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? "border-emerald-600 bg-emerald-950/40"
                            : "border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-neutral-500">
                            T{ti + 1}.{String(i + 1).padStart(2, "0")}
                          </span>
                          {done && (
                            <span className="rounded-sm border border-emerald-600 px-1 py-[1px] font-mono text-[9px] uppercase text-emerald-400">
                              done
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-neutral-100">{l.title}</div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          ))}
        </aside>


        <section aria-label="Current lesson" className="min-w-0">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{lesson.title}</h2>
            <p className="mt-1 text-sm text-neutral-400">{lesson.summary}</p>
          </div>

          <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
            <span className="font-mono">
              Step {Math.min(state.currentStepIndex + 1, lesson.steps.length)} of {lesson.steps.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetLesson}
                className="rounded border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-400 hover:bg-neutral-900"
              >
                Reset lesson
              </button>
              <button
                type="button"
                data-testid="ctl-reset-agc"
                onClick={resetAgc}
                className="rounded border border-red-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-950/40"
                title="Tears down the Worker and starts a fresh AGC session"
              >
                Reset AGC
              </button>
            </div>
          </div>

          {isComplete && (
            <div
              className="mb-4 rounded border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
              data-testid="lesson-complete-banner"
            >
              Lesson complete. Every step recorded structured evidence — inspect it
              in the recorded evidence panel below or pick another lesson.
              {nextLessonId && (
                <>
                  {" "}
                  <button
                    type="button"
                    data-testid="lesson-next"
                    onClick={() => setSelectedId(nextLessonId)}
                    className="mt-2 block rounded border border-emerald-600 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
                  >
                    Next: {ALL_LESSONS.find((l) => l.id === nextLessonId)?.title ?? nextLessonId}
                  </button>
                </>
              )}
            </div>
          )}


          {step ? (
            <article className="rounded border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-sm border px-2 py-[2px] font-mono text-[10px] uppercase tracking-widest ${classificationTone(step.classification)}`}
                >
                  {classificationLabel(step.classification)}
                </span>
                <span className="rounded-sm border border-neutral-700 px-2 py-[2px] font-mono text-[10px] uppercase tracking-widest text-neutral-400">
                  {step.kind}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-neutral-100">{step.title}</h3>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-neutral-300">
                {step.body}
              </p>

              <div className="mt-4">
                <h4 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                  Sources
                </h4>
                <ul className="space-y-1 text-xs text-neutral-400">
                  {step.sources.map((s) => {
                    const entry = SOURCE_REGISTRY[s.id];
                    return (
                      <li key={s.id}>
                        <span className="text-neutral-200">{entry?.title ?? s.id}</span>
                        {entry?.pinnedCommit && (
                          <span className="ml-2 font-mono text-neutral-500">
                            @ {entry.pinnedCommit.slice(0, 8)}
                          </span>
                        )}
                        {s.cite && <span className="ml-2 text-neutral-500">— {s.cite}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {step.kind === "reading" && step.diagramId && (
                <LessonDiagram id={step.diagramId} />
              )}

              {pendingResult && pendingResult.lessonId === lesson.id && (
                <ChallengeResultCard result={pendingResult} />
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {step.kind === "reading" && step.challenge && !isComplete && (
                  <ChallengeLauncher
                    lessonId={lesson.id}
                    stepId={step.id}
                    challenge={step.challenge}
                    label={step.ackLabel ?? "Fly this challenge"}
                  />
                )}
                {step.kind === "reading" && !step.challenge && !isComplete && (
                  <button
                    type="button"
                    data-testid="lesson-ack"
                    onClick={ackCurrent}
                    className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
                  >
                    {step.ackLabel ?? "I've read this — continue"}
                  </button>
                )}

                {isInteractive && (
                  <div className="flex w-full flex-col gap-3">
                    <p
                      data-testid="lesson-attempt-phase"
                      data-phase={attemptPhase}
                      className={
                        "text-xs " +
                        (attemptPhase === "ready"
                          ? "text-amber-300"
                          : attemptPhase === "error"
                            ? "text-red-300"
                            : "text-sky-300")
                      }
                    >
                      {attemptPhase === "gating"
                        ? `Waiting for the AGC to settle before beginning the lamp test… (RESTART ${readinessSnap?.restartCleared ? "cleared" : "active"}, STANDBY ${readinessSnap?.standby ? "on" : "off"}, quiet ticks ${readinessSnap?.quietTicks ?? 0}/${readinessSnap?.requiredQuietTicks ?? 20}${readinessSnap?.blockingReason ? `, ${readinessSnap.blockingReason}` : ""})`
                        : attemptPhase === "opening"
                          ? "Preparing authentic AGC observation…"
                          : attemptPhase === "error"
                            ? `Could not open attempt: ${attemptError ?? "unknown error"}`
                            : "This step waits for authentic AGC output from the live Worker below. The lesson engine only advances when Luminary099 produces the required channel events."}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="ctl-restart-attempt"
                        onClick={restartInteractive}
                        disabled={attemptPhase === "opening" || attemptPhase === "gating"}
                        className="rounded border border-amber-600 bg-amber-950/30 px-3 py-2 font-mono text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
                      >
                        Restart attempt
                      </button>
                      <Link
                        to="/sim"
                        className="rounded border border-neutral-700 px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-300 hover:bg-neutral-900"
                      >
                        Open full DSKY workspace →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ) : (
            <p className="text-sm text-neutral-500">No step selected.</p>
          )}

          {/* Persistent AGC session — mounted for the full /learn lifetime.
              Stable key: ONLY changes on explicit "Reset AGC" (agcEpoch) or
              rope swap. Lesson navigation does NOT remount this. */}
          <div
            className={
              lessonUsesDsky
                ? "mt-6 rounded border border-neutral-800 bg-neutral-950/60 p-3"
                : "hidden"
            }
            aria-hidden={lessonUsesDsky ? undefined : true}
            data-testid="learn-dsky-panel"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                AGC Session (persistent)
              </h3>
              <span
                data-testid="learn-agc-epoch"
                className="rounded border border-neutral-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-400"
              >
                epoch {agcEpoch}
              </span>
            </div>
            <ClientOnly fallback={<div className="text-xs text-neutral-500">Booting AGC worker…</div>}>
              <Dsky
                key={`learn-session-${agcEpoch}`}
                rope={rope}
                sharedClient={agcClient}
                sharedReady={session.ready}
                onSnapshot={handleSnapshot}
                disabled={dskyDisabled}
              />
            </ClientOnly>
            {/* Non-visual lesson observer — subscribes to shared client.
                Renders one lesson-status live region only. */}
            <LessonHost
              client={agcClient}
              lesson={lesson}
              state={state}
              boundary={lastBoundary}
              onStateChange={handleLessonState}
            />
          </div>

          {state.evidence.length > 0 && (
            <details className="mt-6 rounded border border-neutral-800 bg-neutral-900/40 p-4 text-xs">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                Recorded evidence ({state.evidence.length})
              </summary>
              <ul className="mt-3 space-y-2 font-mono text-[11px] text-neutral-400">
                {state.evidence.map((ev, i) => (
                  <li key={i} className="rounded bg-neutral-950/60 p-2">
                    <div>step={ev.stepId}</div>
                    <div>tick={ev.satisfiedAtTick} · classification={ev.classification}</div>
                    <div>educationalInteractionOnly={String(ev.educationalInteractionOnly)}</div>
                    <div>rope={ev.ropeSha256.slice(0, 12)}… · emu={ev.emulatorCommit}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </main>
  );
}
