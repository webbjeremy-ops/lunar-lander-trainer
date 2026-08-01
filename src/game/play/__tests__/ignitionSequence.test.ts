// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.7 — Pure PDI ignition-sequence reducer tests.

import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_LENGTH_US,
  createIgnitionState,
  FIXED_THROTTLE_DURATION_US,
  FIXED_THROTTLE_FRACTION,
  formatTig,
  bridgedRequestFor,
  IGNITION_REQUEST_US,
  reduceIgnition,
  throttleCeiling,
  type IgnitionSequenceState,
} from "@/game/play";

const S = 1_000_000;

function tick(state: IgnitionSequenceState, seconds: number): IgnitionSequenceState {
  let s = state;
  const steps = Math.round(seconds * 50); // 20 ms substeps, as the host uses
  for (let i = 0; i < steps; i += 1) s = reduceIgnition(s, { kind: "tick", dtUs: 20_000 });
  return s;
}

describe("ignition sequence", () => {
  it("is inert until started", () => {
    const s = tick(createIgnitionState(), 30);
    expect(s.phase).toBe("standby");
    expect(s.tigOffsetUs).toBe(COUNTDOWN_LENGTH_US);
  });

  it("raises the bridged flashing V99 N62 at TIG-35 s", () => {
    let s = reduceIgnition(createIgnitionState(), { kind: "start" });
    s = tick(s, 20);
    expect(bridgedRequestFor(s)).toBeNull();
    s = tick(s, 6);
    expect(s.phase).toBe("ignition-request");
    expect(s.tigOffsetUs).toBeLessThanOrEqual(IGNITION_REQUEST_US);
    expect(bridgedRequestFor(s)).toEqual({
      verb: "99",
      noun: "62",
      flashing: true,
      label: "PLEASE ENABLE ENGINE IGNITION",
    });
  });

  it("refuses PROCEED with ENG ARM off and accepts it once armed", () => {
    let s = reduceIgnition(createIgnitionState(), { kind: "start" });
    s = tick(s, 26);
    s = reduceIgnition(s, { kind: "proceed" });
    expect(s.proAccepted).toBe(false);
    expect(s.armFault).toBe(true);

    s = reduceIgnition(s, { kind: "arm", on: true });
    expect(s.armFault).toBe(false);
    s = reduceIgnition(s, { kind: "proceed" });
    expect(s.proAccepted).toBe(true);
    expect(s.requestFlashing).toBe(false);
  });

  it("holds the 10 % fixed-throttle point for 26 s, then ramps up", () => {
    let s = reduceIgnition(createIgnitionState(), { kind: "start" });
    s = reduceIgnition(s, { kind: "arm", on: true });
    s = tick(s, 26);
    s = reduceIgnition(s, { kind: "proceed" });
    expect(throttleCeiling(s)).toBe(0);

    s = tick(s, 27); // TIG-7 s: inside the ullage window
    expect(s.phase).toBe("ullage");

    s = tick(s, 8); // past TIG
    expect(s.phase).toBe("burning");
    expect(throttleCeiling(s)).toBe(FIXED_THROTTLE_FRACTION);
    expect(s.sinceIgnitionUs).toBeLessThan(FIXED_THROTTLE_DURATION_US);

    s = tick(s, 30);
    // Fixed throttle point is 92.5 %, not "full" — the engine was never run
    // between 65 % and FTP for long, and never above FTP.
    expect(throttleCeiling(s)).toBeCloseTo(0.925);
  });

  it("speaks Aldrin's ignition callout at TIG", () => {
    let s = reduceIgnition(createIgnitionState(), { kind: "start" });
    s = reduceIgnition(s, { kind: "arm", on: true });
    s = tick(s, 26);
    s = reduceIgnition(s, { kind: "proceed" });
    s = tick(s, 34);
    expect(s.spoken.some((c) => c.text.includes("Burn, baby, burn"))).toBe(true);
  });

  it("aborts when TIG passes without PROCEED", () => {
    let s = reduceIgnition(createIgnitionState(), { kind: "start" });
    s = reduceIgnition(s, { kind: "arm", on: true });
    s = tick(s, 61);
    expect(s.phase).toBe("aborted");
    expect(throttleCeiling(s)).toBe(0);
  });

  it("formats the TIG clock either side of ignition", () => {
    const s = createIgnitionState();
    expect(formatTig(s)).toBe("T-01:00.0");
    expect(formatTig({ ...s, tigOffsetUs: -5 * S })).toBe("T+00:05.0");
  });
});
