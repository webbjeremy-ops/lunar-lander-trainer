// SPDX-License-Identifier: GPL-3.0-or-later
// Roll cue, DSKY step gating and the DPS start profile all share one timebase.

import { describe, expect, it } from "vitest";
import { ROLL_CUE_SINCE_IGNITION_US } from "../descentRoll";
import { APOLLO11_DESCENT_CALLOUTS } from "../descentCallouts";
import { APOLLO11_DESCENT_SCRIPT } from "../procedures";
import { milestoneSec } from "../descentTimeline";
import {
  dpsThrottleEnvelope,
  throttleCeilingForSinceIgnition,
  THROTTLE_RECOVERY_SINCE_IGNITION_US,
} from "../ignitionSequence";

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

  it("flies the historical DPS throttle profile", () => {
    // 10 % for 26 s, FTP 92.5 % for the braking phase, then throttle recovery
    // at T+6:26 into the 10-60 % variable range.
    expect(dpsThrottleEnvelope(0)).toMatchObject({ min: 0.1, max: 0.1 });
    expect(dpsThrottleEnvelope(25 * S).max).toBeCloseTo(0.1);
    expect(dpsThrottleEnvelope(30 * S).max).toBeCloseTo(1);
    expect(dpsThrottleEnvelope(380 * S).min).toBeCloseTo(1);
    expect(THROTTLE_RECOVERY_SINCE_IGNITION_US / S).toBe(386);
    const after = dpsThrottleEnvelope(390 * S);
    expect(after.max).toBeCloseTo(0.65);
    expect(after.min).toBeCloseTo(0.1);
    expect(throttleCeilingForSinceIgnition(390 * S)).toBeCloseTo(0.65);
  });
});
