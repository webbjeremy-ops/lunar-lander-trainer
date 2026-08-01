// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — /play/ascent : lunar liftoff and orbital insertion.
//
// PHYSICS FIREWALL: the ascent stage is flown by the player (or by the game's
// own clearly-labelled demonstration autopilot). The AGC never commands the
// vehicle, and the vehicle never writes to the AGC. The DSKY beside the
// cockpit is the authentic shared Luminary099 session, shown for study.

import { createFileRoute, ClientOnly, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Dsky } from "@/ui/dsky/Dsky";
import { useAgcSession } from "@/agc/AgcSession";
import { OrbitVisualizer } from "@/ui/ascent/OrbitVisualizer";
import { AscentHud } from "@/ui/ascent/AscentHud";
import { AscentControls } from "@/ui/ascent/AscentControls";
import { AscentMissionSelect } from "@/ui/ascent/AscentMissionSelect";
import { AscentDebrief } from "@/ui/ascent/AscentDebrief";
import { useAscentSession, ASCENT_TIME_SCALES } from "@/ui/ascent/useAscentSession";
import {
  ASCENT_MISSIONS,
  type AscentMissionId,
  type AssistanceLevel,
} from "@/game/ascent";

export const Route = createFileRoute("/play_/ascent")({
  head: () => ({
    meta: [
      { title: "Lunar Liftoff and Orbital Insertion · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Fly the Apollo lunar ascent: stage the descent stage, hold the vertical rise, pitch over and insert into a 9 by 45 nautical-mile lunar orbit.",
      },
      { property: "og:title", content: "Lunar Liftoff and Orbital Insertion" },
      {
        property: "og:description",
        content:
          "Four ascent missions on a deterministic planar flight model, with the authentic Luminary 099 DSKY beside the cockpit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AscentPage,
});

function AscentPage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          Lunar ascent · liftoff and orbital insertion
        </h1>
        <p className="mt-1 text-xs text-neutral-400">
          Liftoff, pitch program and orbital insertion.{" "}
          <Link className="text-emerald-400" to="/missions">All missions</Link> ·{" "}
          <Link className="text-emerald-400" to="/play">Descent</Link> ·{" "}
          <Link className="text-emerald-400" to="/learn">Learn</Link> ·{" "}
          <Link className="text-emerald-400" to="/sources">Sources</Link>
        </p>
      </header>
      <p className="orientation-hint border-b border-amber-900/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
        Rotate your device to landscape — the cockpit needs the width.
      </p>
      <RouteErrorBoundary title="The ascent cockpit stopped responding">
        <ClientOnly fallback={<div className="p-6 text-xs text-neutral-500">Loading cockpit…</div>}>
          <AscentClient />
        </ClientOnly>
      </RouteErrorBoundary>
    </main>
  );
}

function AscentClient() {
  const { settings } = useSettings();
  const [missionId, setMissionId] = useState<AscentMissionId>("liftoff-fundamentals");
  const [assistance, setAssistance] = useState<AssistanceLevel>(
    settings.defaultAssistance as AssistanceLevel,
  );
  const [started, setStarted] = useState(false);


  const mission = ASCENT_MISSIONS[missionId];
  const session = useAscentSession(mission, assistance);
  const agc = useAgcSession();
  const handleKey = useCallback((_code: number | "PRO") => {
    // The ascent game never reacts to DSKY input: the AGC panel is authentic
    // but diagnostic. Keystrokes go to the rope, not to the vehicle.
  }, []);

  if (!started) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        <AscentMissionSelect
          missionId={missionId}
          assistance={assistance}
          onMission={setMissionId}
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
    <section className="mx-auto max-w-[1400px] space-y-4 px-4 py-4" data-testid="ascent-cockpit">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStarted(false)}
          data-testid="ascent-back"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          ← Missions
        </button>
        <span className="font-mono text-xs text-neutral-300">{mission.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
          {assistance}
        </span>
        <span className="ml-auto font-mono text-[10px] text-neutral-500" data-testid="ascent-met">
          MET {(session.flight.missionTimeUs / 1_000_000).toFixed(1)} s
        </span>
        <button
          onClick={() => session.actions.setRunning(!session.running)}
          disabled={!session.lifted || session.complete}
          data-testid="ascent-runpause"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 disabled:opacity-40"
        >
          {session.running ? "Pause" : "Run"}
        </button>
        <select
          aria-label="Time scale"
          data-testid="ascent-timescale"
          value={session.timeScale}
          onChange={(e) => session.actions.setTimeScale(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 font-mono text-[10px] text-neutral-200"
        >
          {ASCENT_TIME_SCALES.map((s) => (
            <option key={s} value={s}>{s === 0 ? "HOLD" : `${s}×`}</option>
          ))}
        </select>
        <button
          onClick={() => session.actions.restart()}
          data-testid="ascent-reset"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          Restart
        </button>
      </div>

      {!session.lifted && (
        <div
          className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
          data-testid="surface-preparation"
        >
          Surface preparation. The descent stage stays on the Moon as the launch
          platform: pressing liftoff jettisons it and ignites the ascent engine,
          which is not throttleable and cannot be shut down and relit outside the
          sandbox.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <OrbitVisualizer
            flight={session.flight}
            orbit={session.orbit}
            target={session.target}
            coastArc={session.coastArc}
            recommendedPitchRad={session.guidance.recommendedPitchRad}
            showCue={assistance !== "commander" && !session.cutoff}
          />
          <AscentHud
            flight={session.flight}
            orbit={session.orbit}
            guidance={session.guidance}
            target={session.target}
            targetError={session.targetError}
            massKg={session.massKg}
            deltaVRemainingMps={session.deltaVRemainingMps}
            timeToApoapsisS={session.timeToApoapsisS}
            assistance={assistance}
            mission={mission}
            burnElapsedS={session.burnElapsedS}
          />
          <AscentControls
            controls={session.controls}
            lifted={session.lifted}
            cutoff={session.cutoff}
            sandbox={mission.sandbox}
            complete={session.complete}
            demonstration={session.demonstration}
            onLiftoff={session.actions.liftoff}
            onCutoff={session.actions.commandCutoff}
            onRelight={session.actions.relight}
            onPitch={session.actions.setPitchCommand}
            onDemonstration={session.actions.setDemonstration}
            onEndFlight={session.actions.endFlight}
          />
        </div>

        <div className="space-y-3">
          <div className="rounded border border-neutral-800 bg-neutral-950 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500">
                Live AGC · Luminary 099
              </span>
              <span className="font-mono text-[9px] text-neutral-600">shared session</span>
            </div>
            <p className="mb-2 rounded border border-neutral-800 bg-black/50 px-2 py-1 text-[10px] leading-snug text-neutral-500">
              Authentic AGC emulator · historically grounded ascent physics ·{" "}
              <span className="text-amber-400">
                the AGC is not controlling this vehicle
              </span>
              . Luminary's ascent program P12 is not started here, so the cues in
              the HUD are educational, not rope-driven.
            </p>
            {agc.client ? (
              <Dsky
                rope={agc.rope}
                sharedClient={agc.client}
                sharedReady={agc.ready}
                onKeyPress={handleKey}
                compact
              />
            ) : (
              <div className="p-3 text-xs text-neutral-500">Starting the AGC…</div>
            )}
          </div>
        </div>
      </div>

      {session.summary && session.score && (
        <AscentDebrief
          mission={mission}
          summary={session.summary}
          score={session.score}
          onRestart={() => session.actions.restart()}
          onChangeMission={() => setStarted(false)}
        />
      )}

      <p className="text-[10px] leading-snug text-neutral-600">
        Flight dynamics come from the deterministic planar kernel (M4.0) with the
        Apollo ascent-propulsion constants; the target orbits are the published
        Apollo 11 values. The browser trajectory does not reproduce Eagle's actual
        ascent. Not endorsed by NASA.
      </p>
    </section>
  );
}
