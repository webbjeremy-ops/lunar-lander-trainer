// SPDX-License-Identifier: GPL-3.0-or-later
// M4.13B — descent-sequence clock state machine.

import { describe, expect, it } from "vitest";
import {
  createDescentClockState,
  descentClockStatusLabel,
  formatDescentClock,
  stepDescentClock,
  type DescentClockInput,
} from "../descentClock";

const STEP = 20_000;

function input(over: Partial<DescentClockInput> = {}): DescentClockInput {
  return {
    ritualSinceIgnitionUs: 0,
    countdownArmed: false,
    countdownAborted: false,
    engineBurning: false,
    flightLockReleased: false,
    stepUs: STEP,
    ...over,
  };
}

describe("descent clock", () => {
  it("stays idle before the descent starts", () => {
    const s = stepDescentClock(createDescentClockState(), input());
    expect(s.mode).toBe("idle");
    expect(s.sinceIgnitionUs).toBe(0);
    expect(descentClockStatusLabel(s)).toBe("SEQUENCE IDLE");
  });

  it("holds at zero while the countdown runs pre-TIG", () => {
    let s = createDescentClockState();
    for (let i = 0; i < 50; i += 1) {
      s = stepDescentClock(s, input({ countdownArmed: true }));
    }
    expect(s.mode).toBe("held");
    expect(s.sinceIgnitionUs).toBe(0);
    expect(formatDescentClock(s)).toBe("T+00:00");
  });

  it("mirrors the PDI ritual clock once ignition happens", () => {
    let s = stepDescentClock(createDescentClockState(), input({ countdownArmed: true }));
    s = stepDescentClock(
      s,
      input({ countdownArmed: true, ritualSinceIgnitionUs: 40_000, engineBurning: true }),
    );
    expect(s.mode).toBe("running");
    expect(s.ritual).toBe(true);
    expect(s.sinceIgnitionUs).toBe(40_000);
  });

  it("free-runs when the player skips the ritual and just lights the engine", () => {
    let s = createDescentClockState();
    s = stepDescentClock(s, input({ engineBurning: true }));
    s = stepDescentClock(s, input({ engineBurning: true }));
    expect(s.mode).toBe("running");
    expect(s.ritual).toBe(false);
    expect(s.sinceIgnitionUs).toBe(2 * STEP);
  });

  it("free-runs after the countdown is aborted", () => {
    let s = stepDescentClock(createDescentClockState(), input({ countdownArmed: true }));
    expect(s.mode).toBe("held");
    s = stepDescentClock(s, input({ countdownArmed: true, countdownAborted: true }));
    expect(s.mode).toBe("running");
    expect(s.sinceIgnitionUs).toBe(STEP);
  });

  it("starts on flight-lock release with no ritual at all", () => {
    const s = stepDescentClock(createDescentClockState(), input({ flightLockReleased: true }));
    expect(s.mode).toBe("running");
    expect(s.sinceIgnitionUs).toBe(STEP);
  });

  it("is monotonic once running, even if the engine is shut down", () => {
    let s = stepDescentClock(createDescentClockState(), input({ engineBurning: true }));
    s = stepDescentClock(s, input({ countdownArmed: true }));
    s = stepDescentClock(s, input());
    expect(s.mode).toBe("running");
    expect(s.sinceIgnitionUs).toBe(3 * STEP);
  });

  it("formats T+MM:SS", () => {
    let s = createDescentClockState();
    for (let i = 0; i < 50 * 75; i += 1) s = stepDescentClock(s, input({ engineBurning: true }));
    expect(formatDescentClock(s)).toBe("T+01:15");
    expect(descentClockStatusLabel(s)).toBe("SEQUENCE RUNNING");
  });
});
