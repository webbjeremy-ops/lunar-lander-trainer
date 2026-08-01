// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Orbital-operations session hook.
//
// Owns the real-time loop that drives the PURE orbital-operations runtime with
// a fixed 20 ms step. All physics lives in `stepOrbitOps`; this hook only feeds
// it wall-clock deltas, records the trace, and publishes derived values.
//
// PHYSICS FIREWALL: nothing here reads AGC state, and no AGC value reaches the
// runtime. The DSKY beside the display is the authentic shared session, shown
// for study only.
//
// The planner never fires the engine by itself: `startBurn` is only ever
// called from an explicit player action.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INTERCEPT_RANGE_M,
  ORBIT_TIME_SCALES,
  appendTraceEvent,
  availableDeltaVMps,
  buildOrbitDebrief,
  clampTimeScale,
  createOrbitOpsState,
  createOrbitTrace,
  deriveOrbitOps,
  evaluateOrbitScenario,
  listGuidedSolutions,
  meanAttitudeErrorRad,
  nodeEvent,
  parametersForScenario,
  planPhasingBurn,
  previewImpulsive,
  sampleConic,
  scoreOrbitOperations,
  setManeuverNode as setNode,
  startBurn as runtimeStartBurn,
  stepOrbitOps,
  stopBurn as runtimeStopBurn,
  timeScaleGuard,
  traceChecksum,
  type ConicPoint,
  type DebriefEntry,
  type GuidedSolution,
  type ImpulsivePreview,
  type ManeuverNode,
  type OrbitOpsDerived,
  type OrbitOpsState,
  type OrbitScenario,
  type OrbitScore,
  type OrbitTrace,
  type PhasingRecommendation,
  type BurnDirection,
} from "@/simulation/orbitOps";
import { totalMassKg } from "@/simulation/lunar2d/physics";

const STEP_US = 20_000;
const MAX_CATCHUP_STEPS = 400;

export type OrbitAssistance = "instructor" | "pilot" | "commander";

export { ORBIT_TIME_SCALES };

export interface OrbitNodeDraft {
  readonly leadSeconds: number;
  readonly direction: BurnDirection;
  readonly deltaVMps: number;
}

export interface OrbitSessionApi {
  readonly state: OrbitOpsState;
  readonly derived: OrbitOpsDerived;
  readonly node: ManeuverNode | null;
  readonly draft: OrbitNodeDraft;
  readonly preview: ImpulsivePreview | null;
  readonly guided: readonly GuidedSolution[];
  readonly phasing: PhasingRecommendation | null;
  readonly coastArc: readonly ConicPoint[];
  readonly targetArc: readonly ConicPoint[];
  readonly plannedArc: readonly ConicPoint[];
  readonly massKg: number;
  readonly deltaVAvailableMps: number;
  readonly running: boolean;
  readonly timeScale: number;
  readonly maxTimeScale: number;
  readonly timeScaleReason: string | null;
  readonly complete: boolean;
  readonly terminalBanner: readonly string[] | null;
  readonly conditions: ReturnType<typeof evaluateOrbitScenario>["conditions"];
  readonly score: OrbitScore | null;
  readonly debrief: readonly DebriefEntry[];
  readonly trace: OrbitTrace;
  readonly traceChecksum: number;
  readonly actions: {
    readonly setRunning: (v: boolean) => void;
    readonly setTimeScale: (v: number) => void;
    readonly restart: () => void;
    readonly setDraft: (d: Partial<OrbitNodeDraft>) => void;
    readonly commitNode: () => void;
    readonly clearNode: () => void;
    readonly adoptSolution: (s: GuidedSolution) => void;
    readonly startBurn: () => void;
    readonly stopBurn: () => void;
    readonly endExercise: () => void;
  };
}

export function useOrbitSession(
  scenario: OrbitScenario,
  assistance: OrbitAssistance,
): OrbitSessionApi {
  const parameters = useMemo(() => parametersForScenario(scenario), [scenario]);

  const [state, setState] = useState<OrbitOpsState>(() =>
    createOrbitOpsState(scenario),
  );
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScaleRaw] = useState(1);
  const [ended, setEnded] = useState(false);
  const [draft, setDraftState] = useState<OrbitNodeDraft>({
    leadSeconds: 60,
    direction: "prograde",
    deltaVMps: 10,
  });
  const [trace, setTrace] = useState<OrbitTrace>(() =>
    createOrbitTrace(scenario.id, scenario.version, assistance),
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const autoPausedRef = useRef(false);

  // --- reset on scenario / assistance change --------------------------------
  useEffect(() => {
    const fresh = createOrbitOpsState(scenario);
    setState(fresh);
    stateRef.current = fresh;
    setRunning(false);
    setTimeScaleRaw(1);
    setEnded(false);
    autoPausedRef.current = false;
    setTrace(createOrbitTrace(scenario.id, scenario.version, assistance));
  }, [scenario, assistance]);

  const derived = useMemo(
    () => deriveOrbitOps(state, parameters),
    [state, parameters],
  );

  const guard = useMemo(
    () => timeScaleGuard(state, derived, { interceptRangeM: INTERCEPT_RANGE_M }),
    [state, derived],
  );
  const effectiveScale = clampTimeScale(timeScale, guard);

  // --- real-time loop -------------------------------------------------------
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
      if (effectiveScale <= 0) return;
      accumulatorUs += dtMs * 1000 * effectiveScale;

      let steps = 0;
      let s = stateRef.current;
      while (accumulatorUs >= STEP_US && steps < MAX_CATCHUP_STEPS) {
        accumulatorUs -= STEP_US;
        steps += 1;
        if (s.lm.terminalState !== null) break;
        s = stepOrbitOps(s, scenario, STEP_US, parameters);
        if (s.outcome !== "in-progress") break;
      }
      if (steps > 0) {
        stateRef.current = s;
        setState(s);
        if (s.outcome !== "in-progress" || s.lm.terminalState !== null) {
          setRunning(false);
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, effectiveScale, scenario, parameters]);

  // --- instructor auto-pause near the node ----------------------------------
  useEffect(() => {
    if (assistance !== "instructor") return;
    if (state.node === null || state.burning || autoPausedRef.current) return;
    const dtS = (state.node.ignitionTimeUs - state.lm.missionTimeUs) / 1_000_000;
    if (dtS >= 0 && dtS <= 5 && running) {
      autoPausedRef.current = true;
      setRunning(false);
    }
  }, [assistance, state, running]);

  // --- hidden tabs pause both vehicles --------------------------------------
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setRunning(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // --- derived views --------------------------------------------------------
  const coastArc = useMemo(
    () => sampleConic(derived.elements, 180, parameters),
    [derived.elements, parameters],
  );
  const targetArc = useMemo(
    () =>
      derived.targetElements
        ? sampleConic(derived.targetElements, 180, parameters)
        : [],
    [derived.targetElements, parameters],
  );

  const preview = useMemo<ImpulsivePreview | null>(() => {
    if (state.node === null || state.node.deltaVMps <= 0) return null;
    return previewImpulsive(
      state.lm,
      state.node,
      parameters,
      derived.targetElements,
    );
  }, [state.node, state.lm, parameters, derived.targetElements]);

  const plannedArc = useMemo(
    () => (preview ? sampleConic(preview.after, 180, parameters) : []),
    [preview, parameters],
  );

  const guided = useMemo(
    () =>
      listGuidedSolutions(
        state.lm,
        {
          safePeriapsisAltitudeM: scenario.safePeriapsisAltitudeM,
          targetPeriapsisAltitudeM: scenario.safePeriapsisAltitudeM,
          targetApoapsisAltitudeM:
            derived.targetElements?.apoapsisAltitudeM ?? undefined,
          targetPeriodS: derived.targetElements?.orbitalPeriodS ?? null,
        },
        parameters,
      ),
    [state.lm, scenario.safePeriapsisAltitudeM, derived.targetElements, parameters],
  );

  const phasing = useMemo<PhasingRecommendation | null>(() => {
    const te = derived.targetElements;
    if (!te || te.orbitalPeriodS === null || !derived.relative) return null;
    const el = derived.elements;
    return planPhasingBurn({
      burnRadiusM: el.radiusM,
      burnSpeedMps: el.speedMps,
      targetPeriodS: te.orbitalPeriodS,
      targetRadiusM: te.radiusM,
      phaseAtBurnRad: derived.relative.phaseAngleRad,
      availableDeltaVMps: availableDeltaVMps(state.lm, parameters),
      referenceRadiusM: parameters.terrain.meanRadiusM,
      gravitationalParameterM3S2:
        parameters.environment.gravitationalParameterM3S2.value,
      safePeriapsisAltitudeM: scenario.safePeriapsisAltitudeM,
    });
  }, [derived, state.lm, parameters, scenario.safePeriapsisAltitudeM]);

  const evaluation = useMemo(
    () =>
      evaluateOrbitScenario(
        scenario,
        state.lm,
        derived.elements,
        derived.relative,
        derived.targetElements,
      ),
    [scenario, state.lm, derived],
  );

  const complete =
    ended || state.outcome !== "in-progress" || state.lm.terminalState !== null;

  const record = useMemo(
    () => ({
      scenarioId: scenario.id,
      assistance,
      outcome: state.outcome,
      elements: derived.elements,
      targetElements: derived.targetElements,
      relative: derived.relative,
      burnCount: state.burnCount,
      totalDeltaVMps: state.totalDeltaVMps,
      plannedDeltaVMps: state.plannedDeltaVMps,
      achievedDeltaVMps: state.totalDeltaVMps,
      propellantRemainingKg: state.lm.ascentPropellantKg,
      propellantInitialKg: state.propellantInitialKg,
      bestRangeM: state.bestRangeM,
      burnTimingErrorS:
        state.node === null || state.burnStartTimeUs === null
          ? null
          : Math.abs(state.burnStartTimeUs - state.node.ignitionTimeUs) / 1_000_000,
      attitudeAlignmentErrorRad: meanAttitudeErrorRad(state),
      missionTimeS: state.lm.missionTimeUs / 1_000_000,
    }),
    [scenario.id, assistance, state, derived],
  );

  const score = useMemo(
    () => (complete ? scoreOrbitOperations(scenario, record) : null),
    [complete, scenario, record],
  );
  const debrief = useMemo(
    () =>
      complete
        ? buildOrbitDebrief(scenario, record, state.elementsBeforeFirstBurn)
        : [],
    [complete, scenario, record, state.elementsBeforeFirstBurn],
  );

  // --- actions --------------------------------------------------------------
  const setTimeScale = useCallback(
    (v: number) => {
      setTimeScaleRaw(v);
      setTrace((t) =>
        appendTraceEvent(t, {
          t: stateRef.current.lm.missionTimeUs,
          kind: "time-scale",
          scale: v,
        }),
      );
    },
    [],
  );

  const restart = useCallback(() => {
    const fresh = createOrbitOpsState(scenario);
    setState(fresh);
    stateRef.current = fresh;
    setRunning(false);
    setTimeScaleRaw(1);
    setEnded(false);
    autoPausedRef.current = false;
    setTrace(createOrbitTrace(scenario.id, scenario.version, assistance));
  }, [scenario, assistance]);

  const setDraft = useCallback((d: Partial<OrbitNodeDraft>) => {
    setDraftState((prev) => ({ ...prev, ...d }));
  }, []);

  const commitNode = useCallback(() => {
    const s = stateRef.current;
    const node: ManeuverNode = {
      ignitionTimeUs: Math.round(
        s.lm.missionTimeUs + Math.max(0, draft.leadSeconds) * 1_000_000,
      ),
      direction: draft.direction,
      deltaVMps: Math.max(0, draft.deltaVMps),
    };
    const next = setNode(s, node);
    stateRef.current = next;
    setState(next);
    autoPausedRef.current = false;
    setTrace((t) => appendTraceEvent(t, nodeEvent(s.lm.missionTimeUs, node)));
  }, [draft]);

  const clearNode = useCallback(() => {
    const next = setNode(stateRef.current, null);
    stateRef.current = next;
    setState(next);
    setTrace((t) =>
      appendTraceEvent(t, {
        t: stateRef.current.lm.missionTimeUs,
        kind: "node-clear",
      }),
    );
  }, []);

  const adoptSolution = useCallback((s: GuidedSolution) => {
    const cur = stateRef.current;
    setDraftState({
      leadSeconds: Math.max(
        0,
        (s.node.ignitionTimeUs - cur.lm.missionTimeUs) / 1_000_000,
      ),
      direction: s.node.direction,
      deltaVMps: s.node.deltaVMps,
    });
    const next = setNode(cur, s.node);
    stateRef.current = next;
    setState(next);
    autoPausedRef.current = false;
    setTrace((t) => appendTraceEvent(t, nodeEvent(cur.lm.missionTimeUs, s.node)));
  }, []);

  const startBurn = useCallback(() => {
    const next = runtimeStartBurn(stateRef.current, scenario, parameters);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    setTimeScaleRaw(1);
    setRunning(true);
    setTrace((t) =>
      appendTraceEvent(t, { t: next.lm.missionTimeUs, kind: "burn-start" }),
    );
  }, [scenario, parameters]);

  const stopBurn = useCallback(() => {
    const next = runtimeStopBurn(stateRef.current);
    stateRef.current = next;
    setState(next);
    setTrace((t) =>
      appendTraceEvent(t, { t: next.lm.missionTimeUs, kind: "burn-stop" }),
    );
  }, []);

  const endExercise = useCallback(() => {
    setEnded(true);
    setRunning(false);
    setTrace((t) =>
      appendTraceEvent(t, {
        t: stateRef.current.lm.missionTimeUs,
        kind: "terminal",
        outcome: stateRef.current.outcome,
      }),
    );
  }, []);

  return {
    state,
    derived,
    node: state.node,
    draft,
    preview,
    guided,
    phasing,
    coastArc,
    targetArc,
    plannedArc,
    massKg: totalMassKg(state.lm),
    deltaVAvailableMps: availableDeltaVMps(state.lm, parameters),
    running,
    timeScale,
    maxTimeScale: guard.maxScale,
    timeScaleReason: guard.reason,
    complete,
    terminalBanner: evaluation.terminalBanner,
    conditions: evaluation.conditions,
    score,
    debrief,
    trace,
    traceChecksum: traceChecksum(trace),
    actions: {
      setRunning,
      setTimeScale,
      restart,
      setDraft,
      commitNode,
      clearNode,
      adoptSolution,
      startBurn,
      stopBurn,
      endExercise,
    },
  };
}
