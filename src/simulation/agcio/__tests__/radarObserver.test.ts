// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3B2 — landing-radar RANGE encoder + cadence-honesty regressions.
//
// The encoder is a pure function. These tests pin the RNRAD representation
// derived from pinned source, the refusal (never wrap) behaviour, and the
// fact that the 250 ms cadence is a TEST FIXTURE that no production profile
// consults.

import { describe, expect, it } from "vitest";
import {
  LR_RANGE_CADENCE_CITATIONS,
  LR_RANGE_FEET_PER_BIT,
  LR_RANGE_MAX_COUNT,
  LR_RANGE_METERS_PER_BIT,
  LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_LABEL,
  LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US,
  LR_RANGE_SERIAL_BITS,
  RNRAD_ADDRESS,
  RNRAD_COUNTER_MASK,
  altitudeToRangeCount,
  createLandingRadarObserverState,
  encodeLandingRadarTick,
  rangeCountToAltitudeMeters,
  type LandingRadarObserverInputs,
} from "../radarObserver";
import {
  LANDING_RADAR_OBSERVER_V1_BLOCKS,
  SUPPORTED_MONITOR_PROFILES,
  decideMonitorEntry,
  type MonitorEntryContext,
} from "../profileValidation";

const CADENCE = LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US;

function inputs(p: Partial<LandingRadarObserverInputs> = {}): LandingRadarObserverInputs {
  return {
    missionTimeUs: 0,
    altitudeMeters: 1_000,
    rangeDataGood: true,
    cadenceUs: CADENCE,
    ...p,
  };
}

describe("RNRAD representation (pinned Luminary099 / yaAGC)", () => {
  it("is a 14-bit unsigned shift counter at 0o46 loaded with 15 serial bits", () => {
    expect(RNRAD_ADDRESS).toBe(0o46);
    expect(RNRAD_COUNTER_MASK).toBe(0o37777);
    expect(LR_RANGE_MAX_COUNT).toBe(0o37777);
    expect(LR_RANGE_SERIAL_BITS).toBe(15);
  });

  it("uses HSCAL 1.079 ft/bit and the exact foot", () => {
    expect(LR_RANGE_FEET_PER_BIT).toBe(1.079);
    expect(LR_RANGE_METERS_PER_BIT).toBeCloseTo(1.079 * 0.3048, 12);
  });

  it("round-trips counts deterministically", () => {
    for (const count of [0, 1, 2, 1234, LR_RANGE_MAX_COUNT]) {
      const alt = rangeCountToAltitudeMeters(count);
      expect(altitudeToRangeCount(alt)).toBe(count);
    }
  });
});

describe("boundary fixtures", () => {
  it("emits at the largest representable count", () => {
    const alt = rangeCountToAltitudeMeters(LR_RANGE_MAX_COUNT);
    const r = encodeLandingRadarTick(
      createLandingRadarObserverState(),
      inputs({ altitudeMeters: alt }),
    );
    expect(r.action?.word).toBe(LR_RANGE_MAX_COUNT);
    expect(r.diagnostic.saturated).toBe(false);
  });

  it("REFUSES (never wraps) one count above the counter width", () => {
    const alt = rangeCountToAltitudeMeters(LR_RANGE_MAX_COUNT + 1);
    const r = encodeLandingRadarTick(
      createLandingRadarObserverState(),
      inputs({ altitudeMeters: alt }),
    );
    expect(r.action).toBeNull();
    expect(r.diagnostic.saturated).toBe(true);
    expect(r.diagnostic.targetCounterValue).toBe(LR_RANGE_MAX_COUNT + 1);
    expect(r.diagnostic.emittedWord).toBeNull();
  });

  it("emits zero at zero altitude and refuses negative altitude atomically", () => {
    const zero = encodeLandingRadarTick(
      createLandingRadarObserverState(),
      inputs({ altitudeMeters: 0 }),
    );
    expect(zero.action?.word).toBe(0);

    const state = createLandingRadarObserverState();
    const neg = encodeLandingRadarTick(state, inputs({ altitudeMeters: -1 }));
    expect(neg.action).toBeNull();
    expect(neg.nextState).toBe(state);
    expect(neg.blockedPrerequisites[0]?.code).toBe("sensor-range-invalid");
  });

  it("never emits without the operator-declared RANGE DATA GOOD discrete", () => {
    const r = encodeLandingRadarTick(
      createLandingRadarObserverState(),
      inputs({ rangeDataGood: false }),
    );
    expect(r.action).toBeNull();
  });

  it("quantization residual is bounded by half a bit", () => {
    const half = LR_RANGE_METERS_PER_BIT / 2 + 1e-9;
    for (let alt = 0; alt < 500; alt += 3.7) {
      const r = encodeLandingRadarTick(createLandingRadarObserverState(), inputs({ altitudeMeters: alt }));
      expect(Math.abs(r.diagnostic.residualMeters ?? 0)).toBeLessThanOrEqual(half);
    }
  });

  it("is deterministic and cadence-gated with an explicit cadence", () => {
    let state = createLandingRadarObserverState();
    const emitted: number[] = [];
    for (let t = 0; t <= 1_000_000; t += 20_000) {
      const r = encodeLandingRadarTick(state, inputs({ missionTimeUs: t }));
      state = r.nextState;
      if (r.action) emitted.push(t);
    }
    // Emission is gated on "cadence elapsed since last emit", sampled on the
    // 20 ms mission-tick grid, so boundaries land on the first tick at or
    // after the cadence — deterministic, and never mid-tick.
    expect(emitted).toEqual([0, 260_000, 520_000, 780_000]);
  });
});

describe("cadence honesty", () => {
  it("labels the 250 ms cadence as a non-authentic test fixture", () => {
    expect(LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US).toBe(250_000);
    expect(LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_LABEL).toBe(
      "NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE",
    );
    expect(LR_RANGE_CADENCE_CITATIONS.length).toBeGreaterThanOrEqual(4);
    expect(LR_RANGE_CADENCE_CITATIONS.join(" ")).toContain("INITREAD");
    expect(LR_RANGE_CADENCE_CITATIONS.join(" ")).toContain("LRHTASK");
  });

  it("landing-radar-observer-v1 is a known profile that never enters", () => {
    expect(SUPPORTED_MONITOR_PROFILES).toContain("landing-radar-observer-v1");
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
    const d = decideMonitorEntry("landing-radar-observer-v1", ctx);
    expect(d.outcome).toBe("blocked");
    if (d.outcome !== "blocked") return;
    expect(d.reasons.some((r) => r.code === "radar-update-cadence-unresolved")).toBe(true);
    expect(d.reasons.some((r) => r.code === "profile-unknown")).toBe(false);
  });

  it("the block list cites the AGC-solicited CHAN13 transaction", () => {
    const joined = LANDING_RADAR_OBSERVER_V1_BLOCKS.map(
      (r) => `${r.detail} ${r.reference ?? ""}`,
    ).join(" ");
    expect(joined).toContain("CHAN13");
    expect(joined).toContain("READACCS");
    expect(joined).toContain("PIPA");
  });
});
