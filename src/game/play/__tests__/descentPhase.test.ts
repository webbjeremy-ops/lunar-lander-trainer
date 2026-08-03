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
    expect(deg(p.pitchRad)).toBeLessThanOrEqual(57);
  });

  it("is nearly upright below low gate", () => {
    const p = descentPhaseFor(PHASE_LOW_GATE_M - 50);
    expect(p.id).toBe("landing");
    expect(deg(p.pitchRad)).toBeLessThan(18);
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

describe("P64 is automatic", () => {
  it("pitches over without a crew DSKY entry", () => {
    const held = descentPhaseFor(1_000, { p64Selected: false });
    const taken = descentPhaseFor(1_000, { p64Selected: true });
    expect(held.id).toBe("approach");
    expect(taken.pitchRad).toBeCloseTo(held.pitchRad);
  });

  it("follows the flown pitch curve down the approach", () => {
    const at = (ft: number) => deg(descentPhaseFor(ft * 0.3048).pitchRad);
    expect(at(7_129)).toBeCloseTo(55, 0);
    expect(at(5_000)).toBeCloseTo(42, 0);
    expect(at(3_000)).toBeCloseTo(36, 0);
    expect(at(1_000)).toBeCloseTo(27, 0);
    expect(at(600)).toBeCloseTo(19, 0);
  });
});
