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
import type { StateSnapshot } from "@/agc/protocol";

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

/** Seed observation from the LIVE snapshot so attempt.startedAtCursor and
 *  startedAtTick reflect the current worker event-log position — this is
 *  what makes stale evidence from a prior attempt fall out of scope. */
function liveSeedObservation(snap: StateSnapshot | null, fallbackTick: number): LessonObservation {
  if (!snap) return inertObservation(fallbackTick);
  return {
    decoded: snap.decodedDsky ?? makeEmptyDecodedDsky(),
    previousDecoded: null,
    snapshot: snap,
    recentInputs: [],
    recentChannelEvents: [],
    eventLogCursor: snap.channelEventCount,
    tickIndex: snap.tickIndex,
    missionTimeUs: snap.missionTimeUs,
    provenance: FIXTURE_PROVENANCE,
  };
}

let ATTEMPT_SEQ = 0;
function nextAttemptId(lessonId: string): string {
  return `att-${lessonId}-${Date.now().toString(36)}-${++ATTEMPT_SEQ}`;
}

function LearnPage() {
  const rope = useMemo(() => ropeById("Luminary099"), []);
  const [selectedId, setSelectedId] = useState<string>(ALL_LESSONS[0]!.id);
  const [states, setStates] = useState<Record<string, LessonState>>(() => {
    const init: Record<string, LessonState> = {};
    for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
    return init;
  });

  // ---- Shared AGC session for the whole /learn route (stable ownership).
  // The Dsky component owns exactly ONE AgcWorkerClient here; lesson
  // navigation must NOT recreate it. We only remount on explicit user
  // "Reset AGC" (agcEpoch bump) or on route unmount.
  const [agcEpoch, setAgcEpoch] = useState(0);
  const [agcClient, setAgcClient] = useState<AgcWorkerClient | null>(null);
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);

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

  // Open a fresh attempt every time an interactive lesson is (re)selected.
  // We track the "last lesson we opened an attempt for" so switching away
  // and back always creates a brand-new attempt boundary — that boundary
  // is seeded from the LIVE snapshot cursor so any evidence produced
  // before now is out of scope.
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isInteractive || isComplete) return;
    // Key by selected lesson + step so re-entering re-opens.
    const key = `${lesson.id}#${state.currentStepIndex}`;
    if (openedForRef.current === key && state.attempt) return;
    openedForRef.current = key;
    const seed = liveSeedObservation(latestSnapshotRef.current, state.lastObservationTick + 1);
    const next = stepLesson(lesson, state, {
      kind: "beginAttempt",
      attemptId: nextAttemptId(lesson.id),
      observation: seed,
    });
    setStates((s) => ({ ...s, [lesson.id]: next }));
  }, [lesson, state, isInteractive, isComplete]);

  // Reset the "opened for" tracker when the selected lesson changes, so
  // returning to a previously-visited interactive lesson re-opens a fresh
  // attempt on the next effect pass.
  useEffect(() => {
    openedForRef.current = null;
  }, [selectedId]);

  function ackCurrent() {
    if (!step || step.kind !== "reading") return;
    const next = stepLesson(lesson, state, {
      kind: "acknowledgeStep",
      observation: inertObservation(state.lastObservationTick + 1),
    });
    setStates((s) => ({ ...s, [lesson.id]: next }));
  }

  function resetLesson() {
    openedForRef.current = null;
    setStates((s) => ({ ...s, [lesson.id]: initialLessonState(lesson) }));
  }

  function restartInteractive() {
    if (!isInteractive) return;
    const seed = liveSeedObservation(latestSnapshotRef.current, state.lastObservationTick + 1);
    const next = stepLesson(lesson, state, {
      kind: "restart",
      attemptId: nextAttemptId(lesson.id),
      observation: seed,
    });
    setStates((s) => ({ ...s, [lesson.id]: next }));
  }

  function resetAgc() {
    // Explicit AGC session boundary — this is the ONLY control that tears
    // down the Worker and starts a new event-log epoch.
    setAgcEpoch((n) => n + 1);
    openedForRef.current = null;
    // Also invalidate any open attempt cursors: they refer to the old
    // event-log epoch. Simplest: reset all lesson states.
    setStates(() => {
      const init: Record<string, LessonState> = {};
      for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
      return init;
    });
    latestSnapshotRef.current = null;
  }

  // Test hook: expose current lesson/state/epoch for E2E introspection.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __learnTest?: unknown }).__learnTest = {
      lessonId: lesson.id,
      state,
      states,
      agcEpoch,
    };
  }, [lesson, state, states, agcEpoch]);



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
                    <p className="text-xs text-amber-300">
                      This step waits for authentic AGC output from the live
                      Worker below. The lesson engine only advances when
                      Luminary099 produces the required channel events.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="ctl-restart-attempt"
                        onClick={restartInteractive}
                        className="rounded border border-amber-600 bg-amber-950/30 px-3 py-2 font-mono text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-900/40"
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
              />
            </ClientOnly>
            {/* Non-visual lesson observer — subscribes to shared client.
                Renders one lesson-status live region only. */}
            <LessonHost
              client={agcClient}
              lesson={lesson}
              state={state}
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
