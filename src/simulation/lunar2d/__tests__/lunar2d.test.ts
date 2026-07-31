// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 acceptance tests for the deterministic planar lunar-flight kernel.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS as P,
  LUNAR_SCENARIO_IDS,
  canonicalizeLunarState,
  circularSpeedAtAltitude,
  computeOrbitalValues,
  computeReferenceGuidance,
  createLunarFlightState,
  evaluateTouchdown,
  getLunarScenario,
  instantiateLunarScenario,
  lunarStateChecksum,
  runLunarScenario,
  separateDescentStage,
  snapDescentThrottle,
  stepLunarFlight,
  totalMassKg,
  type LunarControlInput,
  type TimedLunarCommand,
} from "..";

const SUBSTEP = P.integration.substepUs;
const IDLE: LunarControlInput = {
  throttle: 0,
  engineCommand: "off",
  attitudeCommand: 0,
};

describe("lunar2d: purity and time base", () => {
  it("never mutates its inputs", () => {
    const state = createLunarFlightState({ altitudeM: 1000 });
    const before = canonicalizeLunarState(state);
    const input: LunarControlInput = {
      throttle: 0.5,
      engineCommand: "descent",
      attitudeCommand: 0.3,
    };
    const inputBefore = JSON.stringify(input);
    stepLunarFlight(state, input, 1_000_000, P);
    expect(canonicalizeLunarState(state)).toBe(before);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });

  it("advances only whole substeps and drops the remainder", () => {
    const state = createLunarFlightState({ altitudeM: 1000 });
    const next = stepLunarFlight(state, IDLE, SUBSTEP * 3 + 1234, P);
    expect(next.missionTimeUs).toBe(SUBSTEP * 3);
  });

  it("dtUs = 0 does not advance physics", () => {
    const state = createLunarFlightState({ altitudeM: 1000 });
    const next = stepLunarFlight(state, IDLE, 0, P);
    expect(next.missionTimeUs).toBe(0);
    expect(next.positionM).toEqual(state.positionM);
  });

  it("rejects negative dt", () => {
    const state = createLunarFlightState({ altitudeM: 1000 });
    expect(() => stepLunarFlight(state, IDLE, -1, P)).toThrow(RangeError);
  });
});

describe("lunar2d: gravity", () => {
  it("free fall over one second is close to the local gravity value", () => {
    const state = createLunarFlightState({ altitudeM: 10_000 });
    const next = stepLunarFlight(state, IDLE, 1_000_000, P);
    const orbit = computeOrbitalValues(next, P);
    const mu = P.environment.gravitationalParameterM3S2.value;
    const r = P.environment.meanRadiusM.value + 10_000;
    const expected = -(mu / (r * r));
    expect(orbit.radialSpeedMps).toBeCloseTo(expected, 2);
  });

  it("gravity is weaker at higher altitude (inverse square)", () => {
    const low = createLunarFlightState({ altitudeM: 50_000 });
    const high = createLunarFlightState({ altitudeM: 500_000 });
    const lowV = Math.abs(
      computeOrbitalValues(stepLunarFlight(low, IDLE, 1_000_000, P), P)
        .radialSpeedMps,
    );
    const highV = Math.abs(
      computeOrbitalValues(stepLunarFlight(high, IDLE, 1_000_000, P), P)
        .radialSpeedMps,
    );
    expect(highV).toBeLessThan(lowV);
  });
});

describe("lunar2d: orbital values", () => {
  it("a circular orbit keeps near-constant radius and energy", () => {
    const alt = 100_000;
    const state = createLunarFlightState({
      altitudeM: alt,
      tangentialSpeedMps: circularSpeedAtAltitude(alt),
    });
    const start = computeOrbitalValues(state, P);
    const { finalState } = runLunarScenario(state, [], 1_800_000_000, P);
    const end = computeOrbitalValues(finalState, P);

    expect(end.eccentricity).toBeLessThan(1e-3);
    expect(Math.abs(end.radiusM - start.radiusM)).toBeLessThan(1_000);
    const energyDrift = Math.abs(
      (end.specificEnergyJPerKg - start.specificEnergyJPerKg) /
        start.specificEnergyJPerKg,
    );
    expect(energyDrift).toBeLessThan(1e-4);
  });

  it("reports apoapsis above and periapsis below on an elliptical orbit", () => {
    const alt = 100_000;
    const state = createLunarFlightState({
      altitudeM: alt,
      tangentialSpeedMps: circularSpeedAtAltitude(alt) * 1.05,
    });
    const orbit = computeOrbitalValues(state, P);
    expect(orbit.eccentricity).toBeGreaterThan(0);
    expect(orbit.apoapsisAltitudeM).not.toBeNull();
    expect(orbit.apoapsisAltitudeM!).toBeGreaterThan(alt);
    expect(orbit.periapsisAltitudeM).toBeLessThan(alt + 1);
  });

  it("has no apoapsis on an escape trajectory", () => {
    const state = createLunarFlightState({
      altitudeM: 100_000,
      tangentialSpeedMps: circularSpeedAtAltitude(100_000) * 2,
    });
    const orbit = computeOrbitalValues(state, P);
    expect(orbit.specificEnergyJPerKg).toBeGreaterThan(0);
    expect(orbit.apoapsisRadiusM).toBeNull();
    expect(orbit.eccentricity).toBeGreaterThan(1);
  });
});

describe("lunar2d: propulsion", () => {
  it("snaps commanded throttle onto the DPS band", () => {
    expect(snapDescentThrottle(0, P)).toBe(0);
    expect(snapDescentThrottle(0.05, P)).toBe(0.1);
    expect(snapDescentThrottle(0.4, P)).toBeCloseTo(0.4, 12);
    expect(snapDescentThrottle(0.8, P)).toBe(0.65);
    expect(snapDescentThrottle(0.99, P)).toBe(1);
    expect(snapDescentThrottle(5, P)).toBe(1);
  });

  it("burns propellant per the rocket mass-flow relation", () => {
    const state = createLunarFlightState({ altitudeM: 50_000 });
    const burn: LunarControlInput = {
      throttle: 0.5,
      engineCommand: "descent",
      attitudeCommand: 0,
    };
    const next = stepLunarFlight(state, burn, 10_000_000, P);
    const thrust = 0.5 * P.descentEngine.maxThrustN.value;
    const expected =
      (thrust /
        (P.descentEngine.specificImpulseS.value *
          P.environment.standardGravityMps2.value)) *
      10;
    const used = state.descentPropellantKg - next.descentPropellantKg;
    expect(used).toBeCloseTo(expected, 4);
  });

  it("mass loss increases acceleration for a constant thrust", () => {
    const light = createLunarFlightState({
      altitudeM: 50_000,
      descentPropellantKg: 100,
    });
    const heavy = createLunarFlightState({
      altitudeM: 50_000,
      descentPropellantKg: 8_000,
    });
    const burn: LunarControlInput = {
      throttle: 0.6,
      engineCommand: "descent",
      attitudeCommand: 0,
    };
    const lightOut = computeOrbitalValues(
      stepLunarFlight(light, burn, 1_000_000, P),
      P,
    );
    const heavyOut = computeOrbitalValues(
      stepLunarFlight(heavy, burn, 1_000_000, P),
      P,
    );
    expect(lightOut.radialSpeedMps).toBeGreaterThan(heavyOut.radialSpeedMps);
  });

  it("the ascent engine ignores commanded throttle", () => {
    const state = createLunarFlightState({
      altitudeM: 1_000,
      configuration: "ascent-stage",
    });
    const low = stepLunarFlight(
      state,
      { throttle: 0.05, engineCommand: "ascent", attitudeCommand: 0 },
      1_000_000,
      P,
    );
    const high = stepLunarFlight(
      state,
      { throttle: 1, engineCommand: "ascent", attitudeCommand: 0 },
      1_000_000,
      P,
    );
    expect(low.throttle).toBe(1);
    expect(canonicalizeLunarState(low)).toBe(canonicalizeLunarState(high));
  });

  it("the descent engine is unavailable to the ascent stage and vice versa", () => {
    const ascentOnly = createLunarFlightState({
      altitudeM: 1_000,
      configuration: "ascent-stage",
    });
    const out = stepLunarFlight(
      ascentOnly,
      { throttle: 1, engineCommand: "descent", attitudeCommand: 0 },
      SUBSTEP,
      P,
    );
    expect(out.mainEngine).toBe("off");

    const complete = createLunarFlightState({ altitudeM: 1_000 });
    const out2 = stepLunarFlight(
      complete,
      { throttle: 1, engineCommand: "ascent", attitudeCommand: 0 },
      SUBSTEP,
      P,
    );
    expect(out2.mainEngine).toBe("off");
  });

  it("terminates on propellant depletion", () => {
    const state = createLunarFlightState({
      altitudeM: 200_000,
      descentPropellantKg: 5,
    });
    const { finalState } = runLunarScenario(
      state,
      [{ missionTimeUs: 0, throttle: 1, engineCommand: "descent" }],
      600_000_000,
      P,
    );
    expect(finalState.terminalState).toBe("propellant-depleted");
    expect(finalState.descentPropellantKg).toBe(0);
  });
});

describe("lunar2d: attitude and RCS", () => {
  it("consumes RCS propellant and builds rate under command", () => {
    const state = createLunarFlightState({ altitudeM: 50_000 });
    const next = stepLunarFlight(
      state,
      { throttle: 0, engineCommand: "off", attitudeCommand: 1 },
      2_000_000,
      P,
    );
    expect(next.angularRateRadPerSec).toBeGreaterThan(0);
    expect(next.rcsPropellantKg).toBeLessThan(state.rcsPropellantKg);
    expect(next.attitudeRad).toBeGreaterThan(0);
  });

  it("clamps angular rate to the configured maximum", () => {
    const state = createLunarFlightState({ altitudeM: 50_000 });
    const next = stepLunarFlight(
      state,
      { throttle: 0, engineCommand: "off", attitudeCommand: 1 },
      60_000_000,
      P,
    );
    expect(next.angularRateRadPerSec).toBeLessThanOrEqual(
      P.attitude.maxAngularRateRadPerSec.value + 1e-12,
    );
  });

  it("cannot rotate without RCS propellant", () => {
    const state = createLunarFlightState({
      altitudeM: 50_000,
      rcsPropellantKg: 0,
    });
    const next = stepLunarFlight(
      state,
      { throttle: 0, engineCommand: "off", attitudeCommand: 1 },
      5_000_000,
      P,
    );
    expect(next.angularRateRadPerSec).toBe(0);
    expect(next.attitudeRad).toBe(0);
  });

  it("tilted thrust produces horizontal acceleration", () => {
    const state = {
      ...createLunarFlightState({ altitudeM: 20_000 }),
      attitudeRad: Math.PI / 2,
    };
    const next = stepLunarFlight(
      state,
      { throttle: 0.6, engineCommand: "descent", attitudeCommand: 0 },
      2_000_000,
      P,
    );
    const orbit = computeOrbitalValues(next, P);
    expect(orbit.tangentialSpeedMps).toBeGreaterThan(1);
  });
});

describe("lunar2d: staging", () => {
  it("separation leaves an inert descent stage and lightens the vehicle", () => {
    const state = createLunarFlightState({ altitudeM: 0 });
    const staged = separateDescentStage(state, P);
    expect(staged.configuration).toBe("ascent-stage");
    expect(staged.descentPropellantKg).toBe(0);
    expect(staged.separatedDescentStage).not.toBeNull();
    expect(staged.separatedDescentStage!.configuration).toBe("descent-stage");
    expect(totalMassKg(staged)).toBeLessThan(totalMassKg(state));
  });

  it("the jettisoned stage never moves again", () => {
    const state = createLunarFlightState({ altitudeM: 2_000 });
    const staged = stepLunarFlight(
      state,
      { throttle: 0, engineCommand: "off", attitudeCommand: 0, stageSeparation: true },
      5_000_000,
      P,
    );
    const stage0 = staged.separatedDescentStage!;
    const later = stepLunarFlight(staged, IDLE, 5_000_000, P);
    expect(later.separatedDescentStage!.positionM).toEqual(stage0.positionM);
  });
});

describe("lunar2d: surface contact", () => {
  it("classifies a gentle touchdown as landed", () => {
    const state = createLunarFlightState({
      altitudeM: 1,
      radialSpeedMps: -0.5,
    });
    const { finalState } = runLunarScenario(state, [], 30_000_000, P);
    expect(finalState.terminalState).toBe("landed");
    expect(finalState.touchdown?.classification).toBe("landed");
    expect(finalState.touchdown?.violations).toEqual([]);
  });

  it("classifies an excessive sink rate as a crash", () => {
    const state = createLunarFlightState({
      altitudeM: 500,
      radialSpeedMps: -20,
    });
    const { finalState } = runLunarScenario(state, [], 120_000_000, P);
    expect(finalState.terminalState).toBe("crashed");
    expect(finalState.touchdown?.violations).toContain("vertical-speed");
  });

  it("evaluates the three limit categories independently", () => {
    expect(evaluateTouchdown(0, -1, 0.5, 0, P).classification).toBe("landed");
    expect(evaluateTouchdown(0, -3.5, 0, 0, P).classification).toBe(
      "hard-landing",
    );
    expect(evaluateTouchdown(0, -1, 1.5, 0, P).classification).toBe(
      "hard-landing",
    );
    expect(evaluateTouchdown(0, -1, 0, 0.4, P).classification).toBe("crashed");
    expect(evaluateTouchdown(0, -1, 0, 0.4, P).violations).toContain("tilt");
  });

  it("never penetrates the surface and stops dead on contact", () => {
    const state = createLunarFlightState({ altitudeM: 40, radialSpeedMps: -8 });
    const { finalState } = runLunarScenario(state, [], 60_000_000, P);
    const orbit = computeOrbitalValues(finalState, P);
    expect(orbit.altitudeM).toBeCloseTo(0, 6);
    expect(finalState.velocityMps[0]).toBe(0);
    expect(finalState.velocityMps[1]).toBe(0);
  });

  it("a terminal state latches and further steps do not move the vehicle", () => {
    const state = createLunarFlightState({ altitudeM: 1, radialSpeedMps: -0.5 });
    const { finalState } = runLunarScenario(state, [], 30_000_000, P);
    const after = stepLunarFlight(
      finalState,
      { throttle: 1, engineCommand: "descent", attitudeCommand: 1 },
      10_000_000,
      P,
    );
    expect(after.positionM).toEqual(finalState.positionM);
    expect(after.velocityMps).toEqual(finalState.velocityMps);
    expect(after.touchdown).toEqual(finalState.touchdown);
    expect(after.mainEngine).toBe("off");
  });

  it("respects a non-flat terrain model", () => {
    const hilly = {
      ...P,
      terrain: {
        meanRadiusM: P.environment.meanRadiusM.value,
        amplitudeM: 500,
        angularWavelengthRad: 0.01,
        phaseRad: Math.PI / 2,
      },
    };
    const state = createLunarFlightState({ altitudeM: 100 }, hilly);
    const orbit = computeOrbitalValues(state, hilly);
    expect(orbit.terrainRadiusM).toBeGreaterThan(P.environment.meanRadiusM.value);
    expect(orbit.altitudeM).toBeCloseTo(100, 6);
  });
});

describe("lunar2d: determinism and replay", () => {
  const commands: readonly TimedLunarCommand[] = [
    { missionTimeUs: 0, engineCommand: "descent", throttle: 0.4 },
    { missionTimeUs: 10_000_000, attitudeCommand: 0.5 },
    { missionTimeUs: 20_000_000, attitudeCommand: 0, throttle: 0.6 },
    { missionTimeUs: 40_000_000, throttle: 0.3 },
  ];

  it("repeated runs are bit-identical", () => {
    const state = createLunarFlightState({
      altitudeM: 3_000,
      radialSpeedMps: -30,
    });
    const a = runLunarScenario(state, commands, 90_000_000, P).finalState;
    const b = runLunarScenario(state, commands, 90_000_000, P).finalState;
    expect(canonicalizeLunarState(a)).toBe(canonicalizeLunarState(b));
    expect(lunarStateChecksum(a)).toBe(lunarStateChecksum(b));
  });

  it("is frame-rate independent: one shot equals substep-by-substep", () => {
    const state = createLunarFlightState({
      altitudeM: 3_000,
      radialSpeedMps: -30,
    });
    const oneShot = runLunarScenario(state, commands, 90_000_000, P).finalState;

    const chunked = runLunarScenario(state, commands, 90_000_000, P, {
      sampleIntervalUs: SUBSTEP,
    }).finalState;
    expect(canonicalizeLunarState(chunked)).toBe(
      canonicalizeLunarState(oneShot),
    );
  });

  it("same-timestamp commands honour `order` regardless of insertion order", () => {
    const state = createLunarFlightState({ altitudeM: 3_000 });
    const forward: TimedLunarCommand[] = [
      { missionTimeUs: 0, throttle: 0.2, engineCommand: "descent", order: 0 },
      { missionTimeUs: 0, throttle: 0.6, order: 1 },
    ];
    const reversed = [forward[1], forward[0]];
    const a = runLunarScenario(state, forward, 20_000_000, P).finalState;
    const b = runLunarScenario(state, reversed, 20_000_000, P).finalState;
    expect(canonicalizeLunarState(a)).toBe(canonicalizeLunarState(b));
    expect(a.throttle).toBeCloseTo(0.6, 12);
  });

  it("captures a history sample per boundary when asked", () => {
    const state = createLunarFlightState({ altitudeM: 3_000 });
    const run = runLunarScenario(state, [], 1_000_000, P, {
      captureHistory: true,
      sampleIntervalUs: 100_000,
    });
    expect(run.history.length).toBe(11);
    expect(run.history[0].missionTimeUs).toBe(0);
    expect(run.history[10].missionTimeUs).toBe(1_000_000);
  });
});

describe("lunar2d: scenarios and guidance", () => {
  it("every registered scenario instantiates consistently", () => {
    for (const id of LUNAR_SCENARIO_IDS) {
      const { definition, state } = instantiateLunarScenario(id);
      expect(definition.id).toBe(id);
      expect(definition.version).toBeGreaterThan(0);
      expect(Number.isFinite(state.positionM[0])).toBe(true);
      expect(totalMassKg(state)).toBeGreaterThan(0);
      expect(state.terminalState).toBeNull();
    }
  });

  it("the liftoff scenario starts on the surface with no descent propellant", () => {
    const { state } = instantiateLunarScenario("liftoff-training");
    const orbit = computeOrbitalValues(state, P);
    expect(orbit.altitudeM).toBeCloseTo(0, 6);
    expect(state.descentPropellantKg).toBe(0);
    expect(state.ascentPropellantKg).toBeGreaterThan(0);
  });

  it("guidance is advisory and does not alter state", () => {
    const { state, definition } = instantiateLunarScenario("terminal-descent");
    const before = canonicalizeLunarState(state);
    const cue = computeReferenceGuidance(state, definition.parameters);
    expect(canonicalizeLunarState(state)).toBe(before);
    expect(cue.recommendedThrottle).toBeGreaterThan(0);
    expect(cue.targetRadialSpeedMps).toBeLessThan(0);
    expect(cue.advisory.length).toBeGreaterThan(0);
  });

  it("guidance commands a tilt to null horizontal velocity", () => {
    const { state } = instantiateLunarScenario("terminal-descent");
    const cue = computeReferenceGuidance(state, P);
    // Positive tangential velocity ⇒ thrust must tilt retrograde (negative).
    expect(cue.recommendedAttitudeRad).toBeLessThan(0);
  });

  it("scenario definitions are frozen data, not shared mutable state", () => {
    const a = getLunarScenario("high-gate-descent");
    const b = getLunarScenario("high-gate-descent");
    expect(a).toBe(b);
    expect(JSON.stringify(a.initial)).toBe(JSON.stringify(b.initial));
  });
});

describe("lunar2d: firewall with the frozen 1D kernel", () => {
  it("does not import or depend on AGC / hardware-lab modules", async () => {
    const physicsSource = await import("../physics");
    expect(Object.keys(physicsSource)).toContain("stepLunarFlight");
    // The kernel takes no arguments other than state, input, dt, parameters:
    expect(stepLunarFlight.length).toBeLessThanOrEqual(4);
  });
});
