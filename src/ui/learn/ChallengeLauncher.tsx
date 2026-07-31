// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — Lesson → /play launcher and the returning-result debrief card.

import type { LessonChallengeSpec } from "@/lessons/types";
import { encodeChallengeRequest, type ChallengeResult } from "@/learning/handoff";

export function ChallengeLauncher({
  lessonId,
  stepId,
  challenge,
  label,
}: {
  lessonId: string;
  stepId: string;
  challenge: LessonChallengeSpec;
  label: string;
}) {
  const search = encodeChallengeRequest({
    version: 1,
    lessonId,
    stepId,
    missionId: challenge.missionId,
    assistance: challenge.assistance,
    controlMode: challenge.controlMode,
    passingScore: challenge.passingScore,
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={`/play?${search}`}
        data-testid="lesson-fly-it"
        className="rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
      >
        {label}
      </a>
      <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
        {challenge.missionId} · {challenge.assistance} · pass ≥ {challenge.passingScore}
      </span>
    </div>
  );
}

export function ChallengeResultCard({ result }: { result: ChallengeResult }) {
  return (
    <section
      className={`mt-4 rounded border p-4 ${
        result.passed
          ? "border-emerald-700 bg-emerald-950/30"
          : "border-amber-700 bg-amber-950/20"
      }`}
      data-testid="lesson-challenge-result"
      aria-label="Your flight result"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-emerald-500 px-2 py-[2px] font-mono text-[9px] uppercase tracking-widest text-emerald-300">
          Your flight data
        </span>
        <h4 className="font-mono text-xs uppercase tracking-widest text-neutral-200">
          {result.missionId} · {result.difficulty}
        </h4>
      </div>
      <p className="mt-2 font-mono text-sm text-neutral-100" data-testid="lesson-result-score">
        {result.outcome} — {result.score}/{result.maxScore} points · grade {result.grade}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-neutral-400 sm:grid-cols-3">
        <div>
          <dt className="text-neutral-500">Sink at contact</dt>
          <dd className="text-neutral-200">{result.flight.verticalSpeedMps.toFixed(2)} m/s</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Lateral drift</dt>
          <dd className="text-neutral-200">{result.flight.horizontalSpeedMps.toFixed(2)} m/s</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Propellant left</dt>
          <dd className="text-neutral-200">{result.flight.propellantRemainingKg.toFixed(0)} kg</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Zone error</dt>
          <dd className="text-neutral-200">{result.flight.landingZoneErrorM.toFixed(0)} m</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Flight time</dt>
          <dd className="text-neutral-200">{result.flight.missionTimeS.toFixed(0)} s</dd>
        </div>
      </dl>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
        Gameplay tuned scoring · flight state from the M4.0 deterministic kernel
      </p>
    </section>
  );
}
