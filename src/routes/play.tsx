// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — /play : the player-facing Apollo 11 lunar-descent vertical slice.
//
// /sim remains the laboratory. This route is the game: mission briefing,
// Apollo-style cockpit, live Luminary 099 DSKY on the shared session, and a
// post-flight debrief.
//
// PHYSICS FIREWALL: the vehicle is flown by the player and by the game's own
// advisory guidance. The AGC never commands the vehicle, and the vehicle
// never writes to the AGC.

import { createFileRoute, ClientOnly, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dsky } from "@/ui/dsky/Dsky";
import { useAgcSession } from "@/agc/AgcSession";
import { LunarScene } from "@/ui/play/LunarScene";
import { FlightInstruments } from "@/ui/play/FlightInstruments";
import { FlightControls } from "@/ui/play/FlightControls";
import { ProcedurePanel } from "@/ui/play/ProcedurePanel";
import { IgnitionPanel } from "@/ui/play/IgnitionPanel";
import { AttitudePanel } from "@/ui/play/AttitudePanel";
import { FdaiBall } from "@/ui/play/FdaiBall";
import { CalloutOverlay } from "@/ui/play/CalloutOverlay";
import { CautionWarningPanel } from "@/ui/play/CautionWarningPanel";
import { DebriefPanel } from "@/ui/play/DebriefPanel";
import { MissionSelect } from "@/ui/play/MissionSelect";
import { usePlaySession, PLAY_TIME_SCALES } from "@/ui/play/usePlaySession";
import {
  decodeChallengeRequest,
  publishChallengeResult,
  type ChallengeRequest,
} from "@/learning/handoff";
import {
  LANDING_LIMITS,
  MISSIONS,
  type AssistanceLevel,
  type ControlModeId,
  type MissionId,
} from "@/game/play";
import { useSettings } from "@/settings/SettingsProvider";
import { RouteErrorBoundary } from "@/ui/shell/Reliability";



export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Fly the Apollo 11 Lunar Descent · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Fly a historically grounded Apollo 11 lunar descent: real Luminary 099 DSKY procedures, P63/P64/P66 progression, and a deterministic planar flight model.",
      },
      { property: "og:title", content: "Fly the Apollo 11 Lunar Descent" },
      {
        property: "og:description",
        content:
          "Five missions, three assistance levels, and the real Apollo Guidance Computer beside you in the cockpit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlayPage,
});

function PlayPage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          Lunar descent · fly the landing
        </h1>
        <p className="mt-1 text-xs text-neutral-400">
          Fly the descent with the real Apollo Guidance Computer beside you.{" "}
          <Link className="text-emerald-400" to="/missions">All missions</Link> ·{" "}
          <Link className="text-emerald-400" to="/play/ascent">Lunar ascent</Link> ·{" "}
          <Link className="text-emerald-400" to="/sim">AGC Lab</Link> ·{" "}
          <Link className="text-emerald-400" to="/learn">Learn</Link> ·{" "}
          <Link className="text-emerald-400" to="/sources">Sources</Link>
        </p>
      </header>
      <p className="orientation-hint border-b border-amber-900/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
        Rotate your device to landscape — the cockpit needs the width.
      </p>
      <RouteErrorBoundary title="The cockpit stopped responding">
        <ClientOnly fallback={<div className="p-6 text-xs text-neutral-500">Loading cockpit…</div>}>
          <PlayClient />
        </ClientOnly>
      </RouteErrorBoundary>
    </main>
  );
}

function PlayClient() {
  const { settings } = useSettings();

  // M4.2 — an incoming lesson challenge preselects and auto-starts the flight.
  const challenge = useMemo<ChallengeRequest | null>(() => {
    if (typeof window === "undefined") return null;
    const req = decodeChallengeRequest(window.location.search);
    if (!req) return null;
    return req.missionId in MISSIONS ? req : null;
  }, []);

  const [missionId, setMissionId] = useState<MissionId>(
    (challenge?.missionId as MissionId) ?? "landing-fundamentals",
  );
  const [controlMode, setControlMode] = useState<ControlModeId>(
    (challenge?.controlMode as ControlModeId) ?? "quick-manual",
  );
  // Onboarding / Settings choose the starting assistance level; a lesson
  // challenge always wins, because its score threshold assumes that level.
  const [assistance, setAssistance] = useState<AssistanceLevel>(
    (challenge?.assistance as AssistanceLevel) ?? (settings.defaultAssistance as AssistanceLevel),
  );

  const [started, setStarted] = useState(false);

  const mission = MISSIONS[missionId];
  const limits = LANDING_LIMITS[assistance];
  const session = usePlaySession(mission, controlMode, assistance);
  const agc = useAgcSession();

  const onDskyKey = session.actions.onDskyKey;
  const handleKey = useCallback((code: number | "PRO") => onDskyKey(code), [onDskyKey]);

  // Publish the flight result back to the originating lesson exactly once.
  const publishedRef = useRef(false);
  const { summary, score } = session;
  useEffect(() => {
    if (!challenge || publishedRef.current) return;
    if (!summary || !score) return;
    publishedRef.current = true;
    const s = summary.finalState;
    const r = Math.hypot(s.positionM[0], s.positionM[1]) || 1;
    const ur: [number, number] = [s.positionM[0] / r, s.positionM[1] / r];
    const vertical = s.velocityMps[0] * ur[0] + s.velocityMps[1] * ur[1];
    const horizontal = s.velocityMps[0] * -ur[1] + s.velocityMps[1] * ur[0];
    publishChallengeResult({
      version: 1,
      lessonId: challenge.lessonId,
      stepId: challenge.stepId,
      missionId: challenge.missionId,
      difficulty: assistance,
      score: score.total,
      maxScore: score.maxTotal,
      grade: score.grade,
      outcome: score.outcome,
      passed: score.total >= challenge.passingScore && score.outcome === "landed",
      flight: {
        verticalSpeedMps: summary.finalState.touchdown?.verticalSpeedMps ?? vertical,
        horizontalSpeedMps: summary.finalState.touchdown?.horizontalSpeedMps ?? horizontal,
        propellantRemainingKg: summary.descentPropellantRemainingKg,
        landingZoneErrorM: summary.landingZoneErrorM,
        missionTimeS: s.missionTimeUs / 1_000_000,
      },
      atMs: Date.now(),
    });
  }, [challenge, summary, score, assistance]);

  if (!started) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        {challenge && (
          <div
            className="mb-4 rounded border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200"
            data-testid="challenge-briefing"
          >
            Lesson challenge — fly {mission.title} at {assistance} and score at
            least {challenge.passingScore} to complete the lesson.
          </div>
        )}

        <MissionSelect
          missionId={missionId}
          controlMode={controlMode}
          assistance={assistance}
          onMission={setMissionId}
          onControlMode={setControlMode}
          onAssistance={setAssistance}
          onStart={() => {
            session.actions.restart();
            setStarted(true);
          }}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[1400px] space-y-4 px-4 py-4" data-testid="play-cockpit">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStarted(false)}
          data-testid="play-back"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          ← Missions
        </button>
        <span className="font-mono text-xs text-neutral-300">{mission.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
          {controlMode} · {assistance}
        </span>
        <span className="ml-auto font-mono text-[10px] text-neutral-500" data-testid="play-met">
          MET {(session.flight.missionTimeUs / 1_000_000).toFixed(1)} s
        </span>
        <button
          onClick={() => session.actions.setRunning(!session.running)}
          disabled={!session.flightLockReleased || session.flight.terminalState !== null}
          data-testid="play-runpause"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 disabled:opacity-40"
        >
          {session.running ? "Pause" : "Run"}
        </button>
        <select
          aria-label="Time scale"
          data-testid="play-timescale"
          value={session.timeScale}
          onChange={(e) => session.actions.setTimeScale(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 font-mono text-[10px] text-neutral-200"
        >
          {PLAY_TIME_SCALES.map((s) => (
            <option key={s} value={s}>{s === 0 ? "HOLD" : `${s}×`}</option>
          ))}
        </select>
        {session.ignition.phase === "standby" && session.flight.terminalState === null && (
          <button
            onClick={() => session.actions.startIgnitionCountdown()}
            data-testid="play-start-pdi"
            className="rounded border border-amber-600 bg-amber-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-900/40"
          >
            Start PDI countdown (T−60)
          </button>
        )}
        <button
          onClick={() => session.actions.restart()}
          data-testid="play-restart"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          Restart
        </button>
      </div>

      {!session.flightLockReleased && (
        <div
          className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
          data-testid="flight-lock"
        >
          Flight is held until the crew procedure reaches ignition. Work the
          DSKY steps on the right — or press “Take manual control now”.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <CalloutOverlay
            callout={session.callout}
            onAcknowledge={session.actions.acknowledgeCallout}
          />
          <LunarScene
            flight={session.flight}
            orbit={session.orbit}
            downrangeM={session.downrangeM}
            mission={mission}
            limits={limits}
            manual={session.manualUnlocked}
            rollDeg={session.roll.rollDeg}
          />
          <FlightInstruments
            flight={session.flight}
            orbit={session.orbit}
            guidance={session.guidance}
            massKg={session.massKg}
            downrangeM={session.downrangeM}
            throttle={session.controls.throttle}
            limits={limits}
            assistance={assistance}
            initialPropellantKg={mission.initial.descentPropellantKg}
          />
          <FlightControls
            manual={session.manualUnlocked}
            throttle={session.controls.throttle}
            engineOn={session.controls.engineOn}
            onAttitude={session.actions.setAttitudeCommand}
            onThrottle={session.actions.adjustThrottle}
            onEngine={session.actions.setEngine}
            onRod={session.actions.trimRod}
          />
        </div>

        <div className="space-y-3">
          <FdaiBall
            pitchDeg={(session.flight.attitudeRad * 180) / Math.PI}
            rollDeg={session.roll.rollDeg}
            pitchRateDegPerSec={(session.flight.angularRateRadPerSec * 180) / Math.PI}
            rollRateDegPerSec={session.roll.phase === "rolling" ? -10 : 0}
            valid={session.flight.terminalState !== "crashed"}
          />

          {session.ignition.phase !== "standby" && (
            <IgnitionPanel
              state={session.ignition}
              clock={session.ignitionClock}
              onArm={session.actions.setEngineArm}
            />
          )}

          {session.ignition.phase !== "standby" && (
            <AttitudePanel
              roll={session.roll}
              alarms={session.alarms}
              onRoll={session.actions.setRollCommand}
            />
          )}

          <ProcedurePanel
            script={session.script}
            state={session.procedure}
            step={session.step}
            onHint={session.actions.requestHint}
            onTakeover={session.actions.takeover}
          />

          <div className="rounded border border-neutral-800 bg-neutral-950 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500">
                Live AGC · Luminary 099
              </span>
              <span className="font-mono text-[9px] text-neutral-600">shared session</span>
            </div>
            {agc.client ? (
              <Dsky
                rope={agc.rope}
                sharedClient={agc.client}
                sharedReady={agc.ready}
                onKeyPress={handleKey}
                bridgedRequest={session.bridgedAlarm ?? session.bridgedDskyRequest}
                bridgedRegisters={
                  session.procedure.completedStepIds.includes("p63-select")
                    ? session.descentMonitor
                    : null
                }
                compact
              />
            ) : (
              <div className="p-3 text-xs text-neutral-500">Starting the AGC…</div>
            )}
          </div>
        </div>
      </div>

      {session.summary && session.score && (
        <>
          <DebriefPanel
            mission={mission}
            summary={session.summary}
            score={session.score}
            onRestart={() => {
              publishedRef.current = false;
              session.actions.restart();
            }}
            onChangeMission={() => setStarted(false)}
          />
          {challenge && (
            <Link
              to="/learn"
              data-testid="return-to-lesson"
              className="inline-block rounded border border-emerald-600 bg-emerald-950/40 px-3 py-2 font-mono text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
            >
              Return to the lesson with this result
            </Link>
          )}
        </>
      )}


      <p className="text-[10px] leading-snug text-neutral-600">
        The Apollo Guidance Computer shown here runs authentic Luminary 099 and
        is fully interactive, but it does not fly the vehicle: closed-loop AGC
        control is deliberately out of scope. Flight dynamics come from the
        deterministic planar kernel (M4.0). Not endorsed by NASA.
      </p>
    </section>
  );
}
