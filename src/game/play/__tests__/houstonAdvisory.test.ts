// SPDX-License-Identifier: GPL-3.0-or-later
// M4.18 — improvised Houston advisory rules.

import { describe, expect, it } from "vitest";
import {
  activeHoustonCall,
  houstonDeviations,
  isOffScript,
  landingClearance,
  sinkRateLimitMps,
  type FlightDeviationInput,
} from "../houstonAdvisory";

const nominal: FlightDeviationInput = {
  altitudeM: 1_000,
  radialSpeedMps: -8,
  horizontalSpeedMps: 5,
  attitudeRad: 0.5,
  angularRateRadPerSec: 0,
  propellantFraction: 0.5,
  windowsUp: true,
  engineBurning: true,
  terminal: false,
};

describe("houstonDeviations", () => {
  it("says nothing when the flight is nominal", () => {
    expect(houstonDeviations(nominal)).toEqual([]);
    expect(isOffScript(nominal)).toBe(false);
    expect(landingClearance(nominal).clear).toBe(true);
  });

  it("calls an inverted vehicle no-go", () => {
    const c = activeHoustonCall({ ...nominal, attitudeRad: 2.2 });
    expect(c?.id).toBe("attitude-inverted");
    expect(c?.severity).toBe("no-go");
    expect(landingClearance({ ...nominal, attitudeRad: 2.2 }).clear).toBe(false);
  });

  it("calls excessive sink rate no-go and merely high sink a caution", () => {
    const limit = sinkRateLimitMps(nominal.altitudeM);
    expect(activeHoustonCall({ ...nominal, radialSpeedMps: -(limit * 3) })?.id).toBe(
      "sink-excessive",
    );
    expect(activeHoustonCall({ ...nominal, radialSpeedMps: -(limit * 1.2) })?.id).toBe(
      "sink-high",
    );
  });

  it("flags translating too fast close to the surface", () => {
    const input = { ...nominal, altitudeM: 100, radialSpeedMps: -2, horizontalSpeedMps: 40 };
    expect(activeHoustonCall(input)?.id).toBe("translation-excessive");
    expect(landingClearance(input).reasons.length).toBeGreaterThan(0);
  });

  it("nags a windows-down vehicle below 12 km", () => {
    const ids = houstonDeviations({ ...nominal, windowsUp: false }).map((c) => c.id);
    expect(ids).toContain("still-windows-down");
    expect(isOffScript({ ...nominal, windowsUp: false })).toBe(true);
  });

  it("goes quiet once the flight is terminal", () => {
    expect(houstonDeviations({ ...nominal, attitudeRad: 3, terminal: true })).toEqual([]);
  });

  it("is deterministic", () => {
    expect(houstonDeviations({ ...nominal, radialSpeedMps: -80 })).toEqual(
      houstonDeviations({ ...nominal, radialSpeedMps: -80 }),
    );
  });
});
