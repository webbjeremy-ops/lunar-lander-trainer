// SPDX-License-Identifier: GPL-3.0-or-later
// M4.8 — Windows-up roll reducer.

import { describe, expect, it } from "vitest";
import {
  createDescentRollState,
  INITIAL_ROLL_DEG,
  radarAvailable,
  reduceDescentRoll,
  ROLL_CUE_SINCE_IGNITION_US,
  ROLL_RATE_DEG_PER_SEC,
  WINDOWS_UP_TOLERANCE_DEG,
  rollProgress,
  type DescentRollState,
} from "../descentRoll";

const STEP_US = 20_000;

function run(
  state: DescentRollState,
  seconds: number,
  sinceIgnitionStartUs = 0,
): DescentRollState {
  let s = state;
  let t = sinceIgnitionStartUs;
  const steps = Math.round((seconds * 1_000_000) / STEP_US);
  for (let i = 0; i < steps; i += 1) {
    t += STEP_US;
    s = reduceDescentRoll(s, { kind: "tick", dtUs: STEP_US, sinceIgnitionUs: t });
  }
  return s;
}

describe("descent roll", () => {
  it("starts windows-down with the radar unavailable", () => {
    const s = createDescentRollState();
    expect(s.rollDeg).toBe(INITIAL_ROLL_DEG);
    expect(s.phase).toBe("windows-down");
    expect(radarAvailable(s)).toBe(false);
    expect(rollProgress(s)).toBe(0);
  });

  it("does not roll unless the control is held", () => {
    const s = run(createDescentRollState(), 30);
    expect(s.rollDeg).toBe(INITIAL_ROLL_DEG);
    expect(radarAvailable(s)).toBe(false);
  });

  it("rolls at the modelled rate while commanded", () => {
    let s = reduceDescentRoll(createDescentRollState(), { kind: "roll", active: true });
    s = run(s, 5);
    expect(s.rollDeg).toBeCloseTo(INITIAL_ROLL_DEG - ROLL_RATE_DEG_PER_SEC * 5, 6);
    expect(s.phase).toBe("rolling");
  });

  it("reaches windows-up and latches, releasing the command", () => {
    let s = reduceDescentRoll(createDescentRollState(), { kind: "roll", active: true });
    s = run(s, INITIAL_ROLL_DEG / ROLL_RATE_DEG_PER_SEC + 1);
    expect(s.phase).toBe("windows-up");
    expect(s.commanded).toBe(false);
    expect(WINDOWS_UP_TOLERANCE_DEG).toBeGreaterThan(0);
    expect(s.rollDeg).toBe(0);
    expect(radarAvailable(s)).toBe(true);
    expect(s.completedSinceIgnitionUs).not.toBeNull();
    // Further ticks cannot roll past windows-up.
    const after = run(s, 10);
    expect(after.rollDeg).toBe(s.rollDeg);
  });

  it("gives the crew roll cue once, at the historical point in the burn", () => {
    const before = run(createDescentRollState(), 10);
    expect(before.cueGiven).toBe(false);
    const after = run(
      createDescentRollState(),
      2,
      ROLL_CUE_SINCE_IGNITION_US - 1_000_000,
    );
    expect(after.cueGiven).toBe(true);
  });

  it("is a pure reducer — identical inputs give identical output", () => {
    const a = run(reduceDescentRoll(createDescentRollState(), { kind: "roll", active: true }), 7);
    const b = run(reduceDescentRoll(createDescentRollState(), { kind: "roll", active: true }), 7);
    expect(a).toEqual(b);
  });
});
