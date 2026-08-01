// SPDX-License-Identifier: GPL-3.0-or-later
// Roll cue, DSKY step gating and the DPS start profile all share one timebase.

import { describe, expect, it } from "vitest";
import { ROLL_CUE_SINCE_IGNITION_US } from "../descentRoll";
import { APOLLO11_DESCENT_CALLOUTS } from "../descentCallouts";
import { APOLLO11_DESCENT_SCRIPT } from "../procedures";
import { milestoneSec } from "../descentTimeline";
import { throttleCeilingForSinceIgnition } from "../ignitionSequence";

const S = 1_000_000;

describe("descent sequence timing", () => {
  it("gives the cockpit roll cue at the same time as Aldrin's call", () => {
    const call = APOLLO11_DESCENT_CALLOUTS.find((c) => c.id === "roll-windows-up")!;
    expect(ROLL_CUE_SINCE_IGNITION_US / S).toBe(call.atSinceIgnitionSec);
    expect(ROLL_CUE_SINCE_IGNITION_US / S).toBe(milestoneSec("yaw-around"));
  });

  it("does not recommend the roll DSKY step before the callout", () => {
    const step = APOLLO11_DESCENT_SCRIPT.steps.find((s) => s.id === "roll-windows-up")!;
    expect(step.notBeforeSinceIgnitionSec).toBe(milestoneSec("yaw-around"));
    const radar = APOLLO11_DESCENT_SCRIPT.steps.find((s) => s.id === "lr-accept")!;
    expect(radar.notBeforeSinceIgnitionSec).toBe(milestoneSec("radar-lock"));
  });

  it("holds the engine at ten percent for the first 26 seconds", () => {
    expect(throttleCeilingForSinceIgnition(0)).toBeCloseTo(0.1);
    expect(throttleCeilingForSinceIgnition(25 * S)).toBeCloseTo(0.1);
    expect(throttleCeilingForSinceIgnition(30 * S)).toBe(1);
  });
});
