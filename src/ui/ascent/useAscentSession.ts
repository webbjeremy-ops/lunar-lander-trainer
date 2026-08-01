// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Ascent-session hook.
//
// Owns the real-time loop that drives the deterministic planar kernel
// (`stepLunarFlight`) with a fixed 20 ms step for the lunar-liftoff game.
//
// PHYSICS FIREWALL: this hook never reads AGC state and never applies AGC
// output to the vehicle. The live Luminary099 session beside the cockpit is
// display-and-keypad only.
//
// INSTRUCTOR CUES ARE NEVER APPLIED. `computeAscentGuidance` is called purely
// to draw the overlay. The single exception is the demonstration autopilot,
// which the player switches on explicitly and which is recorded in the
// debrief as `demonstrationUsed`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeOrbitalValues,
  stepLunarFlight,
  totalMassKg,
  type LunarControlInput,
  type LunarFlightState,
  type LunarOrbitalValues,
} from "@/simulation/lunar2d";
import {
  ascentOrbit,
  attitudeCommandFor,
  computeAscentGuidance,
  createAscentInitialState,
  evaluateAscentOutcome,
  parametersForAscentMission,
  remainingAscentDeltaVMps,
  sampleCoastArc,
  scoreAscent,
  targetForMission,
  targetOrbitError,
  timeToApoapsisSeconds,
  type AscentGuidanceCue,
  type AscentMissionDefinition,
  type AscentOutcome,
  type AscentScore,
  type AscentSummary,
  type AssistanceLevel,
  type ConicSample,
  type TargetOrbit,
  type TargetOrbitError,
} from "@/game/ascent";

const STEP_US = 20_000;
const MAX_CATCHUP_STEPS = 40;

export const ASCENT_TIME_SCALES = [0, 1, 2, 4, 8, 16, 32] as const;

export interface AscentControlsView {
  readonly pitchCommand: number;
  readonly engineOn: boolean;
  readonly source: "player" | "demonstration";
}

export interface AscentSessionApi {
  readonly flight: LunarFlightState;
  readonly orbit: LunarOrbitalValues;
  readonly guidance: AscentGuidanceCue;
  readonly target: TargetOrbit;
  readonly targetError: TargetOrbitError;
  readonly massKg: number;
  readonly deltaVRemainingMps: number;
  readonly timeToApoapsisS: number | null;
  readonly coastArc: readonly ConicSample[];
  readonly controls: AscentControlsView;
  readonly outcome: AscentOutcome;
  readonly lifted: boolean;
  readonly staged: boolean;
  readonly cutoff: boolean;
  readonly complete: boolean;
  readonly running: boolean;
  readonly timeScale: number;
  readonly demonstration: boolean;
  readonly burnElapsedS: number;
  readonly summary: AscentSummary | null;
  readonly score: AscentScore | null;
  readonly actions: {
    readonly setRunning: (v: boolean) => void;
    readonly setTimeScale: (v: number) => void;
    readonly restart: () => void;
    readonly liftoff: () => void;
    readonly commandCutoff: () => void;
    readonly relight: () => void;
    readonly setPitchCommand: (v: number) => void;
    readonly setDemonstration: (v: boolean) => void;
    readonly endFlight: () => void;
  };
}

export function useAscentSession(
  mission: AscentMissionDefinition,
  assistance: AssistanceLevel,
): AscentSessionApi {
  const parameters = useMemo(() => parametersForAscentMission(mission), [mission]);
  const target = useMemo(() => targetForMission(mission), [mission]);

  const makeInitial = useCallback(
    () => createAscentInitialState(mission, parameters),
    [mission, parameters],
  );

  const [flight, setFlight] = useState<LunarFlightState>(makeInitial);
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [generation, setGeneration] = useState(0);
  const [lifted, setLifted] = useState(mission.sandbox);
  const [cutoff, setCutoff] = useState(mission.sandbox);
  const [demonstration, setDemonstration] = useState(false);
  const [ended, setEnded] = useState(false);
  const [controlsView, setControlsView] = useState<AscentControlsView>({
    pitchCommand: 0,
    engineOn: false,
    source: "player",
  });

  const flightRef = useRef(flight);
  flightRef.current = flight;
  const liftedRef = useRef(lifted);
  liftedRef.current = lifted;
  const cutoffRef = useRef(cutoff);
  cutoffRef.current = cutoff;
  const demoRef = useRef(demonstration);
  demoRef.current = demonstration;

  const stagedRef = useRef(mission.sandbox);
  const pitchRef = useRef(0);
  const roughnessRef = useRef(0);
  const lastCmdRef = useRef(0);
  const liftoffUsRef = useRef<number | null>(mission.sandbox ? 0 : null);
  const stagingUsRef = useRef<number | null>(null);
  const cutoffRecordRef = useRef<{
    missionTimeUs: number;
    altitudeM: number;
    radialSpeedMps: number;
  } | null>(null);
  const demoUsedRef = useRef(false);

  // --- Reset ----------------------------------------------------------------
  useEffect(() => {
    const initial = makeInitial();
    setFlight(initial);
    flightRef.current = initial;
    setRunning(false);
    setLifted(mission.sandbox);
    liftedRef.current = mission.sandbox;
    setCutoff(mission.sandbox);
    cutoffRef.current = mission.sandbox;
    setEnded(false);
    setDemonstration(false);
    demoRef.current = false;
    demoUsedRef.current = false;
    stagedRef.current = mission.sandbox;
    pitchRef.current = 0;
    roughnessRef.current = 0;
    lastCmdRef.current = 0;
    liftoffUsRef.current = mission.sandbox ? 0 : null;
    stagingUsRef.current = null;
    cutoffRecordRef.current = null;
  }, [makeInitial, mission.sandbox, generation]);

  // --- Keyboard -------------------------------------------------------------
  const heldRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "Shift") {
        e.preventDefault();
        heldRef.current.add(k);
      }
    };
    const up = (e: KeyboardEvent) => heldRef.current.delete(e.key);
    const blur = () => heldRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // --- Real-time loop -------------------------------------------------------
  useEffect(() => {
    if (!running) return;
    if (typeof window === "undefined") return;
    let raf = 0;
    let last = performance.now();
    let accumulatorUs = 0;

    const resolveInput = (state: LunarFlightState): LunarControlInput => {
      const burning = liftedRef.current && !cutoffRef.current;

      let pitchCommand: number;
      if (demoRef.current && burning) {
        demoUsedRef.current = true;
        const cue = computeAscentGuidance(
          state,
          mission,
          target,
          burnElapsedSecondsOf(state),
          true,
          parameters,
        );
        pitchCommand = attitudeCommandFor(state, cue.recommendedPitchRad);
        if (cue.recommendCutoff) {
          cutoffRef.current = true;
          setCutoff(true);
          recordCutoff(state);
        }
      } else {
        const held = heldRef.current;
        const fine = held.has("Shift") ? 0.25 : 1;
        let cmd = 0;
        if (held.has("ArrowLeft")) cmd -= fine;
        if (held.has("ArrowRight")) cmd += fine;
        if (cmd === 0) cmd = pitchRef.current;
        pitchCommand = clampSigned(cmd);
      }
      pitchRef.current = pitchCommand;

      roughnessRef.current += Math.abs(pitchCommand - lastCmdRef.current);
      lastCmdRef.current = pitchCommand;

      const engineOn = liftedRef.current && !cutoffRef.current;
      const input: LunarControlInput = {
        throttle: engineOn ? 1 : 0,
        engineCommand: engineOn ? "ascent" : "off",
        attitudeCommand: pitchCommand,
        stageSeparation: !stagedRef.current,
      };
      if (!stagedRef.current) {
        stagedRef.current = true;
        stagingUsRef.current = state.missionTimeUs;
      }
      return input;
    };

    const burnElapsedSecondsOf = (state: LunarFlightState) =>
      liftoffUsRef.current === null
        ? 0
        : (state.missionTimeUs - liftoffUsRef.current) / 1_000_000;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtMs = Math.min(250, now - last);
      last = now;
      if (timeScale <= 0) return;
      if (!liftedRef.current) {
        accumulatorUs = 0;
        return;
      }
      accumulatorUs += dtMs * 1000 * timeScale;

      let steps = 0;
      let state = flightRef.current;
      while (accumulatorUs >= STEP_US && steps < MAX_CATCHUP_STEPS) {
        accumulatorUs -= STEP_US;
        steps += 1;
        if (state.terminalState !== null) break;
        state = stepLunarFlight(state, resolveInput(state), STEP_US, parameters);
        // Propellant exhaustion ends the burn.
        if (state.ascentPropellantKg <= 0 && !cutoffRef.current) {
          cutoffRef.current = true;
          setCutoff(true);
          recordCutoff(state);
        }
      }
      if (steps > 0) {
        flightRef.current = state;
        setFlight(state);
        if (state.terminalState !== null) setRunning(false);
      }
    };

    const publish = window.setInterval(() => {
      setControlsView({
        pitchCommand: pitchRef.current,
        engineOn: liftedRef.current && !cutoffRef.current,
        source: demoRef.current ? "demonstration" : "player",
      });
    }, 100);

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(publish);
    };
  }, [running, timeScale, mission, target, parameters]);

  // --- Tab recovery ---------------------------------------------------------
  // Hidden tabs throttle requestAnimationFrame; pause rather than fast-forward
  // the ascent while the player is not looking at it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setRunning(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);



  const recordCutoff = useCallback(
    (state: LunarFlightState) => {
      if (cutoffRecordRef.current) return;
      const o = computeOrbitalValues(state, parameters);
      cutoffRecordRef.current = {
        missionTimeUs: state.missionTimeUs,
        altitudeM: o.altitudeM,
        radialSpeedMps: o.radialSpeedMps,
      };
    },
    [parameters],
  );

  // --- Derived --------------------------------------------------------------
  const orbit = useMemo(() => ascentOrbit(flight, mission), [flight, mission]);
  const burnElapsedS =
    liftoffUsRef.current === null
      ? 0
      : (flight.missionTimeUs - liftoffUsRef.current) / 1_000_000;
  const guidance = useMemo(
    () =>
      computeAscentGuidance(flight, mission, target, burnElapsedS, lifted, parameters),
    [flight, mission, target, burnElapsedS, lifted, parameters],
  );
  const powered = flight.mainEngine === "ascent";
  const outcome = useMemo(
    () => evaluateAscentOutcome(flight, mission, powered, parameters),
    [flight, mission, powered, parameters],
  );
  const massKg = useMemo(() => totalMassKg(flight), [flight]);
  const deltaVRemainingMps = useMemo(
    () => remainingAscentDeltaVMps(flight, parameters),
    [flight, parameters],
  );
  const targetError = useMemo(() => targetOrbitError(orbit, target), [orbit, target]);
  const coastArc = useMemo(
    () => (lifted ? sampleCoastArc(orbit, 180, parameters) : []),
    [lifted, orbit, parameters],
  );
  const timeToApo = useMemo(
    () => timeToApoapsisSeconds(orbit, parameters),
    [orbit, parameters],
  );

  const complete = flight.terminalState !== null || ended;

  const summary: AscentSummary | null = useMemo(() => {
    if (!complete) return null;
    const elapsedS = Math.max(1, flight.missionTimeUs / 1_000_000);
    const cut = cutoffRecordRef.current;
    return {
      missionId: mission.id,
      assistance,
      outcome:
        flight.terminalState === "orbit-achieved"
          ? "orbit-achieved"
          : evaluateAscentOutcome(flight, mission, false, parameters),
      finalState: flight,
      target,
      periapsisAltitudeM: orbit.periapsisAltitudeM,
      apoapsisAltitudeM: orbit.apoapsisAltitudeM,
      cutoffMissionTimeUs: cut?.missionTimeUs ?? null,
      cutoffAltitudeM: cut?.altitudeM ?? null,
      cutoffRadialSpeedMps: cut?.radialSpeedMps ?? null,
      staged: stagedRef.current,
      stagingMissionTimeUs: stagingUsRef.current,
      ascentPropellantRemainingKg: flight.ascentPropellantKg,
      ascentPropellantInitialKg: mission.ascentPropellantKg,
      rcsPropellantRemainingKg: flight.rcsPropellantKg,
      deltaVRemainingMps,
      controlRoughness: roughnessRef.current / elapsedS,
      demonstrationUsed: demoUsedRef.current,
    };
  }, [
    complete,
    flight,
    mission,
    assistance,
    target,
    orbit,
    deltaVRemainingMps,
    parameters,
  ]);

  const score = useMemo(() => (summary ? scoreAscent(summary) : null), [summary]);

  const actions = useMemo(
    () => ({
      setRunning,
      setTimeScale,
      restart: () => setGeneration((g) => g + 1),
      liftoff: () => {
        if (liftedRef.current) return;
        liftedRef.current = true;
        liftoffUsRef.current = flightRef.current.missionTimeUs;
        setLifted(true);
        setRunning(true);
      },
      commandCutoff: () => {
        if (cutoffRef.current) return;
        cutoffRef.current = true;
        setCutoff(true);
        recordCutoff(flightRef.current);
      },
      relight: () => {
        // Sandbox only: the phasing exercise needs a second burn.
        if (!mission.sandbox) return;
        cutoffRef.current = false;
        setCutoff(false);
        setRunning(true);
      },
      setPitchCommand: (v: number) => {
        pitchRef.current = clampSigned(v);
        heldRef.current.delete("ArrowLeft");
        heldRef.current.delete("ArrowRight");
        if (v < -0.05) heldRef.current.add("ArrowLeft");
        if (v > 0.05) heldRef.current.add("ArrowRight");
      },
      setDemonstration: (v: boolean) => {
        demoRef.current = v;
        if (v) demoUsedRef.current = true;
        setDemonstration(v);
      },
      endFlight: () => {
        setRunning(false);
        setEnded(true);
      },
    }),
    [mission.sandbox, recordCutoff],
  );

  return {
    flight,
    orbit,
    guidance,
    target,
    targetError,
    massKg,
    deltaVRemainingMps,
    timeToApoapsisS: timeToApo,
    coastArc,
    controls: controlsView,
    outcome,
    lifted,
    staged: flight.configuration === "ascent-stage",
    cutoff,
    complete,
    running,
    timeScale,
    demonstration,
    burnElapsedS,
    summary,
    score,
    actions,
  };
}

function clampSigned(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
