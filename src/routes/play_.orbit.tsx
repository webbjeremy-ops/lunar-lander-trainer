// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — /play/orbit — lunar orbital operations and phasing.
//
// PHYSICS FIREWALL: the vehicle is propagated only by the M4.0 planar kernel
// through the pure orbital-operations runtime. No AGC output reaches physics.

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useEffect, useRef } from "react";
import { ORBIT_SCENARIOS, getOrbitScenario } from "@/simulation/orbitOps";
import {
  decodeChallengeRequest,
  publishChallengeResult,
  type ChallengeRequest,
} from "@/learning/handoff";
import { OrbitControls } from "@/ui/orbit/OrbitControls";
import { OrbitDebrief } from "@/ui/orbit/OrbitDebrief";
import { OrbitHud } from "@/ui/orbit/OrbitHud";
import { OrbitMap } from "@/ui/orbit/OrbitMap";
import { OrbitScenarioSelect } from "@/ui/orbit/OrbitScenarioSelect";
import { ManeuverPlannerPanel } from "@/ui/orbit/ManeuverPlannerPanel";
import { useOrbitSession, type OrbitAssistance } from "@/ui/orbit/useOrbitSession";


export const Route = createFileRoute("/play_/orbit")({
  component: OrbitOpsPage,
  head: () => ({
    meta: [
      { title: "Lunar Orbital Operations — Tranquility" },
      {
        name: "description",
        content:
          "Plan and fly lunar orbital manoeuvres: read your orbit, rescue a low periapsis, circularise, and set up a phasing intercept with the Command Module.",
      },
      { property: "og:title", content: "Lunar Orbital Operations — Tranquility" },
      {
        property: "og:description",
        content:
          "Deterministic Moon-centred orbital mechanics: manoeuvre nodes, impulsive previews, finite burns and phasing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const FIRST_ID = Object.values(ORBIT_SCENARIOS).sort((a, b) => a.order - b.order)[0]!
  .id;

/** Read a lesson handoff once, on the client, defensively. */
function readChallenge(): ChallengeRequest | null {
  if (typeof window === "undefined") return null;
  const req = decodeChallengeRequest(window.location.search);
  if (req === null) return null;
  return req.missionId in ORBIT_SCENARIOS ? req : null;
}

function OrbitOpsPage() {
  const [challenge] = useState<ChallengeRequest | null>(readChallenge);
  const [scenarioId, setScenarioId] = useState(challenge?.missionId ?? FIRST_ID);
  const [assistance, setAssistance] = useState<OrbitAssistance>(
    (challenge?.assistance as OrbitAssistance) ?? "instructor",
  );
  const scenario = useMemo(() => getOrbitScenario(scenarioId), [scenarioId]);
  const session = useOrbitSession(scenario, assistance);

  // Publish the result back to /learn exactly once per completed exercise.
  const publishedRef = useRef(false);
  const { complete, score } = session;
  useEffect(() => {
    if (!challenge || publishedRef.current) return;
    if (!complete || score === null) return;
    if (scenarioId !== challenge.missionId) return;
    publishedRef.current = true;
    const el = session.derived.elements;
    publishChallengeResult({
      version: 1,
      lessonId: challenge.lessonId,
      stepId: challenge.stepId,
      missionId: challenge.missionId,
      difficulty: assistance,
      score: score.total,
      maxScore: score.maxTotal,
      grade: score.grade,
      outcome: session.state.outcome,
      passed: score.total >= challenge.passingScore,
      flight: {
        verticalSpeedMps: el.radialSpeedMps,
        horizontalSpeedMps: el.tangentialSpeedMps,
        propellantRemainingKg: session.state.lm.ascentPropellantKg,
        landingZoneErrorM: 0,
        missionTimeS: session.state.lm.missionTimeUs / 1_000_000,
      },
      atMs: Date.now(),
    });
  }, [challenge, complete, score, scenarioId, assistance, session]);

  const objective =
    scenario.objectives[0]?.detail ?? "Fly the exercise and read your orbit.";


  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <header className="mb-4">
        <h1 className="font-mono text-lg uppercase tracking-widest text-neutral-100">
          Lunar orbital operations
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-400">
          {scenario.summary}
        </p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-neutral-600">
          Historically grounded orbital physics · the AGC is not controlling this
          vehicle · terminal rendezvous and docking are out of scope
        </p>
      </header>

      <OrbitScenarioSelect selectedId={scenarioId} onSelect={setScenarioId} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-4">
          <OrbitMap
            state={session.state}
            derived={session.derived}
            coastArc={session.coastArc}
            targetArc={session.targetArc}
            plannedArc={session.plannedArc}
            showPlanned={assistance !== "commander"}
          />
          <OrbitHud
            scenario={scenario}
            state={session.state}
            derived={session.derived}
            node={session.node}
            deltaVAvailableMps={session.deltaVAvailableMps}
            plannedBurnSeconds={session.preview?.estimatedBurnSeconds ?? null}
            massKg={session.massKg}
            activeObjective={objective}
          />
        </div>

        <div className="space-y-4">
          <OrbitControls
            running={session.running}
            timeScale={session.timeScale}
            maxTimeScale={session.maxTimeScale}
            timeScaleReason={session.timeScaleReason}
            assistance={assistance}
            complete={session.complete}
            onRunning={session.actions.setRunning}
            onTimeScale={session.actions.setTimeScale}
            onRestart={session.actions.restart}
            onEnd={session.actions.endExercise}
            onAssistance={setAssistance}
          />
          <ManeuverPlannerPanel
            scenario={scenario}
            assistance={assistance}
            draft={session.draft}
            node={session.node}
            preview={session.preview}
            guided={session.guided}
            phasing={session.phasing}
            burning={session.state.burning}
            missionTimeUs={session.state.lm.missionTimeUs}
            onDraft={session.actions.setDraft}
            onCommit={session.actions.commitNode}
            onClear={session.actions.clearNode}
            onAdopt={session.actions.adoptSolution}
            onIgnite={session.actions.startBurn}
            onCutoff={session.actions.stopBurn}
          />
          <section
            className="rounded border border-neutral-800 bg-neutral-950 p-3"
            aria-label="Objective status"
            data-testid="orbit-conditions"
          >
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Success conditions
            </h3>
            <ul className="mt-2 space-y-1">
              {session.conditions.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-[11px]">
                  <span className={c.met ? "text-emerald-400" : "text-neutral-600"}>
                    {c.met ? "✓" : "○"}
                  </span>
                  <span className="text-neutral-400">{c.description}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {session.complete && (
        <div className="mt-4">
          <OrbitDebrief
            scenario={scenario}
            score={session.score}
            entries={session.debrief}
            banner={session.terminalBanner}
            traceChecksum={session.traceChecksum}
            onRestart={session.actions.restart}
          />
        </div>
      )}
    </main>
  );
}
