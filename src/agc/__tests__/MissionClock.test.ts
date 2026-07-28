import { describe, it, expect } from "vitest";
import { MissionClock } from "../MissionClock";

describe("MissionClock", () => {
  it("advances by fixed 20ms ticks", () => {
    const c = new MissionClock();
    c.tick();
    c.tick();
    c.tick();
    // 3 * 20_000 us = 60_000 us
    expect(c.missionTimeUs()).toBe(60_000);
  });

  it("respects time scale for AGC step budget", () => {
    const c = new MissionClock();
    const stepsAt1x = c.stepsForNextTick();
    c.setTimeScale(4);
    const stepsAt4x = c.stepsForNextTick();
    expect(stepsAt4x).toBeGreaterThan(stepsAt1x);
    expect(stepsAt4x / stepsAt1x).toBeCloseTo(4, 0);
  });

  it("pause/resume restores nonzero scale", () => {
    const c = new MissionClock();
    c.setTimeScale(2);
    c.setTimeScale(0); // paused
    expect(c.stepsForNextTick()).toBe(0);
    c.resume();
    expect(c.stepsForNextTick()).toBeGreaterThan(0);
  });
});
