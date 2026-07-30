// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 3/9 — pure PIPA encoder regressions.
//
// These pin the RESOLVED LM pulse weight (1 cm/s), the drift-free residual
// carry, polarity, atomic refusal, and the fact that the Command-Module
// 5.85 cm/s weight can never be used for the LM.

import { describe, expect, it } from "vitest";
import {
  PIPAX_ADDRESS,
  PIPAY_ADDRESS,
  PIPAZ_ADDRESS,
  PIPA_CM_PER_SECOND_PER_PULSE,
  PIPA_COMMAND_MODULE_CM_PER_PULSE_NOT_LM,
  PIPA_METERS_PER_SECOND_PER_PULSE,
  PIPA_UNSOURCED_MAX_PULSES_PER_AXIS_PER_TICK,
  createPipaEncoderState,
  encodePipaTick,
  pulsesToMetersPerSecond,
  type PipaEncoderInputs,
  type PipaEncoderState,
} from "../pipaEncoder";
import {
  MONITOR_COUNTER_REGISTRY,
  mappedCountersForProfile,
  unresolvedCountersForProfile,
  validateCounterRegistry,
} from "../sensorRegistry";
import { decideMonitorEntry, type MonitorEntryContext } from "../profileValidation";

const TICK_US = 20_000;

function inputs(p: Partial<PipaEncoderInputs> = {}): PipaEncoderInputs {
  return {
    missionTimeUs: 0,
    dtUs: TICK_US,
    specificForceStableMemberMps2: { x: 0, y: 0, z: 0 },
    pipaHealthy: true,
    ...p,
  };
}

describe("PIPA scale (primary + rope-internal)", () => {
  it("is exactly 1 cm/s per pulse for the LM, and 5.85 is CM-only", () => {
    expect(PIPA_CM_PER_SECOND_PER_PULSE).toBe(1.0);
    expect(PIPA_METERS_PER_SECOND_PER_PULSE).toBe(0.01);
    expect(PIPA_COMMAND_MODULE_CM_PER_PULSE_NOT_LM).toBe(5.85);
    // The CM weight must never appear as an LM counter scale.
    for (const c of MONITOR_COUNTER_REGISTRY) {
      if (c.counterName.startsWith("PIPA")) expect(c.unitPerPulse).toBe(0.01);
    }
  });

  it("pins the PIPA counter addresses", () => {
    expect(PIPAX_ADDRESS).toBe(0o37);
    expect(PIPAY_ADDRESS).toBe(0o40);
    expect(PIPAZ_ADDRESS).toBe(0o41);
  });

  it("round-trips pulses to velocity", () => {
    expect(pulsesToMetersPerSecond(100)).toBeCloseTo(1.0, 12);
    expect(pulsesToMetersPerSecond(-37)).toBeCloseTo(-0.37, 12);
  });
});

describe("counter registry", () => {
  it("is structurally valid", () => {
    expect(validateCounterRegistry()).toEqual([]);
  });

  it("marks all three PIPA axes mapped and all three CDU axes unresolved", () => {
    const mapped = mappedCountersForProfile("descent-monitor-v1").map((c) => c.id);
    expect(mapped).toContain("pipa.x.delta-v-pulse");
    expect(mapped).toContain("pipa.y.delta-v-pulse");
    expect(mapped).toContain("pipa.z.delta-v-pulse");
    const unresolved = unresolvedCountersForProfile("descent-monitor-v1").map((c) => c.id);
    expect(unresolved).toEqual(["cdu.x.angle", "cdu.y.angle", "cdu.z.angle"]);
  });

  it("keeps descent-monitor-v1 blocked, now on axis bootstrap + CDU, not PIPA scale", () => {
    const ctx: MonitorEntryContext = {
      simulationEpoch: 1,
      agcSessionEpoch: 1,
      agcReady: true,
      hwioVersion: 3,
      ropeId: "Luminary099",
      ropeSha256: "a".repeat(64),
      runtimeStatus: "running",
      activeScenarioId: "m3.2-golden-vertical-descent-v1",
      traceCurrentlyEnabled: false,
    };
    const d = decideMonitorEntry("descent-monitor-v1", ctx);
    expect(d.outcome).toBe("blocked");
    if (d.outcome !== "blocked") return;
    const joined = d.reasons.map((r) => r.detail).join(" | ");
    expect(joined).toContain("Stable-member");
    expect(joined).toContain("cdu.x.angle");
    // The resolved PIPA scale must NOT be cited as a blocker any more.
    expect(joined).not.toContain("PIPA increments X/Y/Z");
  });
});

describe("encoding", () => {
  it("emits nothing for zero specific force", () => {
    const r = encodePipaTick(createPipaEncoderState(), inputs());
    expect(r.actions).toEqual([]);
    expect(r.diagnostic.emitted).toBe(false);
  });

  it("emits PINC for positive and MINC for negative ΔV, on the right counters", () => {
    // 5 m/s^2 for 20 ms = 0.1 m/s = 10 cm/s = 10 pulses.
    const r = encodePipaTick(
      createPipaEncoderState(),
      inputs({ specificForceStableMemberMps2: { x: 5, y: -5, z: 0 } }),
    );
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0]).toMatchObject({
      kind: "counter-pulses",
      counterAddress: PIPAX_ADDRESS,
      incType: "PINC",
      pulseCount: 10,
      mappingId: "pipa.x.delta-v-pulse",
    });
    expect(r.actions[1]).toMatchObject({
      counterAddress: PIPAY_ADDRESS,
      incType: "MINC",
      pulseCount: 10,
    });
    // Ordered X -> Y -> Z.
    expect(r.actions[0]!.suborder).toBeLessThan(r.actions[1]!.suborder);
  });

  it("never collapses opposing axes and never emits for a null/failed sensor", () => {
    const failed = encodePipaTick(
      createPipaEncoderState(),
      inputs({ pipaHealthy: false, specificForceStableMemberMps2: { x: 5, y: 0, z: 0 } }),
    );
    expect(failed.actions).toEqual([]);
    const idle = encodePipaTick(
      createPipaEncoderState(),
      inputs({ specificForceStableMemberMps2: null }),
    );
    expect(idle.actions).toEqual([]);
    // A failed/absent sensor does NOT silently accumulate velocity.
    expect(failed.nextState.residualCmPerSecond.x).toBe(0);
    expect(idle.nextState.cumulativePulses.x).toBe(0);
  });

  it("carries the residual and is drift-free over 100 s of thrust", () => {
    // 1.7 m/s^2 for 100 s = 170 m/s = 17000 cm/s = 17000 pulses exactly.
    let state: PipaEncoderState = createPipaEncoderState();
    let emitted = 0;
    for (let t = 0; t < 100_000_000; t += TICK_US) {
      const r = encodePipaTick(
        state,
        inputs({ missionTimeUs: t, specificForceStableMemberMps2: { x: 1.7, y: 0, z: 0 } }),
      );
      state = r.nextState;
      for (const a of r.actions) {
        if (a.kind !== "counter-pulses") continue;
        emitted += a.incType === "PINC" ? a.pulseCount : -a.pulseCount;
      }
      expect(Math.abs(state.residualCmPerSecond.x)).toBeLessThan(1);
    }
    expect(emitted).toBe(state.cumulativePulses.x);
    // True ΔV is 170 m/s; the AGC's reconstruction may lag by < 1 pulse.
    expect(Math.abs(pulsesToMetersPerSecond(emitted) - 170)).toBeLessThan(
      PIPA_METERS_PER_SECOND_PER_PULSE,
    );
  });

  it("gives the same pulse total regardless of tick subdivision", () => {
    const run = (dtUs: number) => {
      let state = createPipaEncoderState();
      for (let t = 0; t < 10_000_000; t += dtUs) {
        state = encodePipaTick(
          state,
          inputs({ missionTimeUs: t, dtUs, specificForceStableMemberMps2: { x: 3.3, y: 0, z: 0 } }),
        ).nextState;
      }
      return state.cumulativePulses.x;
    };
    expect(run(20_000)).toBe(run(10_000));
    expect(run(20_000)).toBe(run(1_000));
  });

  it("is deterministic — identical inputs give identical actions", () => {
    const a = encodePipaTick(
      createPipaEncoderState(),
      inputs({ specificForceStableMemberMps2: { x: 1.234, y: -0.567, z: 0.891 } }),
    );
    const b = encodePipaTick(
      createPipaEncoderState(),
      inputs({ specificForceStableMemberMps2: { x: 1.234, y: -0.567, z: 0.891 } }),
    );
    expect(a.actions).toEqual(b.actions);
    expect(a.nextState).toEqual(b.nextState);
  });
});

describe("atomic refusal", () => {
  it("refuses non-finite specific force without emitting or mutating", () => {
    const state = createPipaEncoderState();
    const r = encodePipaTick(
      state,
      inputs({ specificForceStableMemberMps2: { x: Number.NaN, y: 0, z: 0 } }),
    );
    expect(r.actions).toEqual([]);
    expect(r.nextState).toBe(state);
    expect(r.blockedPrerequisites[0]?.code).toBe("sensor-range-invalid");
  });

  it("refuses a negative or non-integer tick length", () => {
    for (const dtUs of [0, -1, 1.5]) {
      const r = encodePipaTick(createPipaEncoderState(), inputs({ dtUs }));
      expect(r.blockedPrerequisites[0]?.code).toBe("sensor-range-invalid");
    }
  });

  it("refuses atomically above the labelled non-authentic pulse bound", () => {
    // Enough acceleration to exceed the bound on X only; Y must not emit
    // either — the tick is all-or-nothing.
    const perTickPulsesToAccel =
      (PIPA_UNSOURCED_MAX_PULSES_PER_AXIS_PER_TICK + 10) / 100 / (TICK_US / 1_000_000);
    const state = createPipaEncoderState();
    const r = encodePipaTick(
      state,
      inputs({ specificForceStableMemberMps2: { x: perTickPulsesToAccel, y: 5, z: 0 } }),
    );
    expect(r.actions).toEqual([]);
    expect(r.nextState).toBe(state);
    expect(r.blockedPrerequisites[0]?.detail).toContain("NON-AUTHENTIC REFUSAL BOUND");
  });
});
