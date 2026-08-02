// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  DESCENT_DURATION_SEC,
  DESCENT_TIMELINE,
  currentMilestone,
  formatT,
  milestoneSec,
  nextMilestone,
  nominalStateAt,
} from "../descentTimeline";

const FT = 0.3048;
const NMI = 1852;

describe("canonical descent timeline", () => {
  it("is chronological and monotonically descends in altitude and range", () => {
    for (let i = 1; i < DESCENT_TIMELINE.length; i++) {
      const a = DESCENT_TIMELINE[i - 1]!;
      const b = DESCENT_TIMELINE[i]!;
      expect(b.tSec).toBeGreaterThan(a.tSec);
      expect(b.altitudeM).toBeLessThan(a.altitudeM);
      expect(b.rangeToLzM).toBeLessThan(a.rangeToLzM);
    }
  });

  it("puts high gate at T+507 s, ~7,600 ft and ~4.1 nmi from the site", () => {
    const hg = DESCENT_TIMELINE.find((e) => e.id === "high-gate")!;
    expect(hg.tSec).toBe(507);
    expect(hg.program).toBe("P64");
    expect(hg.altitudeM / FT).toBeCloseTo(7_600, 0);
    expect(hg.rangeToLzM / NMI).toBeCloseTo(4.1, 2);
    expect(hg.label).toContain("SETPOS2");
  });

  it("lands inside thirteen minutes of powered flight", () => {
    expect(DESCENT_DURATION_SEC).toBe(755);
    expect(DESCENT_DURATION_SEC).toBeLessThan(13 * 60);
  });

  it("interpolates the nominal profile between milestones", () => {
    const at = nominalStateAt(600);
    const hg = DESCENT_TIMELINE.find((e) => e.id === "high-gate")!;
    const lg = DESCENT_TIMELINE.find((e) => e.id === "low-gate")!;
    expect(at.altitudeM).toBeLessThan(hg.altitudeM);
    expect(at.altitudeM).toBeGreaterThan(lg.altitudeM);
    expect(at.program).toBe("P64");
    expect(nominalStateAt(0).altitudeM / FT).toBeCloseTo(49_971, 0);
    expect(nominalStateAt(10_000).altitudeM).toBe(0);
  });

  it("reports the current and next milestone", () => {
    expect(currentMilestone(510).id).toBe("high-gate");
    expect(nextMilestone(510)!.id).toBe("alarm-1201-first");
    expect(nextMilestone(1_000)).toBeNull();
    expect(milestoneSec("low-gate")).toBe(617);
    expect(formatT(507)).toBe("T+08:27");
  });
});
