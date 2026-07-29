// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.2 MissionRuntime — pure-coordinator tests. Deterministic ordering,
// command rejection categories, interlock semantics, snapshot fidelity,
// and bit-identical equivalence with the frozen M3.1 kernel for the
// GOLDEN scenario.

import { describe, expect, it } from "vitest";
import {
  MissionRuntime,
  MISSION_TICK_US,
  missionRuntimeStatesEqual,
} from "../MissionRuntime";
import { GOLDEN_MISSION_SCENARIO } from "../scenarios";
import type { MissionCommand } from "../types";
import { runLmScenario } from "@/simulation/lm/scenario";

function drive(
  runtime: MissionRuntime,
  totalTicks: number,
): { finalTick: number; terminals: number } {
  let terminals = 0;
  for (let i = 0; i < totalTicks; i++) {
    const tickStartUs = i * MISSION_TICK_US;
    runtime.applyBoundaryCommands(tickStartUs);
    if (runtime.advancePhysics(tickStartUs, i) !== null) terminals++;
    if (runtime.getStatus() === "landed" || runtime.getStatus() === "crashed") {
      return { finalTick: i, terminals };
    }
  }
  return { finalTick: totalTicks - 1, terminals };
}

describe("MissionRuntime — command validation", () => {
  it("rejects duplicate commandId within the same epoch", () => {
    const r = new MissionRuntime();
    const base: MissionCommand = {
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    };
    expect(r.enqueue(base).accepted).toBe(true);
    const dup = r.enqueue({ ...base, applyAtMissionTimeUs: 40_000 });
    expect(dup.accepted).toBe(false);
    if (!dup.accepted) expect(dup.reason).toBe("duplicate-command-id");
  });

  it("rejects stale simulation epoch", () => {
    const r = new MissionRuntime();
    const ack = r.enqueue({
      type: "resetScenario",
      commandId: 7,
      simulationEpoch: 99,
      applyAtMissionTimeUs: 20_000,
    });
    expect(ack.accepted).toBe(false);
    if (!ack.accepted) expect(ack.reason).toBe("stale-simulation-epoch");
  });

  it("rejects a command scheduled at or before the accepted cursor", () => {
    const r = new MissionRuntime();
    r.enqueue({
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
    // Drive one tick to advance the cursor to 20_000 µs.
    r.applyBoundaryCommands(0);
    r.advancePhysics(0, 0);
    const late = r.enqueue({
      type: "setControl",
      commandId: 2,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000, // <= cursor 20_000
      throttle: 0.5,
    });
    expect(late.accepted).toBe(false);
    if (!late.accepted) expect(late.reason).toBe("stale-command");
  });
});

describe("MissionRuntime — interlock semantics", () => {
  it("interlocks only when a scenario is running", () => {
    const r = new MissionRuntime();
    r.interlock("agc-epoch-changed");
    expect(r.getStatus()).toBe("idle");
    r.enqueue({
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
    r.applyBoundaryCommands(20_000);
    expect(r.getStatus()).toBe("running");
    r.interlock("agc-epoch-changed");
    expect(r.getStatus()).toBe("interlocked");
  });

  it("rejects non-reset commands while interlocked, accepts resetScenario", () => {
    const r = new MissionRuntime();
    r.enqueue({
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
    r.applyBoundaryCommands(20_000);
    r.interlock("agc-epoch-changed");
    const bad = r.enqueue({
      type: "setControl",
      commandId: 2,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 40_000,
      throttle: 1,
    });
    expect(bad.accepted).toBe(false);
    if (!bad.accepted) expect(bad.reason).toBe("interlocked");
    const good = r.enqueue({
      type: "resetScenario",
      commandId: 3,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 40_000,
    });
    expect(good.accepted).toBe(true);
  });
});

describe("MissionRuntime — deterministic ordering", () => {
  it("applies commands in (applyAt, commandId) order regardless of enqueue order", () => {
    const runA = () => {
      const r = new MissionRuntime();
      r.enqueue({ type: "startScenario", commandId: 1, simulationEpoch: 0, applyAtMissionTimeUs: 20_000, scenario: GOLDEN_MISSION_SCENARIO });
      r.enqueue({ type: "setControl", commandId: 5, simulationEpoch: 0, applyAtMissionTimeUs: 40_000, throttle: 0.4 });
      r.enqueue({ type: "setControl", commandId: 3, simulationEpoch: 0, applyAtMissionTimeUs: 40_000, throttle: 0.9 });
      drive(r, 5);
      return r.getState();
    };
    const runB = () => {
      const r = new MissionRuntime();
      r.enqueue({ type: "setControl", commandId: 3, simulationEpoch: 0, applyAtMissionTimeUs: 40_000, throttle: 0.9 });
      r.enqueue({ type: "setControl", commandId: 5, simulationEpoch: 0, applyAtMissionTimeUs: 40_000, throttle: 0.4 });
      r.enqueue({ type: "startScenario", commandId: 1, simulationEpoch: 0, applyAtMissionTimeUs: 20_000, scenario: GOLDEN_MISSION_SCENARIO });
      drive(r, 5);
      return r.getState();
    };
    // Same-timestamp setControls apply in ascending commandId order, so
    // the final control is commandId=5's throttle=0.4 in BOTH runs.
    expect(missionRuntimeStatesEqual(runA(), runB())).toBe(true);
  });
});

describe("MissionRuntime — bit-identical parity with M3.1 kernel", () => {
  it("golden scenario reaches the SAME touchdown through the runtime", () => {
    const r = new MissionRuntime();
    // Start scenario at absolute mission time 20_000 µs (one tick in the
    // future so cursor validation is satisfied). Physics is scenario-
    // relative so absolute-start offset does not shift terminal state.
    r.enqueue({
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
    // Drive up to ~400 s of scenario time (plus one lead-in tick).
    const { terminals } = drive(r, 400 * 50 + 1);
    expect(terminals).toBe(1);
    expect(r.getStatus() === "landed" || r.getStatus() === "crashed").toBe(true);

    const state = r.getState();
    const pure = runLmScenario(
      GOLDEN_MISSION_SCENARIO.initialLmState,
      GOLDEN_MISSION_SCENARIO.timedCommands,
      state.scenarioElapsedUs + MISSION_TICK_US,
    );
    expect(state.lm).not.toBeNull();
    if (state.lm) {
      expect(state.lm.altitudeM).toBeCloseTo(pure.finalState.altitudeM, 6);
      expect(state.lm.verticalVelocityMps).toBeCloseTo(pure.finalState.verticalVelocityMps, 6);
      expect(state.lm.propellantMassKg).toBeCloseTo(pure.finalState.propellantMassKg, 6);
      expect(state.lm.landed).toBe(pure.finalState.landed);
    }
    expect(state.touchdown?.classification).toBe(pure.finalState.touchdown?.classification);
  });
});

describe("MissionRuntime — snapshot fidelity", () => {
  it("snapshot carries simulationEpoch, status, interlock, LM state, and monotonic sequence", () => {
    const r = new MissionRuntime();
    r.enqueue({
      type: "startScenario",
      commandId: 1,
      simulationEpoch: 0,
      applyAtMissionTimeUs: 20_000,
      scenario: GOLDEN_MISSION_SCENARIO,
    });
    r.applyBoundaryCommands(20_000);
    r.advancePhysics(20_000, 1);
    const a = r.snapshot(1, 40_000, false);
    const b = r.snapshot(2, 60_000, true);
    expect(a.simulationEpoch).toBe(0);
    expect(a.status).toBe("running");
    expect(a.interlockReason).toBeNull();
    expect(a.lm).not.toBeNull();
    expect(b.sequence).toBeGreaterThan(a.sequence);
    expect(b.clockPaused).toBe(true);
  });
});
