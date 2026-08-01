// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  PHASE_HIGH_GATE_M,
  PHASE_LOW_GATE_M,
  descentPhaseFor,
  displayPitchRad,
} from "../descentPhase";

const deg = (r: number) => (r * 180) / Math.PI;

describe("descent attitude phases", () => {
  it("flies on its back through the braking phase", () => {
    const p = descentPhaseFor(15_240); // 50,000 ft
    expect(p.id).toBe("braking");
    expect(deg(p.pitchRad)).toBeGreaterThan(80);
  });

  it("pitches over at high gate", () => {
    const p = descentPhaseFor(PHASE_HIGH_GATE_M - 1);
    expect(p.id).toBe("approach");
    expect(deg(p.pitchRad)).toBeGreaterThan(40);
    expect(deg(p.pitchRad)).toBeLessThanOrEqual(55);
  });

  it("is nearly upright below low gate", () => {
    const p = descentPhaseFor(PHASE_LOW_GATE_M - 50);
    expect(p.id).toBe("landing");
    expect(deg(p.pitchRad)).toBeLessThan(12);
  });

  it("touchdown attitude is essentially vertical", () => {
    expect(deg(descentPhaseFor(0).pitchRad)).toBeLessThan(4);
  });

  it("guidance uses the nominal pitch; the pilot keeps authority", () => {
    expect(displayPitchRad(0, 12_000, false)).toBeCloseTo(
      descentPhaseFor(12_000).pitchRad,
    );
    const manual = displayPitchRad(0, 12_000, true);
    expect(manual).toBeLessThan(descentPhaseFor(12_000).pitchRad);
    expect(manual).toBeGreaterThan(0);
  });
});
