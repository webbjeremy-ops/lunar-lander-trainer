import { describe, expect, it } from "vitest";
import {
  milestoneById,
  nominalAltitudeForRangeM,
} from "@/game/play/descentTimeline";

/**
 * The dotted blue reference curve in the profile inset samples
 * nominalAltitudeForRangeM, so it must pass exactly through the as-flown
 * gates rather than an independent approximation.
 */
describe("reference descent profile", () => {
  it("passes through high gate", () => {
    const gate = milestoneById("high-gate")!;
    expect(nominalAltitudeForRangeM(gate.rangeToLzM)).toBeCloseTo(
      gate.altitudeM,
      3,
    );
  });

  it("passes through low gate", () => {
    const gate = milestoneById("low-gate")!;
    expect(nominalAltitudeForRangeM(gate.rangeToLzM)).toBeCloseTo(
      gate.altitudeM,
      3,
    );
  });

  it("reaches the surface at zero range", () => {
    expect(nominalAltitudeForRangeM(0)).toBe(0);
  });

  it("holds the first milestone altitude beyond the table", () => {
    const first = milestoneById("high-gate")!;
    const far = nominalAltitudeForRangeM(1e9);
    expect(far).toBeGreaterThan(first.altitudeM);
    expect(Number.isFinite(far)).toBe(true);
  });
});
