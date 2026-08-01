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

import {
  DESCENT_ENGINE,
  LUNAR_ENVIRONMENT,
} from "@/simulation/lunar2d/LunarMissionConstants";

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
  const [ignition, setIgnition] = useState<IgnitionSequenceState>(createIgnitionState);
  // M4.8 — cockpit roll orientation and program alarms. Both are pure
  // reducers driven from the same 20 ms loop; neither touches the physics
  // kernel or the AGC.
  const [roll, setRoll] = useState<DescentRollState>(createDescentRollState);
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
  const attitudeRef = useRef(0);
  /** One-shot rate kick consumed by the attitude controller on key press. */
  const attitudeKickRef = useRef(0);

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
    const ign = createIgnitionState();
    ignitionRef.current = ign;
    setIgnition(ign);
    const r = createDescentRollState();
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
      if (timeScale <= 0) return;
      accumulatorUs += dtMs * 1000 * timeScale;

      const proc = procedureRef.current;
      // The vehicle coasts through the PDI countdown, so the clock runs as
      // soon as the countdown is armed — not only after PROCEED.
      const countdownRunning = ignitionRef.current.phase !== "standby";
      if (!proc.flightLockReleased && !countdownRunning && !abortedRef.current) {
        accumulatorUs = 0;
        return;
      }

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
          flightLockReleased: proc.flightLockReleased,
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
            }),
            stepUs: STEP_US,
            terminal: state.terminalState !== null,
            crewAborted: abortedRef.current,
          });
        }
        const input = resolveInput(state);
        state = stepLunarFlight(state, input, STEP_US);
      }
      if (steps > 0) {
        flightRef.current = state;
        setFlight(state);
        setDescentClock(descentClockRef.current);
        setEscalation(escalationRef.current);
        if (state.terminalState !== null) setRunning(false);
      }
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
      const manual = procedureRef.current.manualControlUnlocked;

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

        const pad = readGamepad();
        if (pad) {
          if (Math.abs(pad.attitude) > 0.12) stick = pad.attitude;
          if (pad.throttle !== null) throttleRef.current = pad.throttle;
        }

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
          !held.has("ArrowUp") && !held.has("ArrowDown") && (!pad || pad.throttle === null);
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
        const useProfile = o.altitudeM > 60;
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
        });
        throttle = cue.recommendedThrottle;
        // Simple proportional attitude autopilot onto the advisory angle.
        const err = cue.recommendedAttitudeRad - state.attitudeRad;
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
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(publish);
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

  const onDskyKey = useCallback(
    (code: number | "PRO") => {
      // The AGC already received this keystroke upstream. Here we only run the
      // bridged cockpit ritual: PRO answers the flashing V99 request.
      if (code === "PRO") dispatchIgnition({ kind: "proceed" });
      // Gates are read before the alarm reducer sees the key, so the RSET that
      // clears an alarm still satisfies the "an alarm is lit" requirement.
      const gates = {
        engineArmed: ignitionRef.current.engineArmed,
        windowsUp: radarAvailable(rollRef.current),
        alarmActive: alarmsRef.current.active !== null,
        sinceIgnitionUs: descentClockRef.current.sinceIgnitionUs,
      };
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
    [script, recordTakeover, dispatchIgnition, dispatchAlarm],
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
      abortStage: () => {
        if (abortedRef.current) return;
        if (flightRef.current.terminalState !== null) return;
        abortedRef.current = true;
        setAborted(true);
        setRunning(true);
      },
    }),
    [onDskyKey, script, recordTakeover, dispatchIgnition, dispatchRoll],
  );


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
    }),
    [orbit, flight, mission, roll],
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
        : escalation.abortDirected
          ? {
              clear: false,
              reasons: ["Houston has directed an abort — hit ABORT STAGE."],
              label: "ABORT DIRECTED",
            }
          : landingClearance(deviation),
    [aborted, deviation, escalation.abortDirected],
  );

  const callout = useMemo(
    () =>
      apollo11Timeline && !offScript
        ? activeCallout(
            {
              sinceIgnitionUs: descentClockUs,
              altitudeM: orbit.altitudeM,
              burning: flight.mainEngine !== "off",
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
