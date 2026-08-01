// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Manoeuvre planning.
//
// Two strictly separated concepts live here:
//
//   * IMPULSIVE MANEUVER PREVIEW — an analytical, instantaneous delta-v
//     approximation used only to show the player what a plan would do. It is
//     an EDUCATIONAL PLANNING APPROXIMATION and is always labelled as such.
//   * guided solutions — recommendations. The planner may suggest a manoeuvre;
//     it never executes one. Execution goes through FiniteBurnModel.

import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import type { LunarFlightState } from "@/simulation/lunar2d/types";
import { elementsForState, visVivaSpeedMps } from "./OrbitalElements";
import { predictAfterDeltaV } from "./OrbitPrediction";
import {
  attitudeForDirection,
  availableDeltaVMps,
  burnSecondsForDeltaV,
  propellantForDeltaVKg,
} from "./FiniteBurnModel";
import type {
  BurnDirection,
  ImpulsivePreview,
  ManeuverNode,
  OrbitalElements,
} from "./types";

const TWO_PI = Math.PI * 2;

export function directionUnitVector(
  state: Readonly<LunarFlightState>,
  direction: BurnDirection,
): [number, number] {
  const attitude = attitudeForDirection(state, direction);
  const [px, py] = state.positionM;
  const r = Math.hypot(px, py);
  if (r === 0) return [0, 0];
  const ux = px / r;
  const uy = py / r;
  const ca = Math.cos(attitude);
  const sa = Math.sin(attitude);
  return [ux * ca - uy * sa, uy * ca + ux * sa];
}

export function emptyNode(missionTimeUs: number): ManeuverNode {
  return { ignitionTimeUs: missionTimeUs, direction: "prograde", deltaVMps: 0 };
}

/**
 * Analytical preview of a manoeuvre node executed at the node's ignition time.
 * The vehicle is coasted analytically to the node using the current conic, so
 * this never mutates or integrates the live vehicle.
 */
export function previewImpulsive(
  state: Readonly<LunarFlightState>,
  node: ManeuverNode,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  targetElements: OrbitalElements | null = null,
  coastedState: Readonly<LunarFlightState> = state,
): ImpulsivePreview {
  const before = elementsForState(coastedState, {
    gravitationalParameterM3S2:
      parameters.environment.gravitationalParameterM3S2.value,
    referenceRadiusM: parameters.terrain.meanRadiusM,
  });
  const [ux, uy] = directionUnitVector(coastedState, node.direction);
  const dv = Math.max(0, node.deltaVMps);
  const after = predictAfterDeltaV(
    coastedState.positionM,
    coastedState.velocityMps,
    [ux * dv, uy * dv],
    parameters,
  );

  const estimatedPropellantKg = propellantForDeltaVKg(coastedState, dv, parameters);
  const estimatedBurnSeconds = burnSecondsForDeltaV(coastedState, dv, parameters);
  const affordable = estimatedPropellantKg <= coastedState.ascentPropellantKg;

  const periodChangeS =
    before.orbitalPeriodS !== null && after.orbitalPeriodS !== null
      ? after.orbitalPeriodS - before.orbitalPeriodS
      : null;

  let phaseChangePerRevRad: number | null = null;
  if (
    targetElements !== null &&
    targetElements.orbitalPeriodS !== null &&
    after.orbitalPeriodS !== null &&
    targetElements.orbitalPeriodS > 0
  ) {
    // Phase gained per LM revolution against the target's mean motion.
    phaseChangePerRevRad =
      TWO_PI * (1 - after.orbitalPeriodS / targetElements.orbitalPeriodS);
  }

  return {
    label: "IMPULSIVE MANEUVER PREVIEW",
    note: "EDUCATIONAL PLANNING APPROXIMATION",
    before,
    after,
    periapsisChangeM: after.periapsisAltitudeM - before.periapsisAltitudeM,
    apoapsisChangeM:
      after.apoapsisAltitudeM !== null && before.apoapsisAltitudeM !== null
        ? after.apoapsisAltitudeM - before.apoapsisAltitudeM
        : null,
    periodChangeS,
    phaseChangePerRevRad,
    estimatedPropellantKg,
    estimatedBurnSeconds,
    affordable,
    impactRisk: after.periapsisAltitudeM < 0,
  };
}

// -----------------------------------------------------------------------------
// Guided solutions — recommendations only
// -----------------------------------------------------------------------------

export interface GuidedSolution {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly node: ManeuverNode;
  /** True when the plan cannot be flown with the propellant on board. */
  readonly unaffordable: boolean;
}

function nodeAtApoapsis(
  elements: OrbitalElements,
  missionTimeUs: number,
  direction: BurnDirection,
  deltaVMps: number,
): ManeuverNode {
  const dt = elements.timeToApoapsisS ?? 0;
  return {
    ignitionTimeUs: Math.round(missionTimeUs + dt * 1_000_000),
    direction,
    deltaVMps,
  };
}

function nodeAtPeriapsis(
  elements: OrbitalElements,
  missionTimeUs: number,
  direction: BurnDirection,
  deltaVMps: number,
): ManeuverNode {
  const dt = elements.timeToPeriapsisS ?? 0;
  return {
    ignitionTimeUs: Math.round(missionTimeUs + dt * 1_000_000),
    direction,
    deltaVMps,
  };
}

/** Prograde burn at apoapsis that raises periapsis to the requested altitude. */
export function solveRaisePeriapsis(
  state: Readonly<LunarFlightState>,
  targetPeriapsisAltitudeM: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): GuidedSolution {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const R = parameters.terrain.meanRadiusM;
  const el = elementsForState(state, {
    gravitationalParameterM3S2: mu,
    referenceRadiusM: R,
  });
  const ra = el.apoapsisRadiusM ?? el.radiusM;
  const rpNew = R + targetPeriapsisAltitudeM;
  const aNew = (ra + Math.min(rpNew, ra)) / 2;
  const vNow = visVivaSpeedMps(ra, el.semiMajorAxisM ?? ra, mu);
  const vNew = visVivaSpeedMps(ra, aNew, mu);
  const dv = Math.max(0, vNew - vNow);
  return {
    id: "raise-periapsis",
    title: "Raise periapsis",
    rationale:
      "Burn prograde at apoapsis. A burn at the high point of the orbit " +
      "raises the opposite side — the low point — for the least delta-v.",
    node: nodeAtApoapsis(el, state.missionTimeUs, "prograde", dv),
    unaffordable: dv > availableDeltaVMps(state, parameters),
  };
}

/** Retrograde burn at periapsis that lowers apoapsis to the requested altitude. */
export function solveLowerApoapsis(
  state: Readonly<LunarFlightState>,
  targetApoapsisAltitudeM: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): GuidedSolution {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const R = parameters.terrain.meanRadiusM;
  const el = elementsForState(state, {
    gravitationalParameterM3S2: mu,
    referenceRadiusM: R,
  });
  const rp = el.periapsisRadiusM;
  const raNew = Math.max(rp, R + targetApoapsisAltitudeM);
  const aNew = (rp + raNew) / 2;
  const vNow = visVivaSpeedMps(rp, el.semiMajorAxisM ?? rp, mu);
  const vNew = visVivaSpeedMps(rp, aNew, mu);
  const dv = Math.max(0, vNow - vNew);
  return {
    id: "lower-apoapsis",
    title: "Lower apoapsis",
    rationale:
      "Burn retrograde at periapsis. Slowing at the low point pulls the high " +
      "point down half an orbit later.",
    node: nodeAtPeriapsis(el, state.missionTimeUs, "retrograde", dv),
    unaffordable: dv > availableDeltaVMps(state, parameters),
  };
}

/** Circularize at apoapsis (prograde) or at periapsis (retrograde). */
export function solveCircularize(
  state: Readonly<LunarFlightState>,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): GuidedSolution {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const R = parameters.terrain.meanRadiusM;
  const el = elementsForState(state, {
    gravitationalParameterM3S2: mu,
    referenceRadiusM: R,
  });
  const a = el.semiMajorAxisM ?? el.radiusM;
  const ra = el.apoapsisRadiusM ?? el.radiusM;
  const rp = el.periapsisRadiusM;
  // Circularize at whichever apsis comes first.
  const toApo = el.timeToApoapsisS ?? Number.POSITIVE_INFINITY;
  const toPeri = el.timeToPeriapsisS ?? Number.POSITIVE_INFINITY;
  const atApoapsis = toApo <= toPeri;
  const r = atApoapsis ? ra : rp;
  const vNow = visVivaSpeedMps(r, a, mu);
  const vCirc = Math.sqrt(mu / r);
  const dv = Math.abs(vCirc - vNow);
  const direction: BurnDirection = vCirc >= vNow ? "prograde" : "retrograde";
  return {
    id: "circularize",
    title: atApoapsis ? "Circularize at apoapsis" : "Circularize at periapsis",
    rationale: atApoapsis
      ? "At apoapsis the vehicle is slower than circular speed. Adding speed " +
        "there lifts the opposite side up to match."
      : "At periapsis the vehicle is faster than circular speed. Removing " +
        "speed there drops the opposite side down to match.",
    node: atApoapsis
      ? nodeAtApoapsis(el, state.missionTimeUs, direction, dv)
      : nodeAtPeriapsis(el, state.missionTimeUs, direction, dv),
    unaffordable: dv > availableDeltaVMps(state, parameters),
  };
}

/** Change the orbital period to `targetPeriodS` with one apsis burn. */
export function solvePeriodChange(
  state: Readonly<LunarFlightState>,
  targetPeriodS: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): GuidedSolution {
  const mu = parameters.environment.gravitationalParameterM3S2.value;
  const R = parameters.terrain.meanRadiusM;
  const el = elementsForState(state, {
    gravitationalParameterM3S2: mu,
    referenceRadiusM: R,
  });
  const aNew = Math.cbrt((mu * targetPeriodS * targetPeriodS) / (4 * Math.PI * Math.PI));
  // Burn at the apsis that comes first, keeping the other apsis fixed.
  const toApo = el.timeToApoapsisS ?? Number.POSITIVE_INFINITY;
  const toPeri = el.timeToPeriapsisS ?? Number.POSITIVE_INFINITY;
  const atApoapsis = toApo <= toPeri;
  const r = atApoapsis ? (el.apoapsisRadiusM ?? el.radiusM) : el.periapsisRadiusM;
  const vNow = visVivaSpeedMps(r, el.semiMajorAxisM ?? r, mu);
  const vNew = visVivaSpeedMps(r, aNew, mu);
  const dv = Math.abs(vNew - vNow);
  const direction: BurnDirection = vNew >= vNow ? "prograde" : "retrograde";
  const longer = targetPeriodS > (el.orbitalPeriodS ?? 0);
  return {
    id: longer ? "increase-period" : "decrease-period",
    title: longer ? "Increase orbital period" : "Decrease orbital period",
    rationale: longer
      ? "A bigger orbit takes longer. Raising the opposite apsis increases " +
        "the semi-major axis and therefore the period."
      : "A smaller orbit comes round sooner. Lowering the opposite apsis " +
        "shortens the semi-major axis and therefore the period.",
    node: atApoapsis
      ? nodeAtApoapsis(el, state.missionTimeUs, direction, dv)
      : nodeAtPeriapsis(el, state.missionTimeUs, direction, dv),
    unaffordable: dv > availableDeltaVMps(state, parameters),
  };
}

/** Return toward a target orbit expressed as periapsis x apoapsis altitudes. */
export function solveReturnToTargetOrbit(
  state: Readonly<LunarFlightState>,
  targetPeriapsisAltitudeM: number,
  targetApoapsisAltitudeM: number,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): GuidedSolution {
  const R = parameters.terrain.meanRadiusM;
  const el = elementsForState(state, {
    gravitationalParameterM3S2:
      parameters.environment.gravitationalParameterM3S2.value,
    referenceRadiusM: R,
  });
  const apoErr =
    el.apoapsisAltitudeM === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(el.apoapsisAltitudeM - targetApoapsisAltitudeM);
  const periErr = Math.abs(el.periapsisAltitudeM - targetPeriapsisAltitudeM);
  const solution =
    periErr >= apoErr
      ? solveRaisePeriapsis(state, targetPeriapsisAltitudeM, parameters)
      : solveLowerApoapsis(state, targetApoapsisAltitudeM, parameters);
  return {
    ...solution,
    id: "return-to-target-orbit",
    title: "Return toward the target orbit",
  };
}

export function listGuidedSolutions(
  state: Readonly<LunarFlightState>,
  options: {
    readonly safePeriapsisAltitudeM: number;
    readonly targetPeriapsisAltitudeM?: number;
    readonly targetApoapsisAltitudeM?: number;
    readonly targetPeriodS?: number | null;
  },
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): readonly GuidedSolution[] {
  const out: GuidedSolution[] = [
    solveRaisePeriapsis(
      state,
      options.targetPeriapsisAltitudeM ?? options.safePeriapsisAltitudeM,
      parameters,
    ),
    solveCircularize(state, parameters),
  ];
  if (options.targetApoapsisAltitudeM !== undefined) {
    out.push(solveLowerApoapsis(state, options.targetApoapsisAltitudeM, parameters));
  }
  if (options.targetPeriodS) {
    out.push(solvePeriodChange(state, options.targetPeriodS, parameters));
    out.push(solvePeriodChange(state, options.targetPeriodS * 0.97, parameters));
  }
  if (
    options.targetPeriapsisAltitudeM !== undefined &&
    options.targetApoapsisAltitudeM !== undefined
  ) {
    out.push(
      solveReturnToTargetOrbit(
        state,
        options.targetPeriapsisAltitudeM,
        options.targetApoapsisAltitudeM,
        parameters,
      ),
    );
  }
  return out;
}
