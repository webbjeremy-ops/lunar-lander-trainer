// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  CORRECTION_WINDOW_US,
  FINAL_WARNING_US,
  createHoustonEscalationState,
  escalatedCall,
  houstonDeviations,
  reduceHoustonEscalation,
  secondsToAbort,
  descentTension,
  scoreLayers,
  type FlightDeviationInput,
} from "@/game/play";

const S = 1_000_000;

const clean: FlightDeviationInput = {
  altitudeM: 3_000,
  radialSpeedMps: -20,
  horizontalSpeedMps: 40,
  attitudeRad: 0.4,
  angularRateRadPerSec: 0,
  propellantFraction: 0.5,
  windowsUp: true,
  engineBurning: true,
  terminal: false,
};

const inverted: FlightDeviationInput = { ...clean, attitudeRad: 2.6 };

function run(input: FlightDeviationInput, seconds: number) {
  let state = createHoustonEscalationState();
  const steps = Math.round((seconds * S) / 20_000);
  for (let i = 0; i < steps; i++) {
    state = reduceHoustonEscalation(state, {
      deviations: houstonDeviations(input),
      stepUs: 20_000,
      terminal: false,
      crewAborted: false,
    });
  }
  return state;
}

describe("houston escalation ladder", () => {
  it("stays clear while the flight is nominal", () => {
    const s = run(clean, 60);
    expect(s.stage).toBe("clear");
    expect(s.scriptTerminated).toBe(false);
    expect(secondsToAbort(s)).toBe(Number.POSITIVE_INFINITY);
  });

  it("calls a correction before it ever calls an abort", () => {
    const s = run(inverted, 5);
    expect(s.stage).toBe("correct");
    expect(s.abortDirected).toBe(false);
    expect(secondsToAbort(s)).toBeGreaterThan(0);
  });

  it("issues a final warning inside the correction window", () => {
    const s = run(inverted, FINAL_WARNING_US / S + 1);
    expect(s.stage).toBe("final-warning");
    expect(s.abortDirected).toBe(false);
  });

  it("directs the abort and terminates the script when uncorrected", () => {
    const s = run(inverted, CORRECTION_WINDOW_US / S + 1);
    expect(s.stage).toBe("abort");
    expect(s.abortDirected).toBe(true);
    expect(s.scriptTerminated).toBe(true);
    expect(secondsToAbort(s)).toBe(0);
  });

  it("clears the ladder when the crew corrects in time", () => {
    let s = run(inverted, 8);
    expect(s.stage).toBe("correct");
    for (let i = 0; i < 200; i++) {
      s = reduceHoustonEscalation(s, {
        deviations: houstonDeviations(clean),
        stepUs: 20_000,
        terminal: false,
        crewAborted: false,
      });
    }
    expect(s.stage).toBe("clear");
    expect(s.scriptTerminated).toBe(false);
  });

  it("escalates the wording from advisory text to an abort directive", () => {
    const base = houstonDeviations(inverted)[0]!;
    const corrected = escalatedCall(run(inverted, 4), base);
    expect(corrected?.text).toBe(base.text);
    const directive = escalatedCall(run(inverted, CORRECTION_WINDOW_US / S + 1), base);
    expect(directive?.text).toContain("ABORT STAGE");
    expect(directive?.blocksLanding).toBe(true);
  });
});

describe("descent score model", () => {
  const base = {
    sinceIgnitionSec: 0,
    altitudeM: 15_000,
    propellantFraction: 0.6,
    houstonStage: "clear" as const,
    crewAborted: false,
    terminal: false,
  };

  it("escalates with the timeline", () => {
    const early = descentTension(base);
    const late = descentTension({ ...base, sinceIgnitionSec: 600 });
    expect(late).toBeGreaterThan(early);
  });

  it("escalates hard on approach to the surface", () => {
    const high = descentTension({ ...base, altitudeM: 5_000 });
    const low = descentTension({ ...base, altitudeM: 100 });
    expect(low).toBeGreaterThan(high);
    expect(low).toBeGreaterThanOrEqual(0.9);
  });

  it("pins at maximum once an abort is directed", () => {
    expect(descentTension({ ...base, houstonStage: "abort" })).toBe(1);
  });

  it("resolves after touchdown", () => {
    expect(descentTension({ ...base, terminal: true })).toBeLessThan(0.2);
  });

  it("layers rise monotonically with tension", () => {
    const a = scoreLayers(0.3);
    const b = scoreLayers(0.9);
    expect(b.drone).toBeGreaterThan(a.drone);
    expect(b.pulseBpm).toBeGreaterThan(a.pulseBpm);
    expect(b.dissonance).toBeGreaterThan(a.dissonance);
    expect(a.dissonance).toBe(0);
  });
});
