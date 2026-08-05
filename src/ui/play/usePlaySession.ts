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
  insertionStateForMission,
  PRE_IGNITION_COAST_SEC,

  bridgedAlarmFor,
  activeCallout,
  activeHoustonCall,
  isOffScript,
  houstonDeviations,
  createHoustonEscalationState,
  reduceHoustonEscalation,
  escalatedCall,
  secondsToAbort,
  type HoustonEscalationState,
  landingClearance,
  HOUSTON_ABORT_CALL,
  type HoustonCall,
  type LandingClearance,
  type FlightDeviationInput,
  bridgedRequestFor,
  createDescentClockState,
  createDescentRollState,
  startsWindowsUp,

  descentClockStatusLabel,
  formatDescentClock,
  stepDescentClock,
  type DescentClockState,
  createIgnitionState,
  createProcedureState,
  createProgramAlarmState,
  currentStep,
  descentMonitorFor,
  downrangeToLandingZoneM,
  formatTig,
  LANDING_LIMITS,
  LANDING_ZONE_ANGLE_RAD,
  meanResponseSeconds,
  radarAvailable,
  reduceDescentRoll,
  reduceIgnition,
  reduceProcedure,
  reduceProgramAlarms,
  scoreMission,
  scriptFor,
  summarizeAlarms,
  dpsThrottleEnvelope,
  isBurning,
  nominalAltitudeForRangeM,
  nominalDownrangeSpeedForRange,
  HIGH_GATE_RANGE_M,
  HIGH_GATE_AIM,
  LOW_GATE_AIM,
  nominalGlideSlopeForRange,
  highGateStatus,
  type HighGateStatus,
  usesApollo11Timeline,
  type AssistanceLevel,
  type BridgedAlarmOverlay,
  type DescentCallout,
  type BridgedDskyRequest,
  type ControlModeId,
  type DescentRollState,
  type DescentMonitorView,
  type FlightSummary,
  type IgnitionSequenceState,
  type MissionDefinition,
  type MissionScore,
  type ProcedureState,
  type ProgramAlarmState,
  type TakeoverRecord,
} from "@/game/play";
import { PHASE_HIGH_GATE_M, descentPhaseFor } from "@/game/play/descentPhase";
import { contactLightState } from "@/game/play/contactLight";
import {
  ACCEPTANCE_KEY_INTERVAL_MS,
  resolveProgramAcceptance,
  type InjectableKey,
} from "@/game/play/programAcceptance";

import {
  DESCENT_ENGINE,
  LUNAR_ENVIRONMENT,
} from "@/simulation/lunar2d/LunarMissionConstants";

import {
  createGamepadEdgeState,
  NEUTRAL_INPUT,
  mapXboxInput,
  readLivePad,
  type GamepadEdgeState,
  type XboxCockpitInput,
} from "./xboxGamepad";
import { GamepadHaptics } from "./gamepadHaptics";
import { activeControlScheme } from "./controlScheme";


const MU_M3S2 = LUNAR_ENVIRONMENT.gravitationalParameterM3S2.value;
const MAX_DPS_THRUST_N = DESCENT_ENGINE.maxThrustN.value;
const STEP_US = 20_000;

const STEP_S = STEP_US / 1_000_000;
const MAX_CATCHUP_STEPS = 25;
/** M4.10 — held attitude key commands this body rate (rad/s, ~9 deg/s). */
const COMMANDED_ATTITUDE_RATE = 0.16;
/** Proportional gain converting rate error to attitude authority command. */
const ATTITUDE_RATE_GAIN = 12;
/** Immediate rate kick applied on keydown so the first frame already moves. */
const ATTITUDE_TAP_RATE = 0.02;
/** Rate-of-descent trim increment: 1 ft/s, as in the real P66 ROD switch. */
export const ROD_INCREMENT_MPS = 0.3048;

/**
 * M4.45 — the A button acknowledges whichever affirmative call is on screen
 * ("Got it" on the procedure coach, "Copy that" on a callout or a Houston
 * call). Program alarms are deliberately excluded: those stay on RB.
 * Presentation-level glue — it clicks the same control the mouse would.
 */
function acknowledgeOnScreenCall(): void {
  if (typeof document === "undefined") return;
  for (const id of ["procedure-coach-ack", "callout-ack", "houston-ack"]) {
    const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    if (el && !el.disabled) {
      el.click();
      return;
    }
  }
}




export const PLAY_TIME_SCALES = [0, 0.25, 0.5, 1, 2, 4] as const;

/** Full Descent's configured state is the TIG state, not a pre-TIG state. */
export function shouldAdvanceFlightPhysics(
  _missionId: MissionDefinition["id"],
  _ignitionState: IgnitionSequenceState,
  _aborted: boolean,
): boolean {
  // M4.41 — the vehicle is never frozen. Before TIG it coasts on the descent
  // orbit at ~1,698 m/s with the engine cold (the throttle law below forces
  // zero thrust until ignition), which is what the crew actually flew through
  // the countdown ritual.
  return true;
}


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
  /** M4.7 — PDI ignition ritual (countdown, ENG ARM, V99 request, FTP). */
  readonly ignition: IgnitionSequenceState;
  readonly ignitionClock: string;
  /** M4.13B — descent-sequence clock driving roll cue, callouts and alarms. */
  readonly descentClock: DescentClockState;
  readonly descentClockLabel: string;
  readonly descentClockStatus: string;
  readonly bridgedDskyRequest: BridgedDskyRequest | null;
  /** M4.12 — bridged descent-monitor registers (R1/R2/R3) in Apollo units. */
  readonly descentMonitor: DescentMonitorView;
  /** M4.8 — windows-up roll state and live program alarms. */
  readonly roll: DescentRollState;
  readonly rollActive: boolean;
  readonly radarAvailable: boolean;
  readonly alarms: ProgramAlarmState;
  readonly bridgedAlarm: BridgedAlarmOverlay | null;
  /** M4.13 — the crew callout the cockpit should be showing, if any. */
  readonly callout: DescentCallout | null;
  /** M4.18 — improvised Houston call when the flight goes off-script. */
  readonly houston: HoustonCall | null;
  readonly landingClearance: LandingClearance;
  /** M4.21 — Houston's escalation ladder (correct → last call → abort). */
  readonly escalation: HoustonEscalationState;
  /** Simulated seconds left to correct before Houston directs an abort. */
  readonly secondsToAbort: number;
  /**
   * True once the flight has left the flown profile for good: the remaining
   * Apollo 11 transcript and procedure steps are not played.
   */
  readonly scriptTerminated: boolean;
  readonly aborted: boolean;
  readonly highGateStatus: HighGateStatus;
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
    readonly setEngineArm: (on: boolean) => void;
    /** M4.12 — arm the PDI countdown directly (T-60) from the cockpit. */
    readonly startIgnitionCountdown: () => void;
    /** Hold to roll the vehicle toward windows-up (M4.8). */
    readonly setRollCommand: (active: boolean) => void;
    /** Acknowledge ("copy that") the currently displayed crew callout. */
    readonly acknowledgeCallout: (id: string) => void;
    /** Acknowledge an improvised Houston caution. */
    readonly acknowledgeHouston: (id: string) => void;
    /** M4.18 — ABORT STAGE: jettison the descent stage, fly the ascent engine. */
    readonly abortStage: () => void;
    /** M4.30 — enable/disable controller rumble. */
    readonly setHaptics: (on: boolean) => void;
    /**
     * M4.31 — easy program acceptance (LB): key the pending DSKY step for the
     * crew. The keys go through the real DSKY into the AGC, one at a time.
     */
    readonly acceptProgram: () => void;
    /**
     * Register the DSKY's key injector. The DSKY owns the AGC client, so the
     * assist can only key through it; without a registered injector the
     * procedure state is left untouched.
     */
    readonly registerKeyInjector: (
      send: ((code: number | "PRO") => void) | null,
    ) => void;

  };
  /** M4.30 — whether controller rumble is currently enabled. */
  readonly hapticsEnabled: boolean;
  /** M4.31 — how many steps were keyed by the LB assist rather than by hand. */
  readonly assistedProgramEntries: number;
}

export function usePlaySession(
  mission: MissionDefinition,
  controlMode: ControlModeId,
  assistance: AssistanceLevel,
): PlaySessionApi {
  const script = useMemo(() => scriptFor(mission.id, controlMode), [mission.id, controlMode]);
  const limits = LANDING_LIMITS[assistance];

  /** This scenario is inserted uprange of PDI and coasts in to TIG. */
  const coastsToTig = mission.id === "full-descent";

  const makeInitial = useCallback(
    () =>
      // M4.41 — Full Descent starts UPRANGE of PDI, already moving at descent-
      // orbit speed, and coasts in during the countdown so the crew works the
      // DSKY and ENG ARM on a live vehicle and crosses PDI exactly at TIG.
      insertionStateForMission(
        mission,
        mission.id === "full-descent" ? PRE_IGNITION_COAST_SEC : 0,
      ),
    [mission],
  );


  const [flight, setFlight] = useState<LunarFlightState>(makeInitial);
  const [procedure, setProcedure] = useState<ProcedureState>(() => createProcedureState(script));
  // M4.41 — the clock is live from the moment the mission opens: Eagle is
  // already coasting on the descent orbit before the crew arms the countdown.
  const [running, setRunning] = useState(true);
  const [timeScale, setTimeScale] = useState(1);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [takeover, setTakeover] = useState<TakeoverRecord | null>(null);
  const [generation, setGeneration] = useState(0);
  const [ignition, setIgnition] = useState<IgnitionSequenceState>(createIgnitionState);
  // M4.8 — cockpit roll orientation and program alarms. Both are pure
  // reducers driven from the same 20 ms loop; neither touches the physics
  // kernel or the AGC.
  // Scenarios that begin below the braking phase start AFTER the windows-up
  // roll: the maneuver was flown at ~13 km, so there is no cue to give.
  const windowsUpAtStart = startsWindowsUp(mission.initial.altitudeM);
  const [roll, setRoll] = useState<DescentRollState>(() =>
    createDescentRollState({ windowsUp: windowsUpAtStart }),
  );
  const [alarms, setAlarms] = useState<ProgramAlarmState>(createProgramAlarmState);
  const [acknowledgedCallouts, setAcknowledgedCallouts] = useState<readonly string[]>([]);
  const [acknowledgedHouston, setAcknowledgedHouston] = useState<readonly string[]>([]);
  /** M4.18 — ABORT STAGE latched by the crew. */
  const [aborted, setAborted] = useState(false);
  const abortedRef = useRef(false);
  /**
   * M4.21 — Houston's escalation ladder. Deviations are watched, a correction
   * is called, and only if it does not take within the correction window does
   * Houston direct an abort — at which point the remaining transcript and the
   * remaining procedure steps are abandoned.
   */
  const escalationRef = useRef<HoustonEscalationState>(createHoustonEscalationState());
  const [escalation, setEscalation] = useState<HoustonEscalationState>(
    createHoustonEscalationState,
  );

  /**
   * M4.13B — Ignition-relative descent clock, owned by a pure state machine
   * (`stepDescentClock`). Normally the PDI sequence drives it; otherwise it
   * free-runs from the first descent step so the roll cue, the crew callouts
   * and the 1201/1202 alarms are never silently skipped.
   */
  const descentClockRef = useRef<DescentClockState>(createDescentClockState());
  const [descentClock, setDescentClock] = useState<DescentClockState>(
    createDescentClockState,
  );
  const descentClockUs = descentClock.sinceIgnitionUs;
  // The Apollo 11 mission always flies the historical roll / alarm / callout
  // timeline, whatever control mode the player picked — the alarms are part of
  // the flight, not part of the DSKY procedure script.
  const apollo11Timeline =
    mission.id === "full-descent" || usesApollo11Timeline(script);

  const flightRef = useRef(flight);
  flightRef.current = flight;
  const procedureRef = useRef(procedure);
  procedureRef.current = procedure;
  const ignitionRef = useRef(ignition);
  ignitionRef.current = ignition;
  const rollRef = useRef(roll);
  rollRef.current = roll;
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;

  // M4.27 — P63 is a computer-flown program. Even in quick-manual the crew
  // does not hand-fly the braking burn: guidance keeps the vehicle on the
  // range/altitude/speed profile (including the throttle trim after throttle
  // recovery) until the approach phase, when the crew takes the vehicle.
  const crewHasVehicleRef = useRef(false);

  const dispatchIgnition = useCallback(
    (event: Parameters<typeof reduceIgnition>[1]) => {
      const next = reduceIgnition(ignitionRef.current, event);
      if (next === ignitionRef.current) return next;
      ignitionRef.current = next;
      setIgnition(next);
      return next;
    },
    [],
  );

  const dispatchRoll = useCallback(
    (event: Parameters<typeof reduceDescentRoll>[1]) => {
      const next = reduceDescentRoll(rollRef.current, event);
      if (next === rollRef.current) return next;
      rollRef.current = next;
      setRoll(next);
      return next;
    },
    [],
  );

  const dispatchAlarm = useCallback(
    (event: Parameters<typeof reduceProgramAlarms>[1]) => {
      const next = reduceProgramAlarms(alarmsRef.current, event);
      if (next === alarmsRef.current) return next;
      alarmsRef.current = next;
      setAlarms(next);
      return next;
    },
    [],
  );


  const throttleRef = useRef(0);
  /**
   * Touch/pointer throttle commands arrive as discrete steps, not held keys.
   * Without this latch the ROD servo below immediately overwrote the value on
   * the very next frame, so on mobile the thrust buttons did nothing.
   */
  const manualThrottleHoldUntilMsRef = useRef(0);
  /**
   * M4.49 — RB fires a short throttle burst once the crew has the vehicle:
   * a brief kick of thrust, the way a commander taps the DPS to arrest sink.
   */
  const throttleBurstUntilMsRef = useRef(0);
  /** Latched once the vehicle drops below low gate: terminal (P66) guidance. */
  const terminalGuidanceRef = useRef(false);
  const attitudeRef = useRef(0);
  /** One-shot rate kick consumed by the attitude controller on key press. */
  const attitudeKickRef = useRef(0);
  // M4.30 — Xbox controller: button-edge state and the haptics driver. Both
  // live in refs because the 50 Hz loop reads them without re-rendering.
  const padEdgesRef = useRef<GamepadEdgeState>(createGamepadEdgeState());
  const padInputRef = useRef<XboxCockpitInput>(NEUTRAL_INPUT);
  const acceptProgramRef = useRef<() => void>(() => {});
  // M4.45 — pad shortcuts for cockpit switches that live in React actions.
  const takeoverRef = useRef<() => void>(() => {});
  const setEngineArmRef = useRef<() => void>(() => {});

  const hapticsRef = useRef<GamepadHaptics>(new GamepadHaptics());
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  // M4.31 — easy program acceptance.
  const keyInjectorRef = useRef<((code: number | "PRO") => void) | null>(null);
  // M4.58 — P64 is taken no later than 30 s after Houston's "thirty seconds to
  // P64" call. Once that clock is past, the high-gate gate is satisfied so the
  // automatic entry (and a hand entry) is accepted rather than held.
  const forceHighGateRef = useRef(false);
  const acceptanceTimersRef = useRef<number[]>([]);
  const [assistedProgramEntries, setAssistedProgramEntries] = useState(0);

  // Scenarios that begin mid-flight (Landing Fundamentals, Free Flight) start
  // with the descent engine already lit — there is no PDI ignition ritual to
  // fly, so a cold engine would simply drop the vehicle out of the sky.
  const startsUnderPower = mission.id !== "full-descent";
  const engineRef = useRef(startsUnderPower);

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
    setRunning(true);
    throttleRef.current = 0;
    attitudeRef.current = 0;
    engineRef.current = startsUnderPower;

    rodTargetRef.current = -1;
    roughnessRef.current = 0;
    lastCmdRef.current = { throttle: 0, attitude: 0 };
    // M4.42 — the pre-TIG coast and the PDI countdown are ONE clock. The
    // scenario inserts Eagle exactly COUNTDOWN_LENGTH_US of coast uprange of
    // PDI, so the countdown has to be running from the moment the mission
    // opens; otherwise the vehicle keeps coasting past the PDI point while the
    // crew works the checklist, ignition happens low and downrange, and every
    // geometry-gated cue after it (high gate / P64 pitch-over, low gate,
    // manual handover) never fires.
    const ign = coastsToTig
      ? reduceIgnition(createIgnitionState(), { kind: "start" })
      : createIgnitionState();
    ignitionRef.current = ign;
    setIgnition(ign);
    const r = createDescentRollState({ windowsUp: windowsUpAtStart });
    rollRef.current = r;
    setRoll(r);
    const a = createProgramAlarmState();
    alarmsRef.current = a;
    setAlarms(a);
    setAcknowledgedCallouts([]);
    setAcknowledgedHouston([]);
    setAborted(false);
    abortedRef.current = false;

    descentClockRef.current = createDescentClockState();
    setDescentClock(descentClockRef.current);
    escalationRef.current = createHoustonEscalationState();
    setEscalation(escalationRef.current);
    crewHasVehicleRef.current = false;
    forceHighGateRef.current = false;
  }, [makeInitial, script, generation, windowsUpAtStart, startsUnderPower, coastsToTig]);

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
        // OS key-repeat must never re-trigger edge actions (it made the
        // engine toggle flicker and delayed the felt response).
        if (e.repeat) return;
        heldRef.current.add(k);
        if (k === " ") engineRef.current = !engineRef.current;
        // Immediate nudge on press so the first frame already moves, instead
        // of waiting for the integrator to build up.
        if (k === "ArrowUp") throttleRef.current = clamp01(throttleRef.current + 0.03);
        if (k === "ArrowDown") throttleRef.current = clamp01(throttleRef.current - 0.03);
        if (k === "ArrowLeft") attitudeKickRef.current = -ATTITUDE_TAP_RATE;
        if (k === "ArrowRight") attitudeKickRef.current = ATTITUDE_TAP_RATE;

      } else if (k === "," || k === ".") {
        e.preventDefault();
        rodTargetRef.current += (k === "," ? -1 : 1) * ROD_INCREMENT_MPS;
      } else if (k === "r" || k === "R") {
        // M4.8 — hold R to roll toward windows-up.
        e.preventDefault();
        if (e.repeat) return;
        dispatchRoll({ kind: "roll", active: true });
      }
    };

    const up = (e: KeyboardEvent) => {
      heldRef.current.delete(e.key);
      if (e.key === "r" || e.key === "R") dispatchRoll({ kind: "roll", active: false });
    };
    const blur = () => {
      heldRef.current.clear();
      dispatchRoll({ kind: "roll", active: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [dispatchRoll]);

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
      pollGamepad();
      if (timeScale <= 0) return;
      accumulatorUs += dtMs * 1000 * timeScale;

      // M4.41 — the vehicle is never frozen, not even before the countdown is
      // armed: Eagle is on the descent orbit doing ~1,698 m/s with the engine
      // cold, so range to the landing site closes and the surface moves in the
      // window the whole time the crew works the pre-PDI checklist.
      const countdownRunning = ignitionRef.current.phase !== "standby";


      let steps = 0;
      let state = flightRef.current;
      while (accumulatorUs >= STEP_US && steps < MAX_CATCHUP_STEPS) {
        accumulatorUs -= STEP_US;
        steps += 1;
        if (state.terminalState !== null) break;
        if (countdownRunning) dispatchIgnition({ kind: "tick", dtUs: STEP_US });
        // M4.13B — roll, alarms and crew callouts run on ignition-relative
        // time from one pure state machine, so every entry path into the
        // descent (ritual, skipped ritual, abort, auto-guidance) drives the
        // historical sequence.
        descentClockRef.current = stepDescentClock(descentClockRef.current, {
          ritualSinceIgnitionUs: ignitionRef.current.sinceIgnitionUs,
          countdownArmed: countdownRunning,
          countdownAborted: ignitionRef.current.phase === "aborted",
          engineBurning: state.mainEngine !== "off",
          flightLockReleased: procedureRef.current.flightLockReleased,
          stepUs: STEP_US,
        });
        const sinceIgnitionUs = descentClockRef.current.sinceIgnitionUs;
        if (sinceIgnitionUs > 0) {
          dispatchRoll({ kind: "tick", dtUs: STEP_US, sinceIgnitionUs });
          if (apollo11Timeline) {
            // Alarms are keyed to the flown timeline AND to the telemetry
            // altitudes they were taken at, so they still occur when the
            // game's trajectory runs faster or slower than the real descent.
            dispatchAlarm({
              kind: "tick",
              sinceIgnitionUs,
              altitudeFt: computeOrbitalValues(state).altitudeM / 0.3048,
            });
          }
        }
        // M4.21 — escalation ladder runs on the same fixed step as the
        // physics, so the correction window is simulated time, not wall time.
        if (sinceIgnitionUs > 0 || state.mainEngine !== "off") {
          const o = computeOrbitalValues(state);
          // M4.39 — the crew only owns the vehicle once manual control is
          // unlocked AND they have actually taken it.
          const autoGuidanceHandsOff =
            procedureRef.current.manualControlUnlocked &&
            crewHasVehicleRef.current;
          escalationRef.current = reduceHoustonEscalation(escalationRef.current, {
            deviations: houstonDeviations({
              altitudeM: o.altitudeM,
              radialSpeedMps: o.radialSpeedMps,
              horizontalSpeedMps: o.tangentialSpeedMps,
              attitudeRad: state.attitudeRad,
              angularRateRadPerSec: state.angularRateRadPerSec,
              propellantFraction:
                mission.initial.descentPropellantKg > 0
                  ? state.descentPropellantKg / mission.initial.descentPropellantKg
                  : 0,
              windowsUp: radarAvailable(rollRef.current),
              engineBurning: state.mainEngine !== "off",
              terminal: state.terminalState !== null,
              rangeToLzM: downrangeToLandingZoneM(
                o.centralAngleRad,
                LANDING_ZONE_ANGLE_RAD,
              ),
              sinceIgnitionUs,
              p64Selected: procedureRef.current.completedStepIds.includes("p64-monitor"),
              autoGuidanceActive: !autoGuidanceHandsOff,
            }),
            stepUs: STEP_US,
            terminal: state.terminalState !== null,
            crewAborted: abortedRef.current,
            autoGuidanceActive: !autoGuidanceHandsOff,
          });
        }
        if (
          shouldAdvanceFlightPhysics(
            mission.id,
            ignitionRef.current,
            abortedRef.current,
          )
        ) {
          const input = resolveInput(state);
          state = stepLunarFlight(state, input, STEP_US);
        }
      }
      if (steps > 0) {
        flightRef.current = state;
        updateHaptics(state);
        setFlight(state);
        setDescentClock(descentClockRef.current);
        setEscalation(escalationRef.current);
        if (state.terminalState !== null) setRunning(false);
      }
    };

    // --- M4.30 Xbox controller ---------------------------------------------
    // Polled once per animation frame (the Gamepad API is poll-only), turned
    // into cockpit inputs by the pure mapper, and applied as edge actions.
    // Stick/trigger axes are consumed inside the physics step via padInputRef.
    let padRollCommanded = false;
    const pollGamepad = () => {
      const { input, next } = mapXboxInput(readLivePad(), padEdgesRef.current);
      padEdgesRef.current = next;
      padInputRef.current = input;

      // M4.49 — the pad remaps at manual takeover: while the computer flies,
      // RT rolls the vehicle and RB clears an alarm; once the crew has the
      // vehicle RT becomes the throttle and RB a short thrust burst.
      const crewFlying =
        procedureRef.current.manualControlUnlocked && crewHasVehicleRef.current;

      // Right trigger — roll toward windows-up (the R key), guided flight only.
      const rollWanted = input.rollCommanded && !crewFlying;
      if (rollWanted !== padRollCommanded) {
        padRollCommanded = rollWanted;
        dispatchRoll({ kind: "roll", active: rollWanted });
      }
      // Right bumper — alarm reset under guidance, throttle burst in manual.
      if (input.cancelAlarmPressed) {
        if (crewFlying && alarmsRef.current.active === null) {
          throttleBurstUntilMsRef.current = Date.now() + 900;
          manualThrottleHoldUntilMsRef.current = Date.now() + 900;
          engineRef.current = true;
          hapticsRef.current.pulse("ignition");
        } else if (alarmsRef.current.active !== null) {
          dispatchAlarm({
            kind: "cancel",
            sinceIgnitionUs: descentClockRef.current.sinceIgnitionUs,
          });
          hapticsRef.current.pulse("alarm");
        }
      }
      // Left bumper — easy program acceptance: key the pending DSKY step.
      if (input.acceptProgramPressed) acceptProgramRef.current();
      // View button — toggle the commander's first-person window view.
      if (input.toggleViewPressed && typeof window !== "undefined") {
        window.dispatchEvent(new Event("tranquility:toggle-view"));
      }
      // Right stick vertical — page scroll, but only while the computer still
      // flies: once the crew has the vehicle the same axis commands pitch.
      if (!crewFlying && input.scrollRate !== 0 && typeof window !== "undefined") {
        window.scrollBy({ top: input.scrollRate * 24, behavior: "auto" });
      }

      // A — acknowledge the on-screen call ("Got it" / "Copy that"). Alarms are
      // deliberately NOT dismissible this way; they stay on RB.
      if (input.acknowledgePressed) acknowledgeOnScreenCall();
      // X — ENG ARM, the PDI descent-arm switch.
      if (input.armEnginePressed) setEngineArmRef.current();
      // Left trigger — take manual control of the vehicle.
      if (input.takeoverPressed) takeoverRef.current();
      // Y — DPS on/off, but only once the crew actually has the vehicle.
      if (
        input.enginePressed &&
        procedureRef.current.manualControlUnlocked &&
        crewHasVehicleRef.current
      ) {
        engineRef.current = !engineRef.current;
      }
      // B — ABORT STAGE.
      if (input.abortPressed && !abortedRef.current && flightRef.current.terminalState === null) {
        abortedRef.current = true;
        setAborted(true);
        hapticsRef.current.pulse("abort");
      }
      if (input.rodTrim !== 0) {
        rodTargetRef.current += input.rodTrim * ROD_INCREMENT_MPS;
      }
    };


    // --- M4.30 haptics ------------------------------------------------------
    // Continuous engine bed plus a pulse on every event the crew would feel.
    let hadAlarm = alarmsRef.current.active !== null;
    let wasBurning = false;
    let hadContact = false;
    let hadTerminal = flightRef.current.terminalState !== null;
    let lastThrottle = 0;
    const updateHaptics = (state: LunarFlightState) => {
      const haptics = hapticsRef.current;
      const burning = state.mainEngine !== "off" && throttleRef.current > 0;
      if (burning && !wasBurning) {
        haptics.pulse("ignition");
        // Steady bed only for the ignition swell, then it stops.
        haptics.engineBurst(8000);
      }
      // Throttle-up to full: a second, more intense burst.
      if (burning && throttleRef.current > 0.85 && lastThrottle <= 0.85) {
        haptics.engineBurst(9000);
      }
      lastThrottle = burning ? throttleRef.current : 0;
      wasBurning = burning;


      const alarmActive = alarmsRef.current.active !== null;
      if (alarmActive && !hadAlarm) haptics.pulse("alarm");
      hadAlarm = alarmActive;

      const contact =
        contactLightState({
          altitudeM: computeOrbitalValues(state).altitudeM,
          terminalState: state.terminalState,
        }).on && state.terminalState === null;
      if (contact && !hadContact) haptics.pulse("contact");
      hadContact = contact;

      const terminal = state.terminalState;
      if (terminal !== null && !hadTerminal) {
        haptics.pulse(
          terminal === "landed"
            ? "touchdown"
            : terminal === "hard-landing"
              ? "hard-landing"
              : "crash",
        );
      }
      hadTerminal = terminal !== null;

      haptics.tick(throttleRef.current, state.mainEngine !== "off");
    };

    const resolveInput = (state: LunarFlightState): LunarControlInput => {
      // M4.18 — ABORT STAGE overrides everything: jettison the descent stage
      // and fly the fixed-thrust ascent engine up and downrange.
      if (abortedRef.current) {
        const staged = state.configuration !== "complete-lm";
        const desired = 1.2; // rad from local vertical — pitch over for orbit
        const err = desired - state.attitudeRad;
        const cmd = clampSigned(err * 3 - state.angularRateRadPerSec * 2.5);
        throttleRef.current = 1;
        attitudeRef.current = cmd;
        engineRef.current = true;
        return {
          throttle: 1,
          engineCommand: "ascent",
          attitudeCommand: cmd,
          stageSeparation: !staged,
        };
      }
      // Hand the vehicle to the crew at the approach phase (high gate), or
      // whenever they explicitly take over. Above that, on the Apollo 11
      // timeline, the computer flies P63 exactly as it did in 1969 — which is
      // what keeps the burn on range instead of sailing past the site.
      const autoBrakingMission = apollo11Timeline && mission.id === "full-descent";
      // M4.41 — during the pre-TIG coast the countdown is still running, so the
      // absence of a burn must NOT be read as "the crew has the vehicle".
      const preTigCoast =
        autoBrakingMission &&
        ignitionRef.current.phase !== "aborted" &&
        !isBurning(ignitionRef.current) &&
        descentClockRef.current.mode !== "running";
      if (!crewHasVehicleRef.current && !preTigCoast) {
        const o = computeOrbitalValues(state);
        const braking =
          autoBrakingMission &&
          o.altitudeM > PHASE_HIGH_GATE_M &&
          (isBurning(ignitionRef.current) ||
            descentClockRef.current.mode === "running");
        if (!braking) crewHasVehicleRef.current = true;
      }

      const manual =
        procedureRef.current.manualControlUnlocked && crewHasVehicleRef.current;

      let throttle: number;
      let attitudeCommand: number;

      if (manual) {
        // Held-key integration (also used by touch buttons via heldRef).
        const held = heldRef.current;
        if (held.has("ArrowUp")) throttleRef.current += 1.8 * STEP_S;
        if (held.has("ArrowDown")) throttleRef.current -= 1.8 * STEP_S;
        let stick = 0;
        if (held.has("ArrowLeft")) stick -= 1;
        if (held.has("ArrowRight")) stick += 1;

        // M4.30 / M4.49 — Xbox in manual flight: right stick pitches, the
        // right trigger is the throttle (analogue boost), RB gives a short
        // thrust burst, and the left stick still trims the throttle by rate.
        const pad = padInputRef.current;
        if (pad.thrustRate !== 0) throttleRef.current += pad.thrustRate * 1.8 * STEP_S;
        if (pad.pitch !== 0) stick = pad.pitch;
        const triggerThrottle = pad.rollPull > 0.02 ? pad.rollPull : null;
        if (triggerThrottle !== null) {
          throttleRef.current = triggerThrottle;
          engineRef.current = true;
        }
        const bursting = Date.now() < throttleBurstUntilMsRef.current;
        if (bursting) throttleRef.current = Math.max(throttleRef.current, 0.55);

        // M4.10 rate-command / attitude-hold: the stick commands a body rate,
        // and a released stick commands zero rate so the RCS nulls rotation
        // instead of leaving the vehicle drifting.
        const rateCmd = stick * COMMANDED_ATTITUDE_RATE;
        const kick = attitudeKickRef.current;
        attitudeKickRef.current = 0;
        attitudeRef.current = clampSigned(
          (rateCmd + kick - state.angularRateRadPerSec) * ATTITUDE_RATE_GAIN,
        );
        // Settled and hands off: issue an exact zero so the kernel's deadband
        // collapses the residual rate and the state stays reproducible.
        if (stick === 0 && kick === 0 && Math.abs(state.angularRateRadPerSec) < 2e-3) {
          attitudeRef.current = 0;
        }


        throttleRef.current = clamp01(throttleRef.current);

        // P66 rate-of-descent: with no direct thrust input, the throttle is
        // servoed onto the ROD target (as the real ROD switch trimmed it).
        const noThrustInput =
          !held.has("ArrowUp") &&
          !held.has("ArrowDown") &&
          pad.thrustRate === 0 &&
          triggerThrottle === null &&
          !bursting &&
          Date.now() >= manualThrottleHoldUntilMsRef.current;
        if (noThrustInput && engineRef.current) {
          const o = computeOrbitalValues(state);
          const mass = totalMassKg(state);
          const localG = MU_M3S2 / (o.radiusM * o.radiusM);
          const aNeeded = localG + (rodTargetRef.current - o.radialSpeedMps) / 3;
          const cosTilt = Math.max(0.2, Math.cos(state.attitudeRad));
          throttleRef.current = clamp01((aNeeded * mass) / (MAX_DPS_THRUST_N * cosTilt));
        }

        throttle = throttleRef.current;
        attitudeCommand = attitudeRef.current;
      } else {
        const o = computeOrbitalValues(state);
        // Signed: positive means the site is still ahead of the vehicle.
        const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
        // Below the last few tens of metres the profile is spent: hand back to
        // the terminal sink-rate law so the vehicle settles onto the surface.
        // Below low gate guidance keeps the range-aware target so the vehicle
        // flies the last few hundred metres to the site; it only drops to the
        // plain settle law once it is over the site with the translation out.
        if (o.altitudeM <= LOW_GATE_AIM.altitudeM) terminalGuidanceRef.current = true;
        const useProfile =
          !terminalGuidanceRef.current ||
          Math.abs(rangeM) >= 60 ||
          Math.abs(o.tangentialSpeedMps) >= 2;
        // The DPS throttle envelope is a hardware fact, so guidance has to know
        // about it: during fixed-throttle position the computer steers the
        // thrust vector instead of modulating it.
        const guidanceIgn = ignitionRef.current;
        const guidanceSinceIgnitionUs = isBurning(guidanceIgn)
          ? guidanceIgn.sinceIgnitionUs
          : apollo11Timeline && descentClockRef.current.mode === "running"
            ? descentClockRef.current.sinceIgnitionUs
            : null;
        const guidanceEnv =
          guidanceSinceIgnitionUs === null ? null : dpsThrottleEnvelope(guidanceSinceIgnitionUs);
        const cue = computeReferenceGuidance(state, undefined, !useProfile ? null : {
          rangeToLandingZoneM: rangeM,
          targetAltitudeM: nominalAltitudeForRangeM(Math.abs(rangeM)),
          targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
          handoverRangeM: HIGH_GATE_RANGE_M,
          fixedThrottle:
            guidanceEnv && guidanceEnv.min === guidanceEnv.max ? guidanceEnv.min : null,
          // M4.29 — the gate aim points, the profile slope and the throttle
          // band the engine is actually held inside, so guidance targets the
          // historical high-gate point instead of merely descending.
          handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps,
          approachAimRangeM: LOW_GATE_AIM.rangeToLzM,
          approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps,
          targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)),
          throttleMinFraction: guidanceEnv ? guidanceEnv.min : null,
          throttleMaxFraction: guidanceEnv ? guidanceEnv.max : null,
        });
        throttle = cue.recommendedThrottle;
        // M4.49 / M4.51 — automatic pitch-over at high gate, but ONLY as fast
        // as the translation allows. Forcing the cosmetic phase attitude while
        // the vehicle still carries downrange speed removed the braking
        // component guidance needs, so it sailed past the site and arrived hot.
        // The phase attitude is therefore blended in as horizontal speed is
        // nulled: no authority above ~30 m/s, full pitch-over below ~4 m/s.
        let aimAttitudeRad = cue.recommendedAttitudeRad;
        if (o.altitudeM <= PHASE_HIGH_GATE_M) {
          // M4.52 — the phase table is a PRESENTATION angle (positive = pitched
          // back for braking); the kernel's attitude is signed the other way
          // (negative = thrust tilted retrograde). Convert before using it as a
          // guidance aim, otherwise the pitch-over commanded PROGRADE thrust
          // and drove the vehicle away from the site.
          const phasePitch = -descentPhaseFor(o.altitudeM, { p64Selected: true }).pitchRad;
          const speed = Math.abs(o.tangentialSpeedMps);
          const blend = Math.max(0, Math.min(1, (30 - speed) / 26));
          // Only ever blend toward a MORE upright attitude — never add tilt.
          if (Math.abs(phasePitch) < Math.abs(aimAttitudeRad)) {
            aimAttitudeRad = aimAttitudeRad + (phasePitch - aimAttitudeRad) * blend;
          }
        }

        // Simple proportional attitude autopilot onto the advisory angle.
        const err = aimAttitudeRad - state.attitudeRad;
        attitudeCommand = clampSigned(err * 3 - state.angularRateRadPerSec * 2.5);
        throttleRef.current = throttle;
        attitudeRef.current = attitudeCommand;
      }

      engineRef.current = manual ? engineRef.current : throttle > 0;

      // DPS throttle profile: cold until TIG, 10 % for 26 s, the 92.5 % fixed
      // throttle point through the braking phase, then throttle recovery at
      // T+6:26 into the 10-60 % variable range (the band above 60 % eroded the
      // nozzle, so guidance never modulates there).
      const ign = ignitionRef.current;
      if (ign.phase !== "standby" && !isBurning(ign)) {
        // Pre-ignition: the engine is cold whatever the player commands.
        throttle = 0;
        engineRef.current = false;
      } else {
        // Apollo 11 always flies the profile, even if the player reached the
        // burn without the countdown ritual: the transcript says "ignition,
        // ten percent", so the engine must actually be at 10 %.
        const sinceIgnitionUs = isBurning(ign)
          ? ign.sinceIgnitionUs
          : apollo11Timeline && descentClockRef.current.mode === "running"
            ? descentClockRef.current.sinceIgnitionUs
            : null;
        if (sinceIgnitionUs !== null) {
          const env = dpsThrottleEnvelope(sinceIgnitionUs);
          if (throttle > env.max) throttle = env.max;
          // Under guidance the computer holds the commanded level exactly;
          // in manual the crew may close the throttle entirely.
          if (!manual && throttle > 0 && throttle < env.min) throttle = env.min;
        }
        if (isBurning(ign) && !manual) engineRef.current = throttle > 0;
      }

      // Keep the published instruments honest about the commanded throttle.
      throttleRef.current = throttle;


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
    const haptics = hapticsRef.current;
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(publish);
      haptics.stop();
    };
  }, [
    running, timeScale, apollo11Timeline, mission,
    dispatchIgnition, dispatchRoll, dispatchAlarm,
  ]);

  // --- Tab recovery ---------------------------------------------------------
  // A hidden tab throttles requestAnimationFrame, so the accumulator would
  // otherwise return to a huge catch-up on re-show. We pause instead: the
  // player comes back to the exact state they left, never to a crash that
  // happened off-screen.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setRunning(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);


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
  const currentHighGateStatus = highGateStatus(
    descentClockUs,
    orbit.altitudeM,
    downrangeM,
  );

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
      alarms: apollo11Timeline ? summarizeAlarms(alarms) : undefined,
      rolledWindowsUp: roll.completedSinceIgnitionUs !== null,
      limits,
    };
  }, [
    flight, mission, controlMode, assistance, downrangeM, takeover, script,
    procedure, limits, apollo11Timeline, alarms, roll,
  ]);

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

  /** Live procedure gates, shared by hand-keyed and assisted entries. */
  const readGates = useCallback(() => {
    const o = computeOrbitalValues(flightRef.current);
    return {
      engineArmed: ignitionRef.current.engineArmed,
      windowsUp: radarAvailable(rollRef.current),
      alarmActive: alarmsRef.current.active !== null,
      sinceIgnitionUs: descentClockRef.current.sinceIgnitionUs,
      highGateReady:
        forceHighGateRef.current ||
        highGateStatus(
          descentClockRef.current.sinceIgnitionUs,
          o.altitudeM,
          downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD),
        ) === "ready",
    };
  }, []);

  const onDskyKey = useCallback(
    (code: number | "PRO") => {
      // The AGC already received this keystroke upstream. Here we only run the
      // bridged cockpit ritual: PRO answers the flashing V99 request.
      if (code === "PRO") dispatchIgnition({ kind: "proceed" });
      // Gates are read before the alarm reducer sees the key, so the RSET that
      // clears an alarm still satisfies the "an alarm is lit" requirement.
      const gates = readGates();
      setProcedure((prev) => {
        const next = reduceProcedure(script, prev, {
          kind: "key",
          code,
          missionTimeUs: flightRef.current.missionTimeUs,
          gates,
        });
        procedureRef.current = next;
        if (!prev.manualControlUnlocked && next.manualControlUnlocked) {
          const o = computeOrbitalValues(flightRef.current);
          recordTakeover(o.altitudeM > 300);
        }
        // A step may arm the PDI countdown clock on completion.
        const done = currentStep(script, prev);
        if (
          done?.startsIgnitionCountdown === true &&
          next.stepIndex > prev.stepIndex
        ) {
          dispatchIgnition({ kind: "start" });
          setRunning(true);
        }
        if (!prev.flightLockReleased && next.flightLockReleased) setRunning(true);
        return next;
      });
      // Alarm read-out / RSET tracking runs on the raw keystroke stream.
      if (typeof code === "number") {
        dispatchAlarm({
          kind: "key",
          code,
          sinceIgnitionUs: ignitionRef.current.sinceIgnitionUs,
        });
      }
    },
    [script, recordTakeover, dispatchIgnition, dispatchAlarm, readGates],
  );

  /**
   * M4.31 — easy program acceptance. Resolves the outstanding keys for the
   * pending step and taps them into the DSKY on a human cadence, so the AGC
   * sees an ordinary keystroke stream and the procedure engine advances
   * through its normal path (gates, logging and scoring all still apply).
   */
  const acceptProgram = useCallback(() => {
    const plan = resolveProgramAcceptance(script, procedureRef.current, readGates());
    if (plan.kind !== "keys") {
      if (plan.kind === "blocked") {
        setProcedure((prev) => {
          const next = { ...prev, lastMessage: `Assist held: ${plan.reason}` };
          procedureRef.current = next;
          return next;
        });
      }
      return;
    }
    const send = keyInjectorRef.current;
    if (send === null) return;
    // Cancel any acceptance still in flight so a double-press cannot interleave
    // two keystroke streams into the AGC.
    for (const id of acceptanceTimersRef.current) window.clearTimeout(id);
    acceptanceTimersRef.current = [];
    setAssistedProgramEntries((n) => n + 1);
    plan.keys.forEach((code: InjectableKey, i) => {
      const id = window.setTimeout(() => {
        keyInjectorRef.current?.(code);
      }, i * ACCEPTANCE_KEY_INTERVAL_MS);
      acceptanceTimersRef.current.push(id);
    });
  }, [script, readGates]);

  // Never leave keystrokes queued into an unmounted session.
  useEffect(
    () => () => {
      for (const id of acceptanceTimersRef.current) window.clearTimeout(id);
      acceptanceTimersRef.current = [];
    },
    [],
  );


  useEffect(() => {
    acceptProgramRef.current = acceptProgram;
  }, [acceptProgram]);

  /**
   * M4.55 — P64 is taken by the computer, not the crew. Historically the AGC
   * switched P63 -> P64 by itself at high gate; the crew only read it out. As
   * soon as the high-gate time-and-geometry box is satisfied the approach
   * program is keyed automatically, so PROG 64 and the flashing V06 N64 come
   * up on the DSKY and the pitch-over starts without a player entry.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let fired = false;
    const id = window.setInterval(() => {
      if (fired) return;
      const state = procedureRef.current;
      if (state.completedStepIds.includes("p64-monitor")) {
        fired = true;
        return;
      }
      const step = currentStep(script, state);
      if (step?.id !== "p64-monitor") return;
      if (!readGates().highGateReady) return;
      fired = true;
      acceptProgramRef.current();
    }, 250);
    return () => window.clearInterval(id);
  }, [script, readGates, generation]);




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
        crewHasVehicleRef.current = true;
        recordTakeover(o.altitudeM > 300);
        setRunning(true);
      },
      setThrottle: (v: number) => {
        throttleRef.current = clamp01(v);
        manualThrottleHoldUntilMsRef.current = Date.now() + 400;
        if (throttleRef.current > 0) engineRef.current = true;
      },
      adjustThrottle: (d: number) => {
        throttleRef.current = clamp01(throttleRef.current + d);
        manualThrottleHoldUntilMsRef.current = Date.now() + 400;
        // Winding the throttle up implies the crew wants the DPS burning.
        if (d > 0 && throttleRef.current > 0) engineRef.current = true;
      },
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
      setEngineArm: (on: boolean) => { dispatchIgnition({ kind: "arm", on }); },
      startIgnitionCountdown: () => {
        if (ignitionRef.current.phase !== "standby") return;
        dispatchIgnition({ kind: "start" });
        setRunning(true);
      },
      setRollCommand: (active: boolean) => { dispatchRoll({ kind: "roll", active }); },
      acknowledgeCallout: (id: string) => {
        setAcknowledgedCallouts((prev) => (prev.includes(id) ? prev : [...prev, id]));
      },
      acknowledgeHouston: (id: string) => {
        setAcknowledgedHouston((prev) => (prev.includes(id) ? prev : [...prev, id]));
      },
      acceptProgram,
      registerKeyInjector: (send: ((code: number | "PRO") => void) | null) => {
        keyInjectorRef.current = send;
      },
      setHaptics: (on: boolean) => {
        hapticsRef.current.setEnabled(on);
        setHapticsEnabled(on);
      },
      abortStage: () => {
        if (abortedRef.current) return;
        if (flightRef.current.terminalState !== null) return;
        abortedRef.current = true;
        setAborted(true);
        setRunning(true);
      },
    }),
    [onDskyKey, acceptProgram, script, recordTakeover, dispatchIgnition, dispatchRoll],
  );

  // M4.45 — the pad drives the same cockpit switches the mouse does.
  useEffect(() => {
    takeoverRef.current = actions.takeover;
    setEngineArmRef.current = () => {
      actions.setEngineArm(!ignitionRef.current.engineArmed);
    };
  }, [actions]);


  const descentMonitor = useMemo(
    () =>
      descentMonitorFor({
        altitudeM: orbit.altitudeM,
        radialSpeedMps: orbit.radialSpeedMps,
        tangentialSpeedMps: orbit.tangentialSpeedMps,
        tigOffsetUs: ignition.tigOffsetUs,
        sinceIgnitionUs: ignition.sinceIgnitionUs,
        burning: flight.mainEngine !== "off" || ignition.phase === "burning",
        terminal: flight.terminalState !== null,
      }),
    [orbit, ignition, flight.mainEngine, flight.terminalState],
  );

  // M4.18 — deviation snapshot feeding the improvised Houston calls and the
  // go/no-go for landing. Pure inputs; no timers, no AGC.
  const deviation: FlightDeviationInput = useMemo(
    () => ({
      altitudeM: orbit.altitudeM,
      radialSpeedMps: orbit.radialSpeedMps,
      horizontalSpeedMps: orbit.tangentialSpeedMps,
      attitudeRad: flight.attitudeRad,
      angularRateRadPerSec: flight.angularRateRadPerSec,
      propellantFraction:
        mission.initial.descentPropellantKg > 0
          ? flight.descentPropellantKg / mission.initial.descentPropellantKg
          : 0,
      windowsUp: radarAvailable(roll),
      engineBurning: flight.mainEngine !== "off",
      terminal: flight.terminalState !== null,
      rangeToLzM: downrangeM,
      sinceIgnitionUs: descentClockUs,
      p64Selected: procedure.completedStepIds.includes("p64-monitor"),
    }),
    [orbit, flight, mission, roll, downrangeM, descentClockUs, procedure.completedStepIds],
  );

  const scriptTerminated = escalation.scriptTerminated || aborted;
  const offScript = scriptTerminated || isOffScript(deviation);

  const houston = useMemo(
    () =>
      aborted
        ? HOUSTON_ABORT_CALL
        : escalatedCall(escalation, activeHoustonCall(deviation, acknowledgedHouston)),
    [aborted, deviation, acknowledgedHouston, escalation],
  );

  const clearance = useMemo(
    () =>
      aborted
        ? { clear: false, reasons: [HOUSTON_ABORT_CALL.guidance], label: "ABORT — NO LANDING" }
        : escalation.stage === "abort"
          ? {
              clear: false,
              reasons: [
                "Houston recommends ABORT STAGE — correct the state or abort; the landing is not cleared.",
              ],
              label: "ABORT RECOMMENDED",
            }
          : landingClearance(deviation),
    [aborted, deviation, escalation.stage],
  );

  const callout = useMemo(
    () =>
      apollo11Timeline && !offScript
        ? activeCallout(
            {
              sinceIgnitionUs: descentClockUs,
              altitudeM: orbit.altitudeM,
              burning: flight.mainEngine !== "off",
              rangeToLzM: downrangeM,
            },
            acknowledgedCallouts,
          )
        : null,
    [
      apollo11Timeline,
      offScript,
      descentClockUs,
      orbit.altitudeM,
      flight.mainEngine,
      acknowledgedCallouts,
      downrangeM,
    ],
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
    flightLockReleased: procedure.flightLockReleased || ignition.phase !== "standby",
    gamepadConnected,
    ignition,
    ignitionClock: formatTig(ignition),
    descentClock,
    descentClockLabel: formatDescentClock(descentClock),
    descentClockStatus: descentClockStatusLabel(descentClock),
    bridgedDskyRequest: bridgedRequestFor(ignition),
    descentMonitor,
    roll,
    rollActive: roll.commanded,
    radarAvailable: radarAvailable(roll),
    alarms,
    bridgedAlarm: apollo11Timeline ? bridgedAlarmFor(alarms) : null,
    callout,
    houston,
    landingClearance: clearance,
    escalation,
    secondsToAbort: secondsToAbort(escalation),
    scriptTerminated,
    aborted,
    highGateStatus: currentHighGateStatus,
    hapticsEnabled,
    assistedProgramEntries,
    actions,

  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampSigned(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
