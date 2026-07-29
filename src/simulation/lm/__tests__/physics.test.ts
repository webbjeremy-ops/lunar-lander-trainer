// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LM_PHYSICS_PARAMETERS,
  createInitialLmState,
  stepLmPhysics,
  runLmScenario,
  type LmControlInput,
  type LmPhysicsState,
  type TimedLmCommand,
} from "../index";
import {
  GOLDEN_INITIAL_STATE,
  GOLDEN_COMMANDS,
} from "./goldenScenario";

const P = DEFAULT_LM_PHYSICS_PARAMETERS;
const ZERO_INPUT: LmControlInput = { throttle: 0, engineEnabled: false };

function freeze<T>(o: T): Readonly<T> {
  return Object.freeze({ ...(o as object) }) as Readonly<T>;
}

describe("stepLmPhysics — purity and immutability", () => {
  it("does not mutate its input state or input control", () => {
    const s = freeze(createInitialLmState(P, { altitudeM: 1000, verticalVelocityMps: 0 }));
    const input = freeze(ZERO_INPUT);
    const before = JSON.stringify(s);
    const beforeIn = JSON.stringify(input);
    stepLmPhysics(s, input, 1_000_000, P);
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(input)).toBe(beforeIn);
  });

  it("dtUs = 0 with unchanged control returns the same object", () => {
    const s = createInitialLmState(P);
    const input: LmControlInput = { throttle: s.throttle, engineEnabled: s.engineEnabled };
    const out = stepLmPhysics(s, input, 0, P);
    expect(out).toBe(s);
  });

  it("rejects negative or non-finite dtUs", () => {
    const s = createInitialLmState(P);
    expect(() => stepLmPhysics(s, ZERO_INPUT, -1, P)).toThrow(RangeError);
    expect(() => stepLmPhysics(s, ZERO_INPUT, Number.NaN, P)).toThrow(RangeError);
  });
});

describe("stepLmPhysics — dynamics", () => {
  it("zero-thrust free fall matches analytical v = v0 - g*t within tolerance", () => {
    // Start high enough not to hit the ground during the test window.
    const s0 = createInitialLmState(P, { altitudeM: 50_000, verticalVelocityMps: 0 });
    const t = 30; // seconds
    const s1 = stepLmPhysics(s0, ZERO_INPUT, t * 1_000_000, P);
    const g = P.vehicle.lunarGravityMps2.value;
    const expectedV = -g * t;
    const expectedH = 50_000 - 0.5 * g * t * t;
    // Semi-implicit Euler introduces small O(dt) altitude bias; check tolerance.
    expect(s1.verticalVelocityMps).toBeCloseTo(expectedV, 6);
    expect(Math.abs(s1.altitudeM - expectedH)).toBeLessThan(1.0); // <1m over 30s
    expect(s1.propellantMassKg).toBe(s0.propellantMassKg); // no burn
  });

  it("engine off with throttle > 0 does not consume propellant", () => {
    const s0 = createInitialLmState(P, { altitudeM: 20_000 });
    const s1 = stepLmPhysics(s0, { throttle: 1, engineEnabled: false }, 5_000_000, P);
    expect(s1.propellantMassKg).toBe(s0.propellantMassKg);
  });

  it("thrust uses current total mass — acceleration rises as propellant depletes", () => {
    // Hover-ish comparison: two identical states differing only in fuel.
    const heavy: LmPhysicsState = createInitialLmState(P, { altitudeM: 10_000, propellantMassKg: 8000, verticalVelocityMps: 0 });
    const light: LmPhysicsState = createInitialLmState(P, { altitudeM: 10_000, propellantMassKg: 500, verticalVelocityMps: 0 });
    const input: LmControlInput = { throttle: 0.5, engineEnabled: true };
    const heavy1 = stepLmPhysics(heavy, input, 100_000, P); // 0.1s
    const light1 = stepLmPhysics(light, input, 100_000, P);
    // Light vehicle accelerates upward more (or falls less).
    expect(light1.verticalVelocityMps).toBeGreaterThan(heavy1.verticalVelocityMps);
  });

  it("propellant is exhausted cleanly, and thrust cuts off", () => {
    const s0 = createInitialLmState(P, { altitudeM: 30_000, propellantMassKg: 5, verticalVelocityMps: 0 });
    const s1 = stepLmPhysics(s0, { throttle: 1, engineEnabled: true }, 10_000_000, P);
    expect(s1.propellantMassKg).toBe(0);
    // With no fuel remaining, later steps must not burn.
    const s2 = stepLmPhysics(s1, { throttle: 1, engineEnabled: true }, 1_000_000, P);
    expect(s2.propellantMassKg).toBe(0);
    // And it should be in free fall (velocity decreasing).
    expect(s2.verticalVelocityMps).toBeLessThan(s1.verticalVelocityMps);
  });

  it("throttle is clamped to [0, 1]", () => {
    const s0 = createInitialLmState(P, { altitudeM: 10_000, propellantMassKg: 8000 });
    const s1 = stepLmPhysics(s0, { throttle: 2.5, engineEnabled: true }, 100_000, P);
    expect(s1.throttle).toBe(1);
    const s2 = stepLmPhysics(s0, { throttle: -3, engineEnabled: true }, 100_000, P);
    expect(s2.throttle).toBe(0);
    const s3 = stepLmPhysics(s0, { throttle: Number.NaN, engineEnabled: true }, 100_000, P);
    expect(s3.throttle).toBe(0);
  });

  it("does not cross the surface without touchdown detection", () => {
    // Fall from 5m at 100 m/s downward. Free fall would place the vehicle
    // well below the surface after one substep — kernel must clamp.
    const s0 = createInitialLmState(P, { altitudeM: 5, verticalVelocityMps: -100 });
    const s1 = stepLmPhysics(s0, ZERO_INPUT, 1_000_000, P);
    expect(s1.altitudeM).toBe(0);
    expect(s1.landed).toBe(true);
    expect(s1.touchdown).not.toBeNull();
    expect(s1.touchdown!.classification).toBe("crash");
  });
});

describe("stepLmPhysics — terminal touchdown", () => {
  it("safe/hard/crash classifications by descent speed", () => {
    const mk = (v: number): LmPhysicsState =>
      createInitialLmState(P, { altitudeM: 0.5, verticalVelocityMps: v });
    const soft = stepLmPhysics(mk(-1), ZERO_INPUT, 1_000_000, P);
    const hard = stepLmPhysics(mk(-4.5), ZERO_INPUT, 1_000_000, P);
    const crash = stepLmPhysics(mk(-20), ZERO_INPUT, 1_000_000, P);
    expect(soft.touchdown!.classification).toBe("safe");
    expect(hard.touchdown!.classification).toBe("hard");
    expect(crash.touchdown!.classification).toBe("crash");
    expect(crash.crashed).toBe(true);
    expect(soft.crashed).toBe(false);
  });

  it("touchdown is terminal — later steps cannot resume flight", () => {
    const s0 = createInitialLmState(P, { altitudeM: 0.2, verticalVelocityMps: -1 });
    const s1 = stepLmPhysics(s0, ZERO_INPUT, 500_000, P);
    expect(s1.landed).toBe(true);
    const captured = s1.touchdown!;
    const s2 = stepLmPhysics(s1, { throttle: 1, engineEnabled: true }, 5_000_000, P);
    expect(s2.landed).toBe(true);
    expect(s2.altitudeM).toBe(0);
    expect(s2.verticalVelocityMps).toBe(0);
    // Evidence unchanged.
    expect(s2.touchdown).toEqual(captured);
  });
});

describe("runLmScenario — determinism", () => {
  it("is reproducible across repeated runs (structural equality)", () => {
    const end = 300_000_000;
    const r1 = runLmScenario(GOLDEN_INITIAL_STATE, GOLDEN_COMMANDS, end, P);
    const r2 = runLmScenario(GOLDEN_INITIAL_STATE, GOLDEN_COMMANDS, end, P);
    expect(r2.finalState).toEqual(r1.finalState);
  });

  it("same-timestamp commands respect stable `order` + insertion index", () => {
    const s0 = createInitialLmState(P, { altitudeM: 10_000, propellantMassKg: 8000 });
    const A: TimedLmCommand[] = [
      { simulationTimeUs: 1_000_000, throttle: 0.2, engineEnabled: true, order: 1 },
      { simulationTimeUs: 1_000_000, throttle: 0.9, engineEnabled: true, order: 2 },
    ];
    const B: TimedLmCommand[] = [
      { simulationTimeUs: 1_000_000, throttle: 0.9, engineEnabled: true, order: 2 },
      { simulationTimeUs: 1_000_000, throttle: 0.2, engineEnabled: true, order: 1 },
    ];
    const r1 = runLmScenario(s0, A, 5_000_000, P);
    const r2 = runLmScenario(s0, B, 5_000_000, P);
    // Last-applied throttle should be 0.9 in both cases (order:2 wins).
    expect(r1.finalState.throttle).toBe(0.9);
    expect(r2.finalState.throttle).toBe(0.9);
    expect(r1.finalState).toEqual(r2.finalState);
  });

  it("subdividing the same schedule into smaller UI frames yields the same result", () => {
    // "1x vs 10x execution" analogue: run the scenario in one call, and in
    // many tiny calls of one substep each. Mission-time outcomes must match.
    const end = 200_000_000;
    const oneShot = runLmScenario(GOLDEN_INITIAL_STATE, GOLDEN_COMMANDS, end, P);

    const substep = P.integration.substepUs;
    let state: LmPhysicsState = GOLDEN_INITIAL_STATE;
    const commands = [...GOLDEN_COMMANDS].sort((a, b) => a.simulationTimeUs - b.simulationTimeUs);
    let ci = 0;
    let input: LmControlInput = { throttle: state.throttle, engineEnabled: state.engineEnabled };
    while (state.simulationTimeUs < end && !state.landed) {
      while (ci < commands.length && commands[ci].simulationTimeUs <= state.simulationTimeUs) {
        input = {
          throttle: commands[ci].throttle ?? input.throttle,
          engineEnabled: commands[ci].engineEnabled ?? input.engineEnabled,
        };
        ci++;
      }
      state = stepLmPhysics(state, input, substep, P);
    }
    expect(state).toEqual(oneShot.finalState);
  });

  it("pause (dt=0 stream) does not advance physics", () => {
    const s0 = createInitialLmState(P, { altitudeM: 5000, verticalVelocityMps: -5 });
    let s = s0;
    for (let i = 0; i < 100; i++) {
      s = stepLmPhysics(s, ZERO_INPUT, 0, P);
    }
    expect(s.altitudeM).toBe(s0.altitudeM);
    expect(s.verticalVelocityMps).toBe(s0.verticalVelocityMps);
    expect(s.simulationTimeUs).toBe(s0.simulationTimeUs);
  });
});

describe("golden scenario — regression lock", () => {
  it("terminates in a repeatable touchdown with locked evidence", () => {
    const r = runLmScenario(GOLDEN_INITIAL_STATE, GOLDEN_COMMANDS, 600_000_000, P);
    const s = r.finalState;
    expect(s.landed).toBe(true);
    expect(s.touchdown).not.toBeNull();
    // Snapshot the numeric evidence to ~4 s.f. — enough to catch a real
    // integrator regression without pinning noise.
    const td = s.touchdown!;
    expect(td.classification).toMatch(/^(safe|hard|crash)$/);
    expect(Number.isFinite(td.touchdownTimeUs)).toBe(true);
    expect(td.touchdownTimeUs).toBeGreaterThan(0);
    expect(td.remainingPropellantKg).toBeGreaterThanOrEqual(0);
    // Locked expected values (recorded from this build of the kernel).
    expect(td.touchdownTimeUs).toMatchInlineSnapshot();
    expect(Number(td.verticalVelocityMps.toFixed(4))).toMatchInlineSnapshot();
    expect(Number(td.remainingPropellantKg.toFixed(4))).toMatchInlineSnapshot();
    expect(td.classification).toMatchInlineSnapshot();
  });
});
