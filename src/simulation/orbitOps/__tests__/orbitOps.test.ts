// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Pure acceptance tests for the lunar orbital-operations layer.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
} from "@/simulation/lunar2d/LunarMissionConstants";
import {
  CIRCULAR_TOLERANCE_M,
  IMPACT_TRAJECTORY_LABEL,
  INTERCEPT_RANGE_M,
  ORBIT_SCENARIOS,
  ORBIT_SCENARIO_IDS,
  ORBIT_OPS_VALUES,
  SAFE_PERIAPSIS_M,
  availableDeltaVMps,
  circularSpeedMps,
  clampTimeScale,
  createOrbitOpsState,
  createOrbitVehicleState,
  deriveOrbitOps,
  deriveOrbitalElements,
  describePeriapsis,
  elementsForState,
  executeFiniteBurn,
  getOrbitScenario,
  importTrace,
  meanAttitudeErrorRad,
  parametersForScenario,
  planPhasingBurn,
  predictAfterDeltaV,
  predictSurfaceImpact,
  previewImpulsive,
  propagatePassive,
  relativeState,
  sampleConic,
  scoreOrbitOperations,
  serializeTrace,
  setManeuverNode,
  solveCircularize,
  solveRaisePeriapsis,
  startBurn,
  stepOrbitOps,
  timeScaleGuard,
  traceChecksum,
  visVivaSpeedMps,
  wrapPi,
  createOrbitTrace,
  appendTraceEvent,
  buildOrbitDebrief,
  evaluateOrbitScenario,
  type OrbitOpsState,
  type OrbitScenario,
} from "@/simulation/orbitOps";

const MU = DEFAULT_LUNAR_FLIGHT_PARAMETERS.environment.gravitationalParameterM3S2.value;
const R = DEFAULT_LUNAR_FLIGHT_PARAMETERS.terrain.meanRadiusM;
const TWO_PI = Math.PI * 2;

function circularState(altitudeM: number) {
  const r = R + altitudeM;
  const v = Math.sqrt(MU / r);
  return { position: [r, 0] as [number, number], velocity: [0, v] as [number, number] };
}

// -----------------------------------------------------------------------------
// Orbital elements
// -----------------------------------------------------------------------------

describe("orbital-element derivation", () => {
  it("derives a circular orbit", () => {
    const { position, velocity } = circularState(100_000);
    const el = deriveOrbitalElements(position, velocity);
    expect(el.valid).toBe(true);
    expect(el.shape).toBe("circular");
    expect(el.eccentricity).toBeLessThan(1e-6);
    expect(el.periapsisAltitudeM).toBeCloseTo(100_000, 0);
    expect(el.apoapsisAltitudeM).toBeCloseTo(100_000, 0);
    expect(el.radialSpeedMps).toBeCloseTo(0, 6);
    expect(el.tangentialSpeedMps).toBeCloseTo(el.speedMps, 6);
    expect(el.flightPathAngleRad).toBeCloseTo(0, 9);
  });

  it("matches the analytic period for a circular orbit", () => {
    const r = R + 100_000;
    const el = deriveOrbitalElements([r, 0], [0, Math.sqrt(MU / r)]);
    const expected = TWO_PI * Math.sqrt((r * r * r) / MU);
    expect(el.orbitalPeriodS).toBeCloseTo(expected, 3);
  });

  it("derives an elliptical orbit from its periapsis", () => {
    const rp = R + 20_000;
    const ra = R + 120_000;
    const a = (rp + ra) / 2;
    const v = visVivaSpeedMps(rp, a, MU);
    const el = deriveOrbitalElements([rp, 0], [0, v]);
    expect(el.shape).toBe("elliptical");
    expect(el.periapsisAltitudeM).toBeCloseTo(20_000, 0);
    expect(el.apoapsisAltitudeM).toBeCloseTo(120_000, 0);
    expect(el.eccentricity).toBeGreaterThan(0.02);
    expect(el.timeToPeriapsisS).toBeCloseTo(0, 0);
    expect(el.timeToApoapsisS).toBeCloseTo((el.orbitalPeriodS ?? 0) / 2, 0);
  });

  it("classifies a surface-intersecting trajectory as suborbital", () => {
    const ra = R + 100_000;
    const rp = R - 10_000;
    const a = (rp + ra) / 2;
    const v = visVivaSpeedMps(ra, a, MU);
    const el = deriveOrbitalElements([ra, 0], [0, v]);
    expect(el.shape).toBe("suborbital");
    expect(el.impactTrajectory).toBe(true);
    expect(el.periapsisAltitudeM).toBeLessThan(0);
    expect(describePeriapsis(el)).toBe(IMPACT_TRAJECTORY_LABEL);
  });

  it("never presents a negative periapsis as a safe altitude", () => {
    const el = deriveOrbitalElements([R + 50_000, 0], [0, 900]);
    if (el.periapsisAltitudeM < 0) {
      expect(describePeriapsis(el)).toBe(IMPACT_TRAJECTORY_LABEL);
    }
  });

  it("returns an invalid record for degenerate input", () => {
    expect(deriveOrbitalElements([0, 0], [0, 0]).valid).toBe(false);
    expect(deriveOrbitalElements([NaN, 0], [0, 1]).valid).toBe(false);
    expect(deriveOrbitalElements([R, 0], [0, Infinity]).valid).toBe(false);
  });

  it("classifies escape trajectories", () => {
    const r = R + 100_000;
    const el = deriveOrbitalElements([r, 0], [0, Math.sqrt((2 * MU) / r) * 1.1]);
    expect(el.shape).toBe("escape");
    expect(el.apoapsisAltitudeM).toBeNull();
    expect(el.orbitalPeriodS).toBeNull();
  });

  it("reports radial and tangential velocity separately", () => {
    const r = R + 50_000;
    const el = deriveOrbitalElements([r, 0], [120, 1600]);
    expect(el.radialSpeedMps).toBeCloseTo(120, 6);
    expect(el.tangentialSpeedMps).toBeCloseTo(1600, 6);
    expect(el.flightPathAngleRad).toBeGreaterThan(0);
  });

  it("wraps phase angles into (-pi, pi]", () => {
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapPi(-3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapPi(0.3)).toBeCloseTo(0.3, 12);
    expect(wrapPi(TWO_PI + 0.25)).toBeCloseTo(0.25, 9);
  });

  it("predicts surface impact on a descending suborbital arc", () => {
    const ra = R + 100_000;
    const rp = R - 20_000;
    const a = (rp + ra) / 2;
    const v = visVivaSpeedMps(ra, a, MU);
    const el = deriveOrbitalElements([ra, 0], [0, v]);
    const impact = predictSurfaceImpact(el);
    expect(impact.willImpact).toBe(true);
    expect(impact.timeToImpactS).not.toBeNull();
    expect(impact.timeToImpactS!).toBeGreaterThan(0);
    expect(impact.timeToImpactS!).toBeLessThan((el.orbitalPeriodS ?? 0) / 2 + 1);
  });

  it("samples a closed conic for a bound orbit", () => {
    const el = deriveOrbitalElements(...Object.values(circularState(80_000)) as [
      [number, number],
      [number, number],
    ]);
    const pts = sampleConic(el, 90);
    expect(pts.length).toBeGreaterThan(80);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(R + 80_000, -1);
    }
  });
});

// -----------------------------------------------------------------------------
// Relative motion
// -----------------------------------------------------------------------------

describe("relative motion", () => {
  const params = DEFAULT_LUNAR_FLIGHT_PARAMETERS;

  it("computes range, range rate and phase against a passive target", () => {
    const lm = createOrbitVehicleState(
      { periapsisAltitudeM: 80_000, apoapsisAltitudeM: 80_000, centralAngleRad: 0, startAtPeriapsis: true },
      100,
      50,
      params,
    );
    const target = createOrbitVehicleState(
      { periapsisAltitudeM: 111_120, apoapsisAltitudeM: 111_120, centralAngleRad: 0.2, startAtPeriapsis: true },
      0,
      0,
      params,
    );
    const rel = relativeState(lm, target);
    expect(rel.rangeM).toBeGreaterThan(0);
    expect(rel.phaseAngleRad).toBeCloseTo(0.2, 6);
    expect(Number.isFinite(rel.rangeRateMps)).toBe(true);
    expect(rel.closestApproachM).toBeLessThanOrEqual(rel.rangeM + 1);
    expect(rel.timeToClosestApproachS).toBeGreaterThanOrEqual(0);
  });

  it("reports zero range for coincident vehicles", () => {
    const s = createOrbitVehicleState(
      { periapsisAltitudeM: 80_000, apoapsisAltitudeM: 80_000, centralAngleRad: 0, startAtPeriapsis: true },
      0,
      0,
      params,
    );
    const rel = relativeState(s, s);
    expect(rel.rangeM).toBe(0);
    expect(rel.rangeRateMps).toBe(0);
    expect(rel.phaseAngleRad).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Manoeuvre prediction and finite burns
// -----------------------------------------------------------------------------

describe("maneuver prediction", () => {
  const scenario = getOrbitScenario("circularization-trainer");
  const params = parametersForScenario(scenario);

  it("a prograde burn at periapsis raises apoapsis", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const before = elementsForState(st);
    const after = predictAfterDeltaV(st.positionM, st.velocityMps, [0, 20], params);
    expect(after.apoapsisAltitudeM!).toBeGreaterThan(before.apoapsisAltitudeM!);
    expect(after.periapsisAltitudeM).toBeCloseTo(before.periapsisAltitudeM, -1);
  });

  it("a retrograde burn at periapsis lowers apoapsis", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const before = elementsForState(st);
    const after = predictAfterDeltaV(st.positionM, st.velocityMps, [0, -20], params);
    expect(after.apoapsisAltitudeM!).toBeLessThan(before.apoapsisAltitudeM!);
  });

  it("a radial burn mostly rotates the ellipse", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const before = elementsForState(st);
    const after = predictAfterDeltaV(st.positionM, st.velocityMps, [20, 0], params);
    expect(Math.abs(after.argumentOfPeriapsisRad - before.argumentOfPeriapsisRad)).toBeGreaterThan(1e-3);
    expect(after.semiMajorAxisM!).toBeGreaterThan(before.semiMajorAxisM! * 0.99);
  });

  it("labels every impulsive preview as an educational approximation", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const preview = previewImpulsive(
      st,
      { ignitionTimeUs: 0, direction: "prograde", deltaVMps: 10 },
      params,
    );
    expect(preview.label).toBe("IMPULSIVE MANEUVER PREVIEW");
    expect(preview.note).toBe("EDUCATIONAL PLANNING APPROXIMATION");
    expect(preview.estimatedPropellantKg).toBeGreaterThan(0);
    expect(preview.estimatedBurnSeconds).toBeGreaterThan(0);
    expect(preview.affordable).toBe(true);
  });

  it("flags an unaffordable plan", () => {
    const st = createOrbitVehicleState(scenario.startingState, 5, 5, params);
    const preview = previewImpulsive(
      st,
      { ignitionTimeUs: 0, direction: "prograde", deltaVMps: 500 },
      params,
    );
    expect(preview.affordable).toBe(false);
  });

  it("guides a circularization solution at the correct apsis", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const solution = solveCircularize(st, params);
    expect(solution.node.deltaVMps).toBeGreaterThan(0);
    // Starting at periapsis on an ellipse, apoapsis comes first.
    expect(solution.node.direction).toBe("prograde");
    expect(solution.node.ignitionTimeUs).toBeGreaterThan(st.missionTimeUs);
  });
});

describe("finite burn model", () => {
  const scenario = getOrbitScenario("circularization-trainer");
  const params = parametersForScenario(scenario);

  it("consumes propellant and reaches the commanded delta-v", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const result = executeFiniteBurn(st, "prograde", 15, params);
    expect(result.completed).toBe(true);
    expect(result.achievedDeltaVMps).toBeGreaterThanOrEqual(15);
    expect(result.propellantUsedKg).toBeGreaterThan(0);
    expect(result.state.ascentPropellantKg).toBeLessThan(st.ascentPropellantKg);
    expect(result.burnSeconds).toBeGreaterThan(0);
  });

  it("fails cleanly when there is not enough propellant", () => {
    const st = createOrbitVehicleState(scenario.startingState, 3, 5, params);
    const result = executeFiniteBurn(st, "prograde", 400, params);
    expect(result.completed).toBe(false);
    expect(result.ranOutOfPropellant).toBe(true);
    expect(result.state.ascentPropellantKg).toBe(0);
  });

  it("stays close to the impulsive preview for a small burn", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const preview = previewImpulsive(
      st,
      { ignitionTimeUs: 0, direction: "prograde", deltaVMps: 10 },
      params,
    );
    const flown = executeFiniteBurn(st, "prograde", 10, params);
    const after = elementsForState(flown.state);
    const predicted = preview.after.apoapsisAltitudeM!;
    // Finite burns lose a little to steering and to orbital motion during the
    // burn; the two must agree to within a few percent for a small manoeuvre.
    expect(Math.abs(after.apoapsisAltitudeM! - predicted) / predicted).toBeLessThan(0.05);
  });

  it("is deterministic", () => {
    const st = createOrbitVehicleState(scenario.startingState, 300, 100, params);
    const a = executeFiniteBurn(st, "prograde", 12, params);
    const b = executeFiniteBurn(st, "prograde", 12, params);
    expect(a.state.positionM).toEqual(b.state.positionM);
    expect(a.state.velocityMps).toEqual(b.state.velocityMps);
    expect(a.achievedDeltaVMps).toBe(b.achievedDeltaVMps);
  });
});

// -----------------------------------------------------------------------------
// Phasing planner
// -----------------------------------------------------------------------------

describe("phasing planner", () => {
  const req = {
    burnRadiusM: R + 85_000,
    burnSpeedMps: circularSpeedMps(R + 85_000, MU),
    targetPeriodS:
      TWO_PI * Math.sqrt(Math.pow(R + 111_120, 3) / MU),
    targetRadiusM: R + 111_120,
    phaseAtBurnRad: 1.05,
    availableDeltaVMps: 60,
    referenceRadiusM: R,
  };

  it("finds a bounded recommendation", () => {
    const plan = planPhasingBurn(req);
    expect(plan.found).toBe(true);
    expect(plan.deltaVMps).toBeGreaterThanOrEqual(0);
    expect(plan.deltaVMps).toBeLessThanOrEqual(60);
    expect(plan.revolutions).toBeGreaterThanOrEqual(1);
    expect(plan.phasingPeriodS).toBeGreaterThan(0);
    expect(Math.abs(plan.predictedPhaseRad)).toBeLessThan(Math.abs(req.phaseAtBurnRad));
  });

  it("is deterministic for identical input", () => {
    expect(planPhasingBurn(req)).toEqual(planPhasingBurn(req));
  });

  it("returns no solution without delta-v", () => {
    const plan = planPhasingBurn({ ...req, availableDeltaVMps: 0 });
    expect(plan.found).toBe(false);
    expect(plan.confidence).toBe("none");
  });

  it("never recommends a surface-intersecting phasing orbit", () => {
    const plan = planPhasingBurn({ ...req, availableDeltaVMps: 400, safePeriapsisAltitudeM: 15_000 });
    if (plan.found) {
      const a = Math.pow(
        (plan.phasingPeriodS / TWO_PI) ** 2 * MU,
        1 / 3,
      );
      const other = 2 * a - req.burnRadiusM;
      expect(Math.min(req.burnRadiusM, other)).toBeGreaterThanOrEqual(R + 15_000 - 1);
    }
  });
});

// -----------------------------------------------------------------------------
// Runtime, target propagation, time-scale guards
// -----------------------------------------------------------------------------

function advance(
  state: OrbitOpsState,
  scenario: OrbitScenario,
  seconds: number,
): OrbitOpsState {
  const params = parametersForScenario(scenario);
  let s = state;
  const chunk = 1_000_000;
  for (let t = 0; t < seconds; t += 1) {
    s = stepOrbitOps(s, scenario, chunk, params);
  }
  return s;
}

describe("orbital-operations runtime", () => {
  it("propagates the passive target deterministically", () => {
    const scenario = getOrbitScenario("phasing-burn-trainer");
    const a = advance(createOrbitOpsState(scenario), scenario, 600);
    const b = advance(createOrbitOpsState(scenario), scenario, 600);
    expect(a.target!.positionM).toEqual(b.target!.positionM);
    expect(a.target!.velocityMps).toEqual(b.target!.velocityMps);
    // The target's own orbit must be preserved: it never burns.
    const el = elementsForState(a.target!);
    expect(el.eccentricity).toBeLessThan(1e-3);
    expect(a.target!.ascentPropellantKg).toBe(0);
  });

  it("propagatePassive matches the runtime target propagation", () => {
    const scenario = getOrbitScenario("phasing-burn-trainer");
    const s0 = createOrbitOpsState(scenario);
    const stepped = advance(s0, scenario, 10);
    let manual = s0.target!;
    for (let i = 0; i < 10; i++) manual = propagatePassive(manual, 1_000_000);
    expect(stepped.target!.positionM).toEqual(manual.positionM);
  });

  it("rescues a dangerously low periapsis with a planned finite burn", () => {
    const scenario = getOrbitScenario("save-the-periapsis");
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    const before = elementsForState(s.lm);
    expect(before.periapsisAltitudeM).toBeLessThan(0);

    const solution = solveRaisePeriapsis(s.lm, SAFE_PERIAPSIS_M + 10_000, params);
    s = setManeuverNode(s, solution.node);
    s = startBurn(s, scenario, params);
    expect(s.burning).toBe(true);
    s = advance(s, scenario, 400);

    const after = elementsForState(s.lm);
    expect(after.periapsisAltitudeM).toBeGreaterThan(SAFE_PERIAPSIS_M);
    expect(s.outcome).toBe("objectives-met");
    expect(s.lm.terminalState).toBeNull();
  });

  it("impacts the surface when the periapsis rescue is never flown", () => {
    const scenario = getOrbitScenario("save-the-periapsis");
    const s = advance(createOrbitOpsState(scenario), scenario, 4000);
    expect(s.outcome).toBe("surface-impact");
  });

  it("circularizes an elliptical orbit", () => {
    const scenario = getOrbitScenario("circularization-trainer");
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    const solution = solveCircularize(s.lm, params);
    // Coast to the node, then burn.
    const coastS = Math.max(
      0,
      (solution.node.ignitionTimeUs - s.lm.missionTimeUs) / 1_000_000 -
        0.5 * estimateBurnSeconds(s, solution.node.deltaVMps),
    );
    s = advance(s, scenario, Math.round(coastS));
    const fresh = solveCircularize(s.lm, params);
    s = setManeuverNode(s, { ...fresh.node, ignitionTimeUs: s.lm.missionTimeUs });
    s = startBurn(s, scenario, params);
    s = advance(s, scenario, 200);
    const el = elementsForState(s.lm);
    expect(Math.abs(el.apoapsisAltitudeM! - el.periapsisAltitudeM)).toBeLessThan(
      CIRCULAR_TOLERANCE_M,
    );
    expect(s.outcome).toBe("objectives-met");
  });

  it("changes the orbital period with a phasing burn and closes the phase", () => {
    const scenario = getOrbitScenario("phasing-burn-trainer");
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    const before = elementsForState(s.lm);
    const relBefore = relativeState(s.lm, s.target!);

    s = setManeuverNode(s, {
      ignitionTimeUs: s.lm.missionTimeUs,
      direction: "prograde",
      deltaVMps: 12,
    });
    s = startBurn(s, scenario, params);
    s = advance(s, scenario, 120);

    const after = elementsForState(s.lm);
    expect(after.orbitalPeriodS!).toBeGreaterThan(before.orbitalPeriodS!);
    expect(s.totalDeltaVMps).toBeGreaterThan(10);
    // The phase relationship must actually evolve.
    s = advance(s, scenario, 1200);
    const relAfter = relativeState(s.lm, s.target!);
    expect(relAfter.phaseAngleRad).not.toBeCloseTo(relBefore.phaseAngleRad, 3);
    expect(s.bestRangeM).not.toBeNull();
  });

  it("reports insufficient propellant as a failure outcome", () => {
    const base = getOrbitScenario("save-the-periapsis");
    const scenario: OrbitScenario = { ...base, propellantKg: 1 };
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    s = setManeuverNode(s, {
      ignitionTimeUs: s.lm.missionTimeUs,
      direction: "prograde",
      deltaVMps: 500,
    });
    s = startBurn(s, scenario, params);
    s = advance(s, scenario, 60);
    expect(s.lm.ascentPropellantKg).toBe(0);
    expect(s.outcome).toBe("propellant-exhausted");
  });

  it("does not overburn past the commanded delta-v", () => {
    const scenario = getOrbitScenario("circularization-trainer");
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    s = setManeuverNode(s, {
      ignitionTimeUs: 0,
      direction: "prograde",
      deltaVMps: 8,
    });
    s = startBurn(s, scenario, params);
    s = advance(s, scenario, 300);
    expect(s.burning).toBe(false);
    expect(s.burnAchievedDeltaVMps).toBeGreaterThanOrEqual(8);
    expect(s.burnAchievedDeltaVMps).toBeLessThan(8.5);
  });

  it("guards time acceleration", () => {
    const scenario = getOrbitScenario("save-the-periapsis");
    const params = parametersForScenario(scenario);
    let s = createOrbitOpsState(scenario);
    const derived = deriveOrbitOps(s, params);
    const impactGuard = timeScaleGuard(s, derived, { interceptRangeM: INTERCEPT_RANGE_M });
    expect(impactGuard.maxScale).toBeLessThanOrEqual(10);
    expect(clampTimeScale(100, impactGuard)).toBeLessThanOrEqual(10);
    expect(clampTimeScale(0, impactGuard)).toBe(0);

    s = setManeuverNode(s, {
      ignitionTimeUs: s.lm.missionTimeUs + 10_000_000,
      direction: "prograde",
      deltaVMps: 20,
    });
    const nodeGuard = timeScaleGuard(s, derived, { interceptRangeM: INTERCEPT_RANGE_M });
    expect(nodeGuard.maxScale).toBe(1);

    s = startBurn(s, scenario, params);
    const burnGuard = timeScaleGuard(s, derived, { interceptRangeM: INTERCEPT_RANGE_M });
    expect(burnGuard.maxScale).toBe(1);
    expect(clampTimeScale(50, burnGuard)).toBe(1);
  });

  it("produces identical runs for identical inputs", () => {
    const scenario = getOrbitScenario("orbit-fundamentals");
    const params = parametersForScenario(scenario);
    const run = () => {
      let s = createOrbitOpsState(scenario);
      s = setManeuverNode(s, { ignitionTimeUs: 0, direction: "prograde", deltaVMps: 5 });
      s = startBurn(s, scenario, params);
      return advance(s, scenario, 300);
    };
    const a = run();
    const b = run();
    expect(a.lm).toEqual(b.lm);
    expect(a.totalDeltaVMps).toBe(b.totalDeltaVMps);
    expect(meanAttitudeErrorRad(a)).toBe(meanAttitudeErrorRad(b));
  });
});

function estimateBurnSeconds(state: OrbitOpsState, dv: number): number {
  void state;
  return dv;
}

// -----------------------------------------------------------------------------
// Scenario registry, scoring, trace
// -----------------------------------------------------------------------------

describe("scenario registry", () => {
  it("declares every required field for every scenario", () => {
    expect(ORBIT_SCENARIO_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of ORBIT_SCENARIO_IDS) {
      const s = ORBIT_SCENARIOS[id];
      expect(s.version).toBeGreaterThanOrEqual(1);
      expect(s.objectives.length).toBeGreaterThan(0);
      expect(s.successConditions.length).toBeGreaterThan(0);
      expect(s.failureConditions.length).toBeGreaterThan(0);
      expect(s.availableControls.length).toBeGreaterThan(0);
      expect(s.sourceReferences.length).toBeGreaterThan(0);
      expect(s.fidelityClassification).toBeTruthy();
      expect(Array.isArray(s.gameplayTuning)).toBe(true);
      expect(s.propellantKg).toBeGreaterThan(0);
    }
  });

  it("registers a provenance classification for every value", () => {
    const allowed = new Set([
      "authentic-agc",
      "source-derived",
      "historically-grounded",
      "educational-approximation",
      "gameplay-tuned",
    ]);
    for (const v of ORBIT_OPS_VALUES) {
      expect(allowed.has(v.classification)).toBe(true);
      expect(v.rationale.length).toBeGreaterThan(10);
    }
  });

  it("starts every scenario on the orbit it declares", () => {
    for (const id of ORBIT_SCENARIO_IDS) {
      const scenario = ORBIT_SCENARIOS[id];
      const s = createOrbitOpsState(scenario);
      const el = elementsForState(s.lm);
      expect(el.periapsisAltitudeM).toBeCloseTo(
        scenario.startingState.periapsisAltitudeM,
        -2,
      );
      expect(el.apoapsisAltitudeM!).toBeCloseTo(
        scenario.startingState.apoapsisAltitudeM,
        -2,
      );
    }
  });
});

describe("scoring and debrief", () => {
  const scenario = getOrbitScenario("circularization-trainer");

  it("scores a clean circularization above a failed one", () => {
    const good = createOrbitOpsState(scenario);
    const el = elementsForState(good.lm);
    const record = {
      scenarioId: scenario.id,
      assistance: "commander",
      outcome: "objectives-met" as const,
      elements: el,
      targetElements: null,
      relative: null,
      burnCount: 1,
      totalDeltaVMps: 30,
      plannedDeltaVMps: 30,
      achievedDeltaVMps: 30,
      propellantRemainingKg: 180,
      propellantInitialKg: 220,
      bestRangeM: null,
      burnTimingErrorS: 2,
      attitudeAlignmentErrorRad: 0.01,
      missionTimeS: 900,
    };
    const scored = scoreOrbitOperations(scenario, record);
    const sloppy = scoreOrbitOperations(scenario, {
      ...record,
      burnCount: 5,
      burnTimingErrorS: 200,
      achievedDeltaVMps: 60,
      propellantRemainingKg: 5,
      attitudeAlignmentErrorRad: 0.6,
    });
    expect(scored.total).toBeGreaterThan(sloppy.total);
    expect(scored.maxTotal).toBe(sloppy.maxTotal);
    expect(scored.passed).toBe(true);
  });

  it("explains the manoeuvre in the debrief", () => {
    const s = createOrbitOpsState(scenario);
    const el = elementsForState(s.lm);
    const entries = buildOrbitDebrief(
      scenario,
      {
        scenarioId: scenario.id,
        assistance: "pilot",
        outcome: "objectives-met",
        elements: el,
        targetElements: null,
        relative: null,
        burnCount: 1,
        totalDeltaVMps: 25,
        plannedDeltaVMps: 25,
        achievedDeltaVMps: 25,
        propellantRemainingKg: 100,
        propellantInitialKg: 220,
        bestRangeM: null,
        burnTimingErrorS: 1,
        attitudeAlignmentErrorRad: 0.02,
        missionTimeS: 600,
      },
      el,
    );
    const headings = entries.map((e) => e.heading);
    expect(headings).toContain("What the burn changed");
    expect(headings).toContain("Why the burn location mattered");
    expect(headings).toContain("One recommended correction");
  });

  it("emits the mandated intercept banner and no rendezvous guidance", () => {
    const phasing = getOrbitScenario("phasing-burn-trainer");
    const s = createOrbitOpsState(phasing);
    const params = parametersForScenario(phasing);
    const derived = deriveOrbitOps(s, params);
    // Force a co-located geometry to exercise the terminal banner.
    const closeTarget = { ...s.lm, ascentPropellantKg: 0 };
    const rel = relativeState(s.lm, closeTarget);
    const ev = evaluateOrbitScenario(phasing, s.lm, derived.elements, rel, derived.targetElements);
    expect(ev.interceptReady).toBe(true);
    expect(ev.terminalBanner).toEqual([
      "INTERCEPT SETUP COMPLETE",
      "TERMINAL RENDEZVOUS CONTINUES IN M5.1",
    ]);
  });
});

describe("orbital-operations trace", () => {
  const build = () => {
    let t = createOrbitTrace("phasing-burn-trainer", 1, "pilot");
    t = appendTraceEvent(t, { t: 1_000_000, kind: "time-scale", scale: 10 });
    t = appendTraceEvent(t, {
      t: 2_000_000,
      kind: "node-set",
      ignitionTimeUs: 5_000_000,
      direction: "prograde",
      deltaVMps: 12,
    });
    t = appendTraceEvent(t, { t: 5_000_000, kind: "burn-start" });
    t = appendTraceEvent(t, { t: 5_400_000, kind: "burn-stop" });
    t = appendTraceEvent(t, { t: 9_000_000, kind: "terminal", outcome: "objectives-met" });
    return t;
  };

  it("has a stable checksum", () => {
    expect(traceChecksum(build())).toBe(traceChecksum(build()));
  });

  it("round-trips through export and defensive import", () => {
    const trace = build();
    const result = importTrace(serializeTrace(trace));
    expect(result.ok).toBe(true);
    expect(result.trace).not.toBeNull();
    expect(traceChecksum(result.trace!)).toBe(traceChecksum(trace));
  });

  it("rejects malformed, mismatched and oversized payloads", () => {
    expect(importTrace("not json").error).toBe("not-json");
    expect(importTrace("[]").error).toBe("not-object");
    expect(importTrace(JSON.stringify({ version: 99 })).error).toBe("version-mismatch");
    expect(
      importTrace(
        JSON.stringify({
          version: 1,
          scenarioId: "x",
          scenarioVersion: 1,
          events: [{ t: 0, kind: "node-set", ignitionTimeUs: 0, direction: "sideways", deltaVMps: 1 }],
        }),
      ).error,
    ).toBe("malformed-events");
    const tampered = JSON.parse(serializeTrace(build()));
    tampered.checksum = 12345;
    expect(importTrace(JSON.stringify(tampered)).error).toBe("checksum-mismatch");
  });
});

// -----------------------------------------------------------------------------
// Firewall and frozen-baseline regressions
// -----------------------------------------------------------------------------

describe("physics firewall", () => {
  it("the orbital-operations layer never imports AGC modules", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "src/simulation/orbitOps");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    for (const src of files) {
      expect(src).not.toMatch(/from ["']@\/agc/);
      expect(src).not.toMatch(/from ["']@\/sim\/agc/);
      expect(src).not.toMatch(/simulation\/agcio/);
      expect(src).not.toMatch(/simulation\/agcguidance/);
      expect(src).not.toMatch(/simulation\/agcshadow/);
    }
  });

  it("keeps the frozen 1D golden touchdown untouched", async () => {
    const { runLmScenario } = await import("@/simulation/lm/scenario");
    const { GOLDEN_COMMANDS, GOLDEN_INITIAL_STATE } = await import(
      "@/simulation/lm/__tests__/goldenScenario"
    );
    const result = runLmScenario(GOLDEN_INITIAL_STATE, GOLDEN_COMMANDS, 600_000_000);
    expect(result.finalState.touchdown?.simulationTimeUs).toBe(368_279_425);
  });

  it("available delta-v is a pure function of mass and propellant", () => {
    const scenario = getOrbitScenario("orbit-fundamentals");
    const params = parametersForScenario(scenario);
    const st = createOrbitVehicleState(scenario.startingState, 600, 120, params);
    expect(availableDeltaVMps(st, params)).toBeCloseTo(
      availableDeltaVMps(st, params),
      12,
    );
    expect(availableDeltaVMps({ ...st, ascentPropellantKg: 0 }, params)).toBe(0);
  });
});
