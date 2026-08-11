// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { descentMonitorFor, formatRegister, formatClockRegister, formatMinSec } from "../descentMonitor";

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

  it("formats MIN/SEC with the blank middle digit", () => {
    expect(formatMinSec(150)).toBe("+02 30");
  });

  it("shows V16 N62 before ignition, flashing V99 with the request up", () => {
    const v = descentMonitorFor({ ...base, burning: false, sinceIgnitionUs: 0, tigOffsetUs: 150_000_000 });
    expect(v.verb).toBe("16");
    expect(v.noun).toBe("62");
    expect(v.r2).toBe("-02 30");
    expect(v.r3).toBe("+00000");
    const f = descentMonitorFor({ ...base, burning: false, sinceIgnitionUs: 0, tigOffsetUs: 5_000_000, ignitionRequestFlashing: true });
    expect(f.verb).toBe("99");
  });

  it("scales N63 velocity and rate to tenths", () => {
    const v = descentMonitorFor({ ...base, altitudeM: 6_000 });
    expect(v.noun).toBe("63");
    expect(v.r1).toBe(formatRegister(Math.hypot(-20, 150) / 0.3048 * 10));
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
