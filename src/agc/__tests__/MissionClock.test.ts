import { describe, it, expect } from "vitest";
import { MissionClock, TICK_MICROS } from "../MissionClock";

describe("MissionClock", () => {
  it("advances by fixed 20ms ticks", () => {
    const c = new MissionClock();
    c.stepOneTick(() => {});
    c.stepOneTick(() => {});
    c.stepOneTick(() => {});
    expect(c.getMissionTimeUs()).toBe(TICK_MICROS * 3n);
  });

  it("steps AGC by whole 11.720us instructions per tick", () => {
    const c = new MissionClock();
    const stepsSeen: number[] = [];
    c.stepOneTick((s) => stepsSeen.push(s));
    // 20_000_000 ns / 11_720 ns = 1706 with remainder
    expect(stepsSeen[0]).toBe(1706);
  });

  it("pause/resume restores nonzero scale", () => {
    const c = new MissionClock();
    c.setTimeScale(4);
    c.setTimeScale(0);
    expect(c.isPaused()).toBe(true);
    c.resume();
    expect(c.isPaused()).toBe(false);
    expect(c.getTimeScale()).toBe(4);
  });

  it("wall-clock advance is scale-linear and never negative", () => {
    let t = 0;
    const c = new MissionClock({ now: () => t });
    c.setTimeScale(1);
    c.advanceByWallClock(() => {}); // anchor
    t += 100; // 100ms real
    const n1x = c.advanceByWallClock(() => {});
    expect(n1x).toBe(5); // 100ms / 20ms per tick

    c.reset();
    t = 0;
    c.setTimeScale(2);
    c.advanceByWallClock(() => {});
    t += 100;
    const n2x = c.advanceByWallClock(() => {});
    expect(n2x).toBe(10);
  });
});
