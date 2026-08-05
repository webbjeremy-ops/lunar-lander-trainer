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
import { CockpitStation } from "@/ui/play/CockpitStation";


import { FlightInstruments } from "@/ui/play/FlightInstruments";
import { FlightControls } from "@/ui/play/FlightControls";
import { GamepadLegend } from "@/ui/play/GamepadLegend";
import { ProcedurePanel } from "@/ui/play/ProcedurePanel";
import { ProcedureCoach } from "@/ui/play/ProcedureCoach";
import { IgnitionPanel } from "@/ui/play/IgnitionPanel";
import { AttitudePanel } from "@/ui/play/AttitudePanel";
import { FdaiBall } from "@/ui/play/FdaiBall";
import { CalloutOverlay } from "@/ui/play/CalloutOverlay";
import { V99CueOverlay } from "@/ui/play/V99CueOverlay";

import { HoustonOverlay } from "@/ui/play/HoustonOverlay";
import { useDescentScore } from "@/ui/play/useDescentScore";
import { useDescentSfx } from "@/ui/play/useDescentSfx";
import { useMissionAudio } from "@/ui/play/useMissionAudio";
import { useCabinMusic } from "@/ui/play/useCabinMusic";
import { CabinTapePlayer } from "@/ui/play/CabinTapePlayer";

import eagleLandedAudio from "@/assets/eagle-has-landed.mp3.asset.json";



import { CautionWarningPanel } from "@/ui/play/CautionWarningPanel";
import { ContactLight } from "@/ui/play/ContactLight";
import { contactLightState } from "@/game/play/contactLight";
import { DebriefPanel } from "@/ui/play/DebriefPanel";
import { MissionSelect } from "@/ui/play/MissionSelect";
import {
  detectDefaultScheme,
  isMobileDevice,
  setActiveControlScheme,
  type ControlSchemeId,
} from "@/ui/play/controlScheme";
import { usePlaySession, PLAY_TIME_SCALES } from "@/ui/play/usePlaySession";
import {
  decodeChallengeRequest,
  publishChallengeResult,
  type ChallengeRequest,
} from "@/learning/handoff";
import {
  LANDING_LIMITS,
  MISSIONS,
  milestoneSec,
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
    <main className="min-h-screen lm-bay text-neutral-100">
      <header className="lm-placard lm-rivets px-4 py-3">
        <h1 className="lm-legend text-sm font-semibold uppercase">
          Lunar descent · fly the landing
        </h1>
        <p className="mt-1 text-xs text-neutral-200/80">
          Fly the descent with the real Apollo Guidance Computer beside you.{" "}
          <Link className="text-emerald-200 underline underline-offset-2" to="/missions">All missions</Link> ·{" "}
          <Link className="text-emerald-200 underline underline-offset-2" to="/sim">AGC Lab</Link> ·{" "}
          <Link className="text-emerald-200 underline underline-offset-2" to="/learn">Learn</Link> ·{" "}
          <Link className="text-emerald-200 underline underline-offset-2" to="/sources">Sources</Link>
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

  // M4.57 — how the player flies: keyboard or an Xbox pad.
  // Phones and tablets are locked to touch; nothing else exists there.
  const [scheme, setScheme] = useState<ControlSchemeId>("desktop");
  const [schemeLocked, setSchemeLocked] = useState(false);
  useEffect(() => {
    const detected = detectDefaultScheme();
    const locked = isMobileDevice();
    setSchemeLocked(locked);
    setScheme(locked ? "touch" : detected);
  }, []);
  useEffect(() => {
    setActiveControlScheme(scheme);
  }, [scheme]);

  // M4.47 — once the flight is live the cockpit owns the pad: the shell's
  // D-pad focus navigation stands down while this flag is set.
  useEffect(() => {
    if (!started) return;
    document.body.dataset["gamepadOwner"] = "gameplay";
    return () => {
      delete document.body.dataset["gamepadOwner"];
    };
  }, [started]);


  // M4.43 — controller rumble is a cockpit cue, so it must be silent while the
  // player is still on the mission-select screen (the session simulates behind
  // it). The player's preference is kept here and applied to the session only
  // once the mission is under way.
  const [hapticsPref, setHapticsPref] = useState(true);


  // M4.34 — out-the-window first-person view toggle.
  // The commander's window is the default view: it is the only one that shows
  // the surface actually moving (crater field sweeping aft) during braking.
  const [firstPerson, setFirstPerson] = useState(true);

  // "V" toggles the commander's window view without leaving the controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyV" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      setFirstPerson((v) => !v);
    };
    const onPadToggle = () => setFirstPerson((v) => !v);
    window.addEventListener("keydown", onKey);
    window.addEventListener("tranquility:toggle-view", onPadToggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("tranquility:toggle-view", onPadToggle);
    };
  }, []);



  const mission = MISSIONS[missionId];
  const limits = LANDING_LIMITS[assistance];
  const session = usePlaySession(mission, controlMode, assistance);

  // M4.32 — while an air-to-ground recording is on the loop, everything else
  // drops to a background level (never off) so the crew is intelligible.
  const [missionDuck, setMissionDuck] = useState(1);

  // M4.57 — cabin tape player. While a tape plays it replaces the procedural
  // score outright; sound effects stay, a little quieter.
  const cabinMusic = useCabinMusic(missionDuck);

  const musicScore = useDescentScore({
    sinceIgnitionSec: session.descentClock.sinceIgnitionUs / 1_000_000,
    altitudeM: session.orbit.altitudeM,
    propellantFraction:
      mission.initial.descentPropellantKg > 0
        ? session.flight.descentPropellantKg / mission.initial.descentPropellantKg
        : 0,
    houstonStage: session.escalation.stage,
    crewAborted: session.aborted,
    terminal: session.flight.terminalState !== null,
    running: session.running,
    duck: cabinMusic.playing ? 0 : missionDuck,
  });


  // M4.43 — cockpit audio only exists once the crew is actually flying. The
  // session simulates behind the mission-select screen, so without the
  // `started` gate the ignition recording and the DPS bed fired while the
  // player was still choosing a mission. And the DPS counts as lit only once
  // the descent clock runs: during the pre-TIG coast the engine command can
  // flicker on for a frame before the countdown gate clamps it cold.
  const audioLive = musicScore.enabled && started;

  const setHaptics = session.actions.setHaptics;
  useEffect(() => {
    setHaptics(hapticsPref && started);
  }, [setHaptics, hapticsPref, started]);

  const engineLit =
    audioLive && session.controls.engineOn && session.descentClock.mode === "running";

  // M4.26 — cockpit sound effects share the score's on/off state: DPS bed and
  // ignition swell from the live throttle, master alarm from the 1201/1202
  // lamp, contact chime from the footpad probes.
  useDescentSfx({
    enabled: audioLive,
    throttle: engineLit ? session.controls.throttle : 0,
    engineOn: engineLit,
    alarmActive: session.alarms.lampOn,
    contact: session.orbit.altitudeM <= 1.7 && session.flight.terminalState !== "crashed",
    running: session.running,
    duck: missionDuck,
  });

  // M4.56 — descent propellant remaining as a fraction of the load. The
  // "sixty seconds" call keys off this: it fires at 1 % remaining.
  const propellantFraction =
    mission.initial.descentPropellantKg > 0
      ? session.flight.descentPropellantKg / mission.initial.descentPropellantKg
      : 0;
  const burnTimeRemainingSec =
    session.flight.descentPropellantKg / (45_040 / 3_050);

  // M4.44 — restored Apollo 11 air-to-ground recordings, cued by story beat.
  const missionAudio = useMissionAudio({
    enabled: audioLive,
    engineOn: engineLit,
    sinceIgnitionSec: session.descentClock.sinceIgnitionUs / 1_000_000,
    activeAlarmId: session.alarms.active?.id ?? null,
    calloutId: session.callout?.id ?? null,
    rollComplete: session.roll.phase === "windows-up",
    altitudeM: session.orbit.altitudeM,
    burnTimeRemainingSec,
    propellantFraction,
    contact: session.orbit.altitudeM <= 1.7 && session.flight.terminalState !== "crashed",
    crashed: session.flight.terminalState === "crashed",
    touchdownOnly: missionId !== "full-descent",
  });

  // The PDI card keys up with Houston's "Go for PDI" call and stays up for the
  // whole countdown, so the crew can arm whenever they are ready.
  const pdiCardReady =
    !audioLive ||
    missionId !== "full-descent" ||
    missionAudio.played.has("go-for-pdi");






  useEffect(() => {
    setMissionDuck(missionAudio.duck);
  }, [missionAudio.duck]);


  const agc = useAgcSession();

  // "The Eagle has landed" — plays once on a successful touchdown.
  const landedAudioRef = useRef<HTMLAudioElement | null>(null);
  const landedPlayedRef = useRef(false);
  const landed = session.flight.terminalState === "landed";
  useEffect(() => {
    if (!landed || landedPlayedRef.current || !musicScore.enabled) return;
    landedPlayedRef.current = true;
    const el = landedAudioRef.current ?? new Audio(eagleLandedAudio.url);
    landedAudioRef.current = el;
    el.volume = 0.85;
    void el.play().catch(() => undefined);
  }, [landed, musicScore.enabled]);
  useEffect(
    () => () => {
      landedAudioRef.current?.pause();
      landedAudioRef.current = null;
    },
    [],
  );




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
          scheme={scheme}
          schemeLocked={schemeLocked}
          onScheme={setScheme}
          onStart={() => {
            session.actions.restart();
            setStarted(true);
          }}
        />
      </section>
    );
  }

  // M4.13 — LM-style annunciator array. Every lamp is driven from game state
  // (a bridged overlay); none of them is read from the Luminary 099 rope.
  const fuelFraction =
    mission.initial.descentPropellantKg > 0
      ? session.flight.descentPropellantKg / mission.initial.descentPropellantKg
      : 0;
  // Blue LUNAR CONTACT lamps: lit by the footpad probes, not by the computer.
  const contact = contactLightState({
    altitudeM: session.orbit.altitudeM,
    terminalState: session.flight.terminalState,
  });
  const cautionLamps = [
    {
      id: "prog",
      legend: "Prog",
      on: session.alarms.lampOn,
      tone: "warning" as const,
      title: "Program alarm — key V05 N09 E to read the code, then RSET.",
    },
    {
      id: "eng-arm",
      legend: "Eng Arm",
      on: session.ignition.engineArmed,
      tone: "status" as const,
      title: "Descent engine armed.",
    },
    {
      id: "radar",
      legend: "LR Alt",
      on: session.radarAvailable,
      tone: "status" as const,
      title: "Landing radar has the surface — windows-up roll complete.",
    },
    {
      id: "roll",
      legend: "Att Roll",
      on: session.roll.phase !== "windows-up",
      tone: "caution" as const,
      title: "Vehicle is not yet windows-up; roll to 0° for radar and visibility.",
    },
    {
      id: "des-qty",
      legend: "Des Qty",
      on: fuelFraction > 0 && fuelFraction < 0.06,
      tone: "caution" as const,
      title: "Descent propellant low-level.",
    },
    {
      id: "velocity",
      legend: "Velocity",
      on: Math.abs(session.orbit.radialSpeedMps) > limits.verticalSpeedMps * 1.5,
      tone: "caution" as const,
      title: "Sink rate above the landing-gear limit.",
    },
    {
      id: "altitude",
      legend: "Altitude",
      on: session.orbit.altitudeM < 60 && Math.abs(session.orbit.tangentialSpeedMps) > limits.horizontalSpeedMps * 2,
      tone: "caution" as const,
      title: "Low and still translating — null the horizontal velocity.",
    },
    {
      id: "contact",
      legend: "Contact",
      on: session.flight.terminalState !== null,
      tone: "status" as const,
      title: "Contact light — shut the engine down.",
    },
  ];


  return (
    <section
      className={
        "cockpit-metal mx-auto max-w-[1400px] space-y-4 px-4 py-4"
      }
      data-testid="play-cockpit"
    >
      <div className="cockpit-strip flex flex-wrap items-center gap-2">
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
        {mission.id === "full-descent" &&
          session.ignition.phase === "standby" &&
          session.flight.terminalState === null && (
          <button
            onClick={() => session.actions.startIgnitionCountdown()}
            data-testid="play-start-pdi"
            className="rounded border border-amber-600 bg-amber-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-900/40"
          >
            Start PDI countdown (T−60)
          </button>
        )}
        <span
          data-testid="play-descent-clock"
          className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300"
        >
          {session.descentClockLabel} · {session.descentClockStatus}
        </span>
        <span
          data-testid="landing-clearance"
          data-clear={session.landingClearance.clear ? "yes" : "no"}
          title={session.landingClearance.reasons.join(" · ") || "No standing deviations."}
          className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
            session.landingClearance.clear
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
              : "border-red-700 bg-red-950/50 text-red-300"
          }`}
        >
          {session.landingClearance.label}
        </span>
        {session.escalation.stage !== "clear" && session.flight.terminalState === null && (
          <span
            data-testid="abort-countdown"
            data-stage={session.escalation.stage}
            className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
              session.escalation.stage === "abort"
                ? "border-red-500 bg-red-900/70 text-red-100"
                : session.escalation.stage === "final-warning"
                  ? "border-red-700 bg-red-950/60 text-red-200"
                  : "border-amber-700 bg-amber-950/50 text-amber-200"
            }`}
          >
            {session.escalation.stage === "abort"
              ? "Houston: abort recommended"
              : `Correct within ${Math.ceil(session.secondsToAbort)} s`}
          </span>
        )}
        <button
          onClick={musicScore.toggle}
          data-testid="play-score-toggle"
          data-enabled={musicScore.enabled ? "yes" : "no"}
          title="Procedural descent score — tension follows the flight"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
        >
          {musicScore.enabled
            ? `♪ Score ${Math.round(musicScore.tension * 100)}%`
            : "♪ Score off"}
        </button>
        <button
          onClick={() => session.actions.abortStage()}
          disabled={session.aborted || session.flight.terminalState !== null}
          data-testid="play-abort"
          className="rounded border-2 border-red-600 bg-red-950/60 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-red-200 hover:bg-red-900/70 disabled:opacity-40"
        >
          {session.aborted ? "Aborted" : "Abort stage"}
        </button>
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

      <div
        className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]"
      >
        <div className="relative space-y-3">
          {session.scriptTerminated && session.flight.terminalState === null && (
            <div
              data-testid="script-terminated"
              className="rounded border-2 border-red-700 bg-red-950/60 px-3 py-2 text-xs leading-snug text-red-100"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-red-300">
                Flown timeline abandoned ·{" "}
              </span>
              This flight left the profile far enough that Houston called an
              abort. The rest of the Apollo 11 transcript and the remaining
              procedure steps are not played — they never happened on this
              flight. Fly the abort, or restart the descent.
            </div>
          )}
          {!session.scriptTerminated && (
            <ProcedureCoach
              script={session.script}
              state={session.procedure}
              step={session.step}
              manual={session.manualUnlocked}
              sinceIgnitionSec={session.descentClock.sinceIgnitionUs / 1_000_000}
              highGateReady={session.highGateStatus === "ready"}
            />
          )}
          <HoustonOverlay
            call={session.houston}
            onAcknowledge={session.actions.acknowledgeHouston}
          />
          <CalloutOverlay
            callout={session.callout}
            onAcknowledge={session.actions.acknowledgeCallout}
          />
          <V99CueOverlay
            flashing={session.ignition.requestFlashing}
            engineArmed={session.ignition.engineArmed}
            proAccepted={session.ignition.proAccepted}
          />


          {(() => {
            // Pitch-over is withheld until the crew takes the approach
            // program on the DSKY (V06 N64), unless this script has no P64
            // step or the player is already flying P66.
            const p64Selected =
              !session.script.steps.some((s) => s.id === "p64-monitor") ||
              session.procedure.completedStepIds.includes("p64-monitor") ||
              session.manualUnlocked;
            // The commander's window is available in every scenario and at
            // every phase — it simply shows whatever attitude and altitude
            // the vehicle currently holds.
            const windowAvailable = true;


            return (
              <div className="relative">
                {windowAvailable && (
                  <button
                    type="button"
                    onClick={() => setFirstPerson((v) => !v)}
                    data-testid="view-toggle"
                    className="absolute right-2 top-2 z-10 rounded border border-neutral-700 bg-neutral-900/85 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
                  >
                    {firstPerson ? "Profile view" : "Window view"}
                  </button>
                )}
                {firstPerson && windowAvailable ? (
                  <div className="mx-auto w-full max-w-[720px]">
                    <CockpitStation
                      flight={session.flight}
                      orbit={session.orbit}
                      downrangeM={session.downrangeM}
                      mission={mission}
                      manual={session.manualUnlocked}
                      rollDeg={session.roll.rollDeg}
                      p64Selected={p64Selected}
                      missionElapsedSec={session.flight.missionTimeUs / 1_000_000}
                    />
                  </div>
                ) : (

                  <LunarScene
                    flight={session.flight}
                    orbit={session.orbit}
                    downrangeM={session.downrangeM}
                    mission={mission}
                    limits={limits}
                    manual={session.manualUnlocked}
                    rollDeg={session.roll.rollDeg}
                    sinceIgnitionSec={
                      session.descentClock.sinceIgnitionUs / 1_000_000
                    }
                    p64Selected={p64Selected}
                  />
                )}
              </div>
            );
          })()}

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
          <GamepadLegend
            haptics={hapticsPref}
            onHaptics={(on) => setHapticsPref(on)}
            phase={session.manualUnlocked ? "manual" : "guided"}
          />


        </div>

        <div className="space-y-3">
          <CautionWarningPanel lamps={cautionLamps} />

          <ContactLight on={contact.on} />

          <FdaiBall
            pitchDeg={(-session.flight.attitudeRad * 180) / Math.PI}
            rollDeg={session.roll.rollDeg}
            pitchRateDegPerSec={(-session.flight.angularRateRadPerSec * 180) / Math.PI}

            rollRateDegPerSec={session.roll.phase === "rolling" ? -10 : 0}
            valid={session.flight.terminalState !== "crashed"}
          />

          {session.ignition.phase !== "standby" && pdiCardReady && (
            <IgnitionPanel
              state={session.ignition}
              clock={session.ignitionClock}
              onArm={session.actions.setEngineArm}
            />
          )}

          {/* Scenarios that begin below the braking phase are already
              windows-up (completed at T+0): no roll cue, no roll card.
              M4.49 — the card keys up with the yaw-around cue itself, not a
              minute early, and stays only until the roll has been flown. */}
          {session.roll.completedSinceIgnitionUs !== 0 &&
            session.descentClock.mode === "running" &&
            session.descentClock.sinceIgnitionUs >=
              milestoneSec("yaw-around") * 1_000_000 &&
            session.roll.phase !== "windows-up" && (
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
                onKeyInjector={session.actions.registerKeyInjector}
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
