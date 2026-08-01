// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { descentMonitorFor, formatRegister, formatClockRegister } from "../descentMonitor";

const base = {
  altitudeM: 3_000,
  radialSpeedMps: -20,
  tangentialSpeedMps: 150,
  tigOffsetUs: 0,
  sinceIgnitionUs: 60_000_000,
  burning: true,
  terminal: false,
};

describe("descent monitor registers", () => {
  it("formats signed five-digit registers", () => {
    expect(formatRegister(427)).toBe("+00427");
    expect(formatRegister(-31)).toBe("-00031");
    expect(formatRegister(1e9)).toBe("+99999");
  });

  it("formats mm:ss clock registers", () => {
    expect(formatClockRegister(65)).toBe("+01050");
  });

  it("shows V06 N62 before ignition", () => {
    const v = descentMonitorFor({ ...base, burning: false, sinceIgnitionUs: 0, tigOffsetUs: 35_000_000 });
    expect(v.noun).toBe("62");
    expect(v.r2).toBe("-00350");
  });

  it("shows N63 above high gate and N64 below it", () => {
    expect(descentMonitorFor({ ...base, altitudeM: 6_000 }).noun).toBe("63");
    expect(descentMonitorFor({ ...base, altitudeM: 1_000 }).noun).toBe("64");
  });

  it("shows N60 below low gate with altitude in feet", () => {
    const v = descentMonitorFor({ ...base, altitudeM: 30.48, tangentialSpeedMps: 3.048 });
    expect(v.noun).toBe("60");
    expect(v.program).toBe("66");
    expect(v.r1).toBe("+00010");
    expect(v.r3).toBe("+00100");
  });

  it("is pure — same input, same output", () => {
    expect(descentMonitorFor(base)).toEqual(descentMonitorFor(base));
  });
});
