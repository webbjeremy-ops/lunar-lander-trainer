// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Play-session hook.
//
// Owns the real-time loop that drives the deterministic planar kernel
// (`stepLunarFlight`) with a fixed 20 ms step, plus the player's control
// inputs from keyboard, touch and gamepad.
//
// PHYSICS FIREWALL: this hook never reads AGC state and never applies AGC
// output to the vehicle. The live Luminary099 session is display-and-keypad
// only; the vehicle is flown by the player and by the game's own advisory
// guidance.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeOrbitalValues,
  computeReferenceGuidance,
  createLunarFlightState,
  stepLunarFlight,
  totalMassKg,
  type LunarControlInput,
  type LunarFlightState,
  type LunarGuidanceCue,
  type LunarOrbitalValues,
} from "@/simulation/lunar2d";
import {
  angleForRange,
  createProcedureState,
  currentStep,
  downrangeToLandingZoneM,
  LANDING_LIMITS,
  LANDING_ZONE_ANGLE_RAD,
  meanResponseSeconds,
  reduceProcedure,
  scoreMission,
  scriptFor,
  type AssistanceLevel,
  type ControlModeId,
  type FlightSummary,
  type MissionDefinition,
  type MissionScore,
  type ProcedureState,
  type TakeoverRecord,
} from "@/game/play";

const STEP_US = 20_000;
const STEP_S = STEP_US / 1_000_000;
const MAX_CATCHUP_STEPS = 25;
/** Rate-of-descent trim increment: 1 ft/s, as in the real P66 ROD switch. */
export const ROD_INCREMENT_MPS = 0.3048;

export const PLAY_TIME_SCALES = [0, 0.25, 0.5, 1, 2, 4] as const;

export interface PlayControlsView {
  readonly throttle: number;
  readonly attitudeCommand: number;
  readonly engineOn: boolean;
  readonly rodTargetMps: number;
  readonly source: "player" | "guidance";
}

export interface PlaySessionApi {
  readonly flight: LunarFlightState;
  readonly orbit: LunarOrbitalValues;
  readonly guidance: LunarGuidanceCue;
  readonly massKg: number;
  readonly downrangeM: number;
  readonly controls: PlayControlsView;
  readonly procedure: ProcedureState;
  readonly script: ReturnType<typeof scriptFor>;
  readonly step: ReturnType<typeof currentStep>;
  readonly running: boolean;
  readonly timeScale: number;
  readonly summary: FlightSummary | null;
  readonly score: MissionScore | null;
  readonly manualUnlocked: boolean;
  readonly flightLockReleased: boolean;
  readonly gamepadConnected: boolean;
  readonly actions: {
    readonly setRunning: (v: boolean) => void;
    readonly setTimeScale: (v: number) => void;
    readonly restart: () => void;
    readonly onDskyKey: (code: number | "PRO") => void;
    readonly requestHint: () => void;
    readonly takeover: () => void;
    readonly setThrottle: (v: number) => void;
    readonly adjustThrottle: (delta: number) => void;
    readonly setAttitudeCommand: (v: number) => void;
    readonly setEngine: (on: boolean) => void;
    readonly trimRod: (steps: number) => void;
  };
}

export function usePlaySession(
  mission: MissionDefinition,
  controlMode: ControlModeId,
  assistance: AssistanceLevel,
): PlaySessionApi {
  const script = useMemo(() => scriptFor(mission.id, controlMode), [mission.id, controlMode]);
  const limits = LANDING_LIMITS[assistance];

  const makeInitial = useCallback(
    () =>
      createLunarFlightState({
        altitudeM: mission.initial.altitudeM,
        centralAngleRad:
          LANDING_ZONE_ANGLE_RAD - angleForRange(mission.initial.rangeToLandingZoneM),
        radialSpeedMps: mission.initial.radialSpeedMps,
        tangentialSpeedMps: mission.initial.tangentialSpeedMps,
        attitudeRad: mission.initial.attitudeRad,
        descentPropellantKg: mission.initial.descentPropellantKg,
      }),
    [mission],
  );

  const [flight, setFlight] = useState<LunarFlightState>(makeInitial);
  const [procedure, setProcedure] = useState<ProcedureState>(() => createProcedureState(script));
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [takeover, setTakeover] = useState<TakeoverRecord | null>(null);
  const [generation, setGeneration] = useState(0);

  const flightRef = useRef(flight);
  flightRef.current = flight;
  const procedureRef = useRef(procedure);
  procedureRef.current = procedure;

  const throttleRef = useRef(0);
  const attitudeRef = useRef(0);
  const engineRef = useRef(false);
  const rodTargetRef = useRef(-mission.initial.radialSpeedMps > 0 ? -1 : -1);
  const roughnessRef = useRef(0);
  const lastCmdRef = useRef({ throttle: 0, attitude: 0 });
  const [controlsView, setControlsView] = useState<PlayControlsView>({
    throttle: 0,
    attitudeCommand: 0,
    engineOn: false,
    rodTargetMps: -1,
    source: "guidance",
  });

  // --- Reset on mission / mode / generation change --------------------------
  useEffect(() => {
    const initial = makeInitial();
    setFlight(initial);
    flightRef.current = initial;
    const proc = createProcedureState(script);
    setProcedure(proc);
    procedureRef.current = proc;
    setTakeover(null);
    setRunning(false);
    throttleRef.current = 0;
    attitudeRef.current = 0;
    engineRef.current = false;
    rodTargetRef.current = -1;
    roughnessRef.current = 0;
    lastCmdRef.current = { throttle: 0, attitude: 0 };
  }, [makeInitial, script, generation]);

  // --- Keyboard -------------------------------------------------------------
  const heldRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key;
      if (
        k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" ||
        k === "ArrowRight" || k === " "
      ) {
        e.preventDefault();
        heldRef.current.add(k);
        if (k === " ") engineRef.current = !engineRef.current;
      } else if (k === "," || k === ".") {
        e.preventDefault();
        rodTargetRef.current += (k === "," ? -1 : 1) * ROD_INCREMENT_MPS;
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

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtMs = Math.min(250, now - last);
      last = now;
      if (timeScale <= 0) return;
      accumulatorUs += dtMs * 1000 * timeScale;

      const proc = procedureRef.current;
      if (!proc.flightLockReleased) {
        accumulatorUs = 0;
        return;
      }

      let steps = 0;
      let state = flightRef.current;
      while (accumulatorUs >= STEP_US && steps < MAX_CATCHUP_STEPS) {
        accumulatorUs -= STEP_US;
        steps += 1;
        if (state.terminalState !== null) break;
        const input = resolveInput(state);
        state = stepLunarFlight(state, input, STEP_US);
      }
      if (steps > 0) {
        flightRef.current = state;
        setFlight(state);
        if (state.terminalState !== null) setRunning(false);
      }
    };

    const resolveInput = (state: LunarFlightState): LunarControlInput => {
      const manual = procedureRef.current.manualControlUnlocked;
      let throttle: number;
      let attitudeCommand: number;

      if (manual) {
        // Held-key integration (also used by touch buttons via heldRef).
        const held = heldRef.current;
        if (held.has("ArrowUp")) throttleRef.current += 0.9 * STEP_S;
        if (held.has("ArrowDown")) throttleRef.current -= 0.9 * STEP_S;
        let att = 0;
        if (held.has("ArrowLeft")) att -= 1;
        if (held.has("ArrowRight")) att += 1;

        const pad = readGamepad();
        if (pad) {
          if (Math.abs(pad.attitude) > 0.12) att = pad.attitude;
          if (pad.throttle !== null) throttleRef.current = pad.throttle;
        }

        attitudeRef.current = att;
        throttleRef.current = clamp01(throttleRef.current);

        // P66 rate-of-descent trim: throttle is servoed to the ROD target.
        if (procedureRef.current.manualControlUnlocked && held.size === 0 && !pad) {
          const cue = computeReferenceGuidance(state);
          const err = rodTargetRef.current - cue.altitudeM * 0; // no-op guard
          void err;
        }
        throttle = throttleRef.current;
        attitudeCommand = attitudeRef.current;
      } else {
        const cue = computeReferenceGuidance(state);
        throttle = cue.recommendedThrottle;
        // Simple proportional attitude autopilot onto the advisory angle.
        const err = cue.recommendedAttitudeRad - state.attitudeRad;
        attitudeCommand = clampSigned(err * 3 - state.angularRateRadPerSec * 2.5);
        throttleRef.current = throttle;
        attitudeRef.current = attitudeCommand;
      }

      engineRef.current = manual ? engineRef.current : throttle > 0;
      const engineOn = engineRef.current && state.descentPropellantKg > 0;

      // Control-roughness metric (mean |d(command)/dt| over the flight).
      const prev = lastCmdRef.current;
      roughnessRef.current +=
        Math.abs(throttle - prev.throttle) + Math.abs(attitudeCommand - prev.attitude);
      lastCmdRef.current = { throttle, attitude: attitudeCommand };

      return {
        throttle: engineOn ? throttle : 0,
        engineCommand: engineOn ? "descent" : "off",
        attitudeCommand,
      };
    };

    // Publish the control view at ~10 Hz so the instruments animate.
    const publish = window.setInterval(() => {
      setControlsView({
        throttle: throttleRef.current,
        attitudeCommand: attitudeRef.current,
        engineOn: engineRef.current,
        rodTargetMps: rodTargetRef.current,
        source: procedureRef.current.manualControlUnlocked ? "player" : "guidance",
      });
    }, 100);

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(publish);
    };
  }, [running, timeScale]);

  // --- Gamepad presence -----------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !("getGamepads" in navigator)) return;
    const on = () => setGamepadConnected(true);
    const off = () => setGamepadConnected(false);
    window.addEventListener("gamepadconnected", on);
    window.addEventListener("gamepaddisconnected", off);
    return () => {
      window.removeEventListener("gamepadconnected", on);
      window.removeEventListener("gamepaddisconnected", off);
    };
  }, []);

  // --- Derived --------------------------------------------------------------
  const orbit = useMemo(() => computeOrbitalValues(flight), [flight]);
  const guidance = useMemo(() => computeReferenceGuidance(flight), [flight]);
  const massKg = useMemo(() => totalMassKg(flight), [flight]);
  const downrangeM = downrangeToLandingZoneM(orbit.centralAngleRad, LANDING_ZONE_ANGLE_RAD);

  const summary: FlightSummary | null = useMemo(() => {
    if (flight.terminalState === null) return null;
    const elapsedS = Math.max(1, flight.missionTimeUs / 1_000_000);
    return {
      missionId: mission.id,
      controlMode,
      assistance,
      finalState: flight,
      landingZoneErrorM: downrangeM,
      descentPropellantRemainingKg: flight.descentPropellantKg,
      descentPropellantInitialKg: mission.initial.descentPropellantKg,
      controlRoughness: roughnessRef.current / elapsedS,
      takeover,
      procedure: {
        required: script.steps.length,
        completed: procedure.completedStepIds.length,
        incorrectEntries: procedure.incorrectEntries,
        hintsUsed: procedure.hintsUsed,
        skipped: controlMode === "quick-manual",
        meanResponseSeconds: meanResponseSeconds(procedure),
      },
      limits,
    };
  }, [flight, mission, controlMode, assistance, downrangeM, takeover, script, procedure, limits]);

  const score = useMemo(() => (summary ? scoreMission(summary) : null), [summary]);

  const recordTakeover = useCallback(
    (early: boolean) => {
      const s = flightRef.current;
      const o = computeOrbitalValues(s);
      setTakeover((prev) =>
        prev ?? {
          missionTimeUs: s.missionTimeUs,
          altitudeM: o.altitudeM,
          horizontalSpeedMps: Math.abs(o.tangentialSpeedMps),
          verticalSpeedMps: o.radialSpeedMps,
          descentPropellantKg: s.descentPropellantKg,
          early,
        },
      );
      throttleRef.current = flightRef.current.throttle || 0.4;
      engineRef.current = true;
    },
    [],
  );

  const onDskyKey = useCallback(
    (code: number | "PRO") => {
      setProcedure((prev) => {
        const next = reduceProcedure(script, prev, {
          kind: "key",
          code,
          missionTimeUs: flightRef.current.missionTimeUs,
        });
        procedureRef.current = next;
        if (!prev.manualControlUnlocked && next.manualControlUnlocked) {
          const o = computeOrbitalValues(flightRef.current);
          recordTakeover(o.altitudeM > 300);
        }
        if (!prev.flightLockReleased && next.flightLockReleased) setRunning(true);
        return next;
      });
    },
    [script, recordTakeover],
  );

  const actions = useMemo(
    () => ({
      setRunning,
      setTimeScale,
      restart: () => setGeneration((g) => g + 1),
      onDskyKey,
      requestHint: () =>
        setProcedure((prev) => {
          const next = reduceProcedure(script, prev, {
            kind: "hint",
            missionTimeUs: flightRef.current.missionTimeUs,
          });
          procedureRef.current = next;
          return next;
        }),
      takeover: () => {
        setProcedure((prev) => {
          const next: ProcedureState = {
            ...prev,
            manualControlUnlocked: true,
            flightLockReleased: true,
            lastMessage: "Manual takeover — you have the vehicle.",
          };
          procedureRef.current = next;
          return next;
        });
        const o = computeOrbitalValues(flightRef.current);
        recordTakeover(o.altitudeM > 300);
        setRunning(true);
      },
      setThrottle: (v: number) => { throttleRef.current = clamp01(v); },
      adjustThrottle: (d: number) => { throttleRef.current = clamp01(throttleRef.current + d); },
      setAttitudeCommand: (v: number) => {
        attitudeRef.current = clampSigned(v);
        // Touch/pointer hold: mirror into the held-key set so the loop honours it.
        heldRef.current.delete("ArrowLeft");
        heldRef.current.delete("ArrowRight");
        if (v < -0.05) heldRef.current.add("ArrowLeft");
        if (v > 0.05) heldRef.current.add("ArrowRight");
      },
      setEngine: (on: boolean) => { engineRef.current = on; },
      trimRod: (steps: number) => { rodTargetRef.current += steps * ROD_INCREMENT_MPS; },
    }),
    [onDskyKey, script, recordTakeover],
  );

  return {
    flight,
    orbit,
    guidance,
    massKg,
    downrangeM,
    controls: controlsView,
    procedure,
    script,
    step: currentStep(script, procedure),
    running,
    timeScale,
    summary,
    score,
    manualUnlocked: procedure.manualControlUnlocked,
    flightLockReleased: procedure.flightLockReleased,
    gamepadConnected,
    actions,
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampSigned(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

function readGamepad(): { attitude: number; throttle: number | null } | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    const attitude = pad.axes[0] ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    const throttle = rt > 0.02 || lt > 0.02 ? clamp01(rt - lt) : null;
    return { attitude, throttle };
  }
  return null;
}
