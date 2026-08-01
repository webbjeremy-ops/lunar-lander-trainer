// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Pure orbital-operations runtime.
//
// Owns both vehicles, the manoeuvre node, the finite-burn state machine and
// the objective evaluation. It is a pure reducer: given the same state, the
// same inputs and the same dt it always produces the same next state. The
// React layer only feeds it wall-clock deltas and renders the result.
//
// PHYSICS FIREWALL: `stepLunarFlight` is the only propagator, and no AGC value
// ever reaches it.

import { stepLunarFlight } from "@/simulation/lunar2d/physics";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import type {
  LunarControlInput,
  LunarFlightState,
} from "@/simulation/lunar2d/types";
import { elementsForState } from "./OrbitalElements";
import { COAST_CONTROL } from "./OrbitPrediction";
import {
  attitudeForDirection,
  exhaustVelocityMps,
} from "./FiniteBurnModel";
import { totalMassKg } from "@/simulation/lunar2d/physics";
import { relativeState } from "./RelativeMotion";
import {
  PASSIVE_TARGET_PARAMETERS,
  createOrbitVehicleState,
  parametersForPropulsion,
} from "./OrbitVehicles";
import { evaluateOrbitScenario, type OrbitOutcome } from "./OrbitObjectives";
import type {
  BurnDirection,
  ManeuverNode,
  OrbitScenario,
  OrbitalElements,
  RelativeState,
} from "./types";

export interface OrbitOpsState {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly lm: LunarFlightState;
  readonly target: LunarFlightState | null;
  readonly node: ManeuverNode | null;
  readonly burning: boolean;
  readonly burnRemainingDeltaVMps: number;
  readonly burnAchievedDeltaVMps: number;
  readonly burnDirection: BurnDirection;
  readonly burnStartTimeUs: number | null;
  readonly burnCount: number;
  readonly plannedDeltaVMps: number;
  readonly totalDeltaVMps: number;
  readonly attitudeErrorAccumRad: number;
  readonly attitudeSamples: number;
  readonly bestRangeM: number | null;
  readonly outcome: OrbitOutcome;
  readonly propellantInitialKg: number;
  /** Elements captured immediately before the first burn, for the debrief. */
  readonly elementsBeforeFirstBurn: OrbitalElements | null;
}

export interface OrbitOpsDerived {
  readonly elements: OrbitalElements;
  readonly targetElements: OrbitalElements | null;
  readonly relative: RelativeState | null;
}

export function parametersForScenario(
  scenario: Readonly<OrbitScenario>,
): LunarFlightParameters {
  return parametersForPropulsion(scenario.propulsion);
}

export function createOrbitOpsState(
  scenario: Readonly<OrbitScenario>,
): OrbitOpsState {
  const parameters = parametersForScenario(scenario);
  const lm = createOrbitVehicleState(
    scenario.startingState,
    scenario.propellantKg,
    scenario.rcsPropellantKg,
    parameters,
  );
  const target =
    scenario.targetVehicleState === null
      ? null
      : createOrbitVehicleState(
          scenario.targetVehicleState,
          0,
          0,
          PASSIVE_TARGET_PARAMETERS,
        );

  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    lm,
    target,
    node: null,
    burning: false,
    burnRemainingDeltaVMps: 0,
    burnAchievedDeltaVMps: 0,
    burnDirection: "prograde",
    burnStartTimeUs: null,
    burnCount: 0,
    plannedDeltaVMps: 0,
    totalDeltaVMps: 0,
    attitudeErrorAccumRad: 0,
    attitudeSamples: 0,
    bestRangeM: null,
    outcome: "in-progress",
    propellantInitialKg: scenario.propellantKg,
    elementsBeforeFirstBurn: null,
  };
}

export function deriveOrbitOps(
  state: Readonly<OrbitOpsState>,
  parameters: Readonly<LunarFlightParameters>,
): OrbitOpsDerived {
  const opts = {
    gravitationalParameterM3S2:
      parameters.environment.gravitationalParameterM3S2.value,
    referenceRadiusM: parameters.terrain.meanRadiusM,
  };
  return {
    elements: elementsForState(state.lm, opts),
    targetElements: state.target ? elementsForState(state.target, opts) : null,
    relative: state.target ? relativeState(state.lm, state.target) : null,
  };
}

export function setManeuverNode(
  state: Readonly<OrbitOpsState>,
  node: ManeuverNode | null,
): OrbitOpsState {
  return { ...state, node };
}

/** Arm the finite burn. Planned delta-v is never added to velocity here. */
export function startBurn(
  state: Readonly<OrbitOpsState>,
  scenario: Readonly<OrbitScenario>,
  parameters: Readonly<LunarFlightParameters>,
): OrbitOpsState {
  if (state.burning) return state;
  const node = state.node;
  if (node === null || node.deltaVMps <= 0) return state;
  if (state.lm.ascentPropellantKg <= 0) return state;
  if (state.outcome !== "in-progress" && !scenario.sandbox) return state;
  return {
    ...state,
    burning: true,
    burnDirection: node.direction,
    burnRemainingDeltaVMps: node.deltaVMps,
    burnAchievedDeltaVMps: 0,
    burnStartTimeUs: state.lm.missionTimeUs,
    burnCount: state.burnCount + 1,
    plannedDeltaVMps: state.plannedDeltaVMps + node.deltaVMps,
    elementsBeforeFirstBurn:
      state.elementsBeforeFirstBurn ??
      elementsForState(state.lm, {
        gravitationalParameterM3S2:
          parameters.environment.gravitationalParameterM3S2.value,
        referenceRadiusM: parameters.terrain.meanRadiusM,
      }),
  };
}

export function stopBurn(state: Readonly<OrbitOpsState>): OrbitOpsState {
  if (!state.burning) return state;
  return { ...state, burning: false, burnRemainingDeltaVMps: 0 };
}

/**
 * Advance both vehicles by `dtUs`. The LM burns only while `burning` is set,
 * and always through the kernel's propulsion model.
 */
export function stepOrbitOps(
  state: Readonly<OrbitOpsState>,
  scenario: Readonly<OrbitScenario>,
  dtUs: number,
  parameters: Readonly<LunarFlightParameters>,
): OrbitOpsState {
  if (!Number.isFinite(dtUs) || dtUs <= 0) return state;
  const substepUs = parameters.integration.substepUs;
  const substeps = Math.trunc(dtUs / substepUs);
  if (substeps <= 0) return state;

  let lm = state.lm;
  let target = state.target;
  let burning = state.burning;
  let remaining = state.burnRemainingDeltaVMps;
  let achieved = state.burnAchievedDeltaVMps;
  let total = state.totalDeltaVMps;
  let attitudeAccum = state.attitudeErrorAccumRad;
  let attitudeSamples = state.attitudeSamples;
  let best = state.bestRangeM;

  const ve = exhaustVelocityMps(parameters);

  for (let i = 0; i < substeps; i++) {
    if (lm.terminalState !== null) break;

    if (burning && remaining > 0 && lm.ascentPropellantKg > 0) {
      const desired = attitudeForDirection(lm, state.burnDirection);
      attitudeAccum += Math.abs(angleDelta(lm.attitudeRad, desired));
      attitudeSamples += 1;
      const aligned: LunarFlightState = { ...lm, attitudeRad: desired };
      const input: LunarControlInput = {
        throttle: 1,
        engineCommand: "ascent",
        attitudeCommand: 0,
        stageSeparation: false,
      };
      const m0 = totalMassKg(aligned);
      lm = stepLunarFlight(aligned, input, substepUs, parameters);
      const m1 = totalMassKg(lm);
      if (m1 > 0 && m0 > m1) {
        const dv = ve * Math.log(m0 / m1);
        remaining -= dv;
        achieved += dv;
        total += dv;
      }
      if (remaining <= 0 || lm.ascentPropellantKg <= 0) {
        burning = false;
        remaining = 0;
      }
    } else {
      if (burning) {
        burning = false;
        remaining = 0;
      }
      lm = stepLunarFlight(lm, COAST_CONTROL, substepUs, parameters);
    }

    if (target !== null) {
      target = stepLunarFlight(
        target,
        COAST_CONTROL,
        substepUs,
        PASSIVE_TARGET_PARAMETERS,
      );
      const range = Math.hypot(
        target.positionM[0] - lm.positionM[0],
        target.positionM[1] - lm.positionM[1],
      );
      if (best === null || range < best) best = range;
    }
  }

  const next: OrbitOpsState = {
    ...state,
    lm,
    target,
    burning,
    burnRemainingDeltaVMps: remaining,
    burnAchievedDeltaVMps: achieved,
    totalDeltaVMps: total,
    attitudeErrorAccumRad: attitudeAccum,
    attitudeSamples,
    bestRangeM: best,
  };

  const derived = deriveOrbitOps(next, parameters);
  const evaluation = evaluateOrbitScenario(
    scenario,
    next.lm,
    derived.elements,
    derived.relative,
    derived.targetElements,
  );

  // Terminal outcomes latch; sandboxes never latch success.
  const outcome =
    state.outcome !== "in-progress" ? state.outcome : evaluation.outcome;
  return outcome === next.outcome ? next : { ...next, outcome };
}

export function meanAttitudeErrorRad(state: Readonly<OrbitOpsState>): number {
  return state.attitudeSamples > 0
    ? state.attitudeErrorAccumRad / state.attitudeSamples
    : 0;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// -----------------------------------------------------------------------------
// Time-acceleration guards
// -----------------------------------------------------------------------------

export const ORBIT_TIME_SCALES = [0, 1, 2, 5, 10, 25, 50, 100] as const;

export interface TimeScaleGuard {
  readonly maxScale: number;
  readonly reason: string | null;
}

/**
 * Time acceleration must never skip a required player action. The guard caps
 * the scale during a burn, close to a planned node, near predicted impact and
 * near the intercept threshold.
 */
export function timeScaleGuard(
  state: Readonly<OrbitOpsState>,
  derived: Readonly<OrbitOpsDerived>,
  options: {
    readonly interceptRangeM: number;
    readonly impactWarningS?: number;
  },
): TimeScaleGuard {
  if (state.burning) {
    return { maxScale: 1, reason: "Burn in progress — real time only." };
  }
  if (state.node !== null) {
    const dtS = (state.node.ignitionTimeUs - state.lm.missionTimeUs) / 1_000_000;
    if (dtS >= 0 && dtS <= 120) {
      return {
        maxScale: dtS <= 30 ? 1 : 5,
        reason: "Approaching the planned manoeuvre node.",
      };
    }
  }
  const el = derived.elements;
  if (el.valid && el.periapsisAltitudeM < 0) {
    const warn = options.impactWarningS ?? 180;
    const t = el.timeToPeriapsisS;
    if (t !== null && t <= warn) {
      return { maxScale: 2, reason: "Predicted surface impact ahead." };
    }
    return { maxScale: 10, reason: "Impact trajectory — time limited." };
  }
  if (derived.relative && derived.relative.rangeM <= options.interceptRangeM * 3) {
    return { maxScale: 2, reason: "Near the intercept threshold." };
  }
  return { maxScale: Number.POSITIVE_INFINITY, reason: null };
}

export function clampTimeScale(
  requested: number,
  guard: TimeScaleGuard,
): number {
  if (requested <= 0) return 0;
  return Math.min(requested, guard.maxScale);
}
