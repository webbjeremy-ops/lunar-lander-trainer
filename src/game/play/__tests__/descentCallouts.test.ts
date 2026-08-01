// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  APOLLO11_DESCENT_CALLOUTS,
  activeCallout,
  triggeredCallouts,
} from "../descentCallouts";
import {
  APOLLO11_ALARM_TIMELINE,
  createProgramAlarmState,
  reduceProgramAlarms,
} from "../programAlarms";

const S = 1_000_000;

describe("descent callouts", () => {
  it("stays silent before ignition", () => {
    expect(
      triggeredCallouts({ sinceIgnitionUs: 0, altitudeM: 15_000, burning: false }),
    ).toHaveLength(0);
  });

  it("raises the roll call on the time trigger", () => {
    const call = activeCallout(
      { sinceIgnitionUs: 210 * S, altitudeM: 12_000, burning: true },
      [],
    );
    expect(call?.id).toBe("roll-windows-up");
    expect(call?.action).toBe("roll");
  });

  it("never runs a call ahead of the canonical timeline", () => {
    // Low altitude early in the burn must NOT drag high gate forward: the
    // transcript follows the 13-minute timeline, in order.
    const fired = triggeredCallouts({
      sinceIgnitionUs: 5 * S,
      altitudeM: 600 * 0.3048,
      burning: true,
    }).map((c) => c.id);
    expect(fired).not.toContain("high-gate");
    expect(fired).toEqual(["ignition"]);
  });

  it("fires calls in strict flight order", () => {
    const fired = triggeredCallouts({
      sinceIgnitionUs: 560 * S,
      altitudeM: 900,
      burning: true,
    }).map((c) => c.id);
    const order = APOLLO11_DESCENT_CALLOUTS.map((c) => c.id);
    expect(fired).toEqual(order.slice(0, fired.length));
    expect(fired).toContain("high-gate");
  });

  it("makes a call anyway once the geometry grace period expires", () => {
    const fired = triggeredCallouts({
      // Shallow trajectory: still high at high-gate time, but the clock wins
      // after the grace window so the script cannot stall.
      sinceIgnitionUs: (514 + 46) * S,
      altitudeM: 9_000,
      burning: true,
    }).map((c) => c.id);
    expect(fired).toContain("high-gate");
  });

  it("moves to the next call once acknowledged", () => {
    const input = { sinceIgnitionUs: 210 * S, altitudeM: 12_000, burning: true };
    const first = activeCallout(input, [])!;
    const next = activeCallout(input, [first.id]);
    expect(next?.id).not.toBe(first.id);
  });


  it("every callout carries guidance and teaching", () => {
    for (const c of APOLLO11_DESCENT_CALLOUTS) {
      expect(c.guidance.length).toBeGreaterThan(10);
      expect(c.teaching.length).toBeGreaterThan(10);
    }
  });
});

describe("altitude-triggered program alarms", () => {
  it("raises the first 1202 on altitude even when the clock is early", () => {
    const def = APOLLO11_ALARM_TIMELINE[0]!;
    const next = reduceProgramAlarms(createProgramAlarmState(), {
      kind: "tick",
      sinceIgnitionUs: 10 * S,
      altitudeFt: (def.belowAltitudeFt ?? 0) - 1,
    });
    expect(next.active?.code).toBe("1202");
    expect(next.lampOn).toBe(true);
  });

  it("still raises on time when no altitude is supplied", () => {
    const def = APOLLO11_ALARM_TIMELINE[0]!;
    const next = reduceProgramAlarms(createProgramAlarmState(), {
      kind: "tick",
      sinceIgnitionUs: def.atSinceIgnitionSec * S,
    });
    expect(next.active?.id).toBe(def.id);
  });
});
