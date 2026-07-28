// SPDX-License-Identifier: GPL-3.0-or-later
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_LESSONS } from "@/lessons/content";
import { SOURCE_REGISTRY } from "@/lessons/SourceRegistry";
import { initialLessonState, stepLesson } from "@/lessons/LessonEngine";
import type { LessonDefinition, LessonState } from "@/lessons/types";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import { LessonHost } from "@/lessons/LessonHost";

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

function makeInertObservation(tick: number) {
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

function LearnPage() {
  const [selectedId, setSelectedId] = useState<string>(ALL_LESSONS[0]!.id);
  const [states, setStates] = useState<Record<string, LessonState>>(() => {
    const init: Record<string, LessonState> = {};
    for (const l of ALL_LESSONS) init[l.id] = initialLessonState(l);
    return init;
  });

  const lesson = useMemo<LessonDefinition>(
    () => ALL_LESSONS.find((l) => l.id === selectedId) ?? ALL_LESSONS[0]!,
    [selectedId],
  );
  const state = states[lesson.id] ?? initialLessonState(lesson);
  const step = lesson.steps[state.currentStepIndex] ?? null;
  const isInteractive = step?.kind === "interactive";
  const isComplete = state.status === "completed";

  function ackCurrent() {
    if (!step || step.kind !== "reading") return;
    const next = stepLesson(lesson, state, {
      kind: "acknowledgeStep",
      observation: makeInertObservation(state.lastObservationTick + 1),
    });
    setStates((s) => ({ ...s, [lesson.id]: next }));
  }

  function resetLesson() {
    setStates((s) => ({ ...s, [lesson.id]: initialLessonState(lesson) }));
  }

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
            <button
              type="button"
              onClick={resetLesson}
              className="rounded border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-400 hover:bg-neutral-900"
            >
              Reset
            </button>
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
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-amber-300">
                      This step waits for authentic AGC output. Open the DSKY and follow the instructions above — the lesson engine will only advance when Luminary099 produces the required channel events.
                    </p>
                    <Link
                      to="/sim"
                      className="inline-flex w-fit rounded border border-amber-500 bg-amber-950/30 px-3 py-2 font-mono text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-900/40"
                    >
                      Open the DSKY →
                    </Link>
                  </div>
                )}
              </div>
            </article>
          ) : (
            <p className="text-sm text-neutral-500">No step selected.</p>
          )}

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
