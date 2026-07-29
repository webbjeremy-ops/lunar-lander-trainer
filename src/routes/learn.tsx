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
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type { EventBoundaryPayload, StateSnapshot } from "@/agc/protocol";
import { ReadinessTracker, type ReadinessSnapshot } from "@/lessons/ReadinessTracker";

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

type AttemptPhase = "idle" | "gating" | "opening" | "ready" | "error";

function LearnPage() {
  const rope = useMemo(() => ropeById("Luminary099"), []);
  const [selectedId, setSelectedId] = useState<string>(ALL_LESSONS[0]!.id);
  const [states, setStates] = useState<Record<string, LessonState>>(() => {
    const init: Record<string, LessonState> = {};
    for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
    return init;
  });

  // ---- Shared AGC session for the whole /learn route (stable ownership).
  const [agcEpoch, setAgcEpoch] = useState(0);
  const [agcClient, setAgcClient] = useState<AgcWorkerClient | null>(null);
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);

  // ---- Attempt handshake state.
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>("idle");
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [lastBoundary, setLastBoundary] = useState<EventBoundaryPayload | null>(null);
  const [readinessSnap, setReadinessSnap] = useState<ReadinessSnapshot | null>(null);
  const openingTokenRef = useRef(0);
  const readinessTrackerRef = useRef<ReadinessTracker | null>(null);

  const handleClient = useCallback((c: AgcWorkerClient | null) => {
    setAgcClient(c);
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

  /** Perform the barrier handshake and open a fresh lesson attempt.
   *  MUST be called only when there is a live client and an interactive
   *  step. The keypad remains locked until phase transitions to "ready".
   *  When `forLesson.requiresReadinessGate` is true, the AGC must first
   *  satisfy authentic post-restart preconditions before the attempt
   *  boundary is requested — no fast-forward, no injection. */
  const openAttempt = useCallback(async (
    forLesson: LessonDefinition,
    action: "beginAttempt" | "restart",
  ) => {
    const client = agcClient;
    if (!client) return;
    const token = ++openingTokenRef.current;
    setAttemptError(null);

    try {
      if (forLesson.requiresReadinessGate) {
        setAttemptPhase("gating");
        const tracker = new ReadinessTracker();
        readinessTrackerRef.current = tracker;
        // Seed shadow from a Worker-authoritative baseline.
        const seed = await client.requestEventBoundary();
        if (openingTokenRef.current !== token) return;
        tracker.noteBaseline(seed);
        setReadinessSnap(tracker.snapshot());
        // If we happen to already be ready (rare — restart cleared and
        // fixture-stable), skip subscription and proceed.
        if (!tracker.isReady()) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              unsub();
              reject(new Error("Timed out waiting for AGC readiness (RESTART clear + stable scans)."));
            }, 45_000);
            const unsub = client.addListener({
              onChannelUpdate: (ev) => {
                if (openingTokenRef.current !== token) {
                  clearTimeout(timer); unsub(); resolve(); return;
                }
                tracker.applyChannelEvent(ev);
                setReadinessSnap(tracker.snapshot());
                if (tracker.isReady()) {
                  clearTimeout(timer); unsub(); resolve();
                }
              },
            });
          });
          if (openingTokenRef.current !== token) return;
        }
      }

      setAttemptPhase("opening");
      const boundary = await client.requestEventBoundary();
      if (openingTokenRef.current !== token) return;
      setLastBoundary(boundary);
      const seedObs = boundarySeedObservation(boundary, latestSnapshotRef.current);
      setStates((prev) => {
        const cur = prev[forLesson.id] ?? initialLessonState(forLesson);
        const next = stepLesson(forLesson, cur, {
          kind: action,
          attemptId: nextAttemptId(forLesson.id),
          observation: seedObs,
        });
        return { ...prev, [forLesson.id]: next };
      });
      setAttemptPhase("ready");
    } catch (err) {
      if (openingTokenRef.current !== token) return;
      setAttemptError(err instanceof Error ? err.message : String(err));
      setAttemptPhase("error");
    }
  }, [agcClient]);

  // Auto-open an attempt whenever an interactive step becomes current and
  // does not yet have one — but only via the async barrier handshake.
  const openedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agcClient || !isInteractive || isComplete) return;
    const key = `${lesson.id}#${state.currentStepIndex}#${agcEpoch}`;
    if (state.attempt && openedKeyRef.current === key && attemptPhase === "ready") return;
    if (openedKeyRef.current === key && (attemptPhase === "opening" || attemptPhase === "gating")) return;
    openedKeyRef.current = key;
    void openAttempt(lesson, "beginAttempt");
  }, [agcClient, lesson, state.currentStepIndex, state.attempt, isInteractive, isComplete, attemptPhase, agcEpoch, openAttempt]);

  // Reset attempt phase when the selected lesson or step changes so the
  // effect above will re-open a fresh attempt on the next pass.
  useEffect(() => {
    openedKeyRef.current = null;
    ++openingTokenRef.current; // cancel any in-flight open/gate
    setAttemptPhase("idle");
    setLastBoundary(null);
    setAttemptError(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
  }, [selectedId, state.currentStepIndex, agcEpoch]);

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
    ++openingTokenRef.current;
    setAttemptPhase("idle");
    setLastBoundary(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
    setStates((s) => ({ ...s, [lesson.id]: initialLessonState(lesson) }));
  }

  function restartInteractive() {
    if (!isInteractive || !agcClient) return;
    openedKeyRef.current = null;
    void openAttempt(lesson, "restart");
  }

  function resetAgc() {
    setAgcEpoch((n) => n + 1);
    openedKeyRef.current = null;
    ++openingTokenRef.current;
    setAttemptPhase("idle");
    setLastBoundary(null);
    setReadinessSnap(null);
    readinessTrackerRef.current = null;
    setStates(() => {
      const init: Record<string, LessonState> = {};
      for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
      return init;
    });
    latestSnapshotRef.current = null;
  }

  // Test hook: expose current lesson/state/epoch/handshake diagnostics
  // for E2E introspection. Boundary IDs and the latest observed global
  // eventId make cursor-namespace bugs directly assertable.
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
      boundaryEventId: lastBoundary?.boundaryEventId ?? null,
      boundaryTick: lastBoundary?.tickIndex ?? null,
      latestEventId: latestSnapshotRef.current?.latestEventId ?? null,
      snapshot: latestSnapshotRef.current,
      readiness: readinessSnap,
      readinessRequired: lesson.requiresReadinessGate === true,
    };
  }, [lesson, step, state, states, agcEpoch, attemptPhase, attemptError, lastBoundary, readinessSnap]);

  // Interaction lock: DSKY input is suppressed while an interactive attempt
  // is being opened. This prevents a keystroke from carrying an eventId
  // that pre-dates the barrier and could be misattributed to the attempt.
  const dskyDisabled = isInteractive && !isComplete && attemptPhase !== "ready";



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
        <aside aria-label="Lesson list">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
            Lessons
          </h2>
          <ol className="space-y-1">
            {ALL_LESSONS.map((l, i) => {
              const st = states[l.id];
              const done = st?.status === "completed";
              const active = l.id === selectedId;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(l.id)}
                    aria-current={active ? "true" : undefined}
                    className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? "border-emerald-600 bg-emerald-950/40"
                        : "border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-neutral-500">
                        {String(i + 1).padStart(2, "0")}
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
            <div className="mb-4 rounded border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
              Lesson complete. Every step recorded structured evidence — inspect it
              in the recorded evidence panel below or pick another lesson.
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

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {step.kind === "reading" && !isComplete && (
                  <button
                    type="button"
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
                        ? `Waiting for the AGC to complete startup before beginning the lamp test… (RESTART ${readinessSnap?.restartCleared ? "cleared" : "active"}, stable scans ${readinessSnap?.stableConsecutiveScans ?? 0}/1, scans after restart ${readinessSnap?.scansAfterRestart ?? 0}/2)`
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
          <div className="mt-6 rounded border border-neutral-800 bg-neutral-950/60 p-3" data-testid="learn-dsky-panel">
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
                onClient={handleClient}
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
              onStateChange={(next) => setStates((s) => ({ ...s, [lesson.id]: next }))}
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
