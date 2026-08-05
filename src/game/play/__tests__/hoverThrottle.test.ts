// SPDX-License-Identifier: GPL-3.0-or-later
// M4.66 — hover-throttle mark.

import { describe, expect, it } from "vitest";
import {
  hoverThrottleFraction,
  hoverThrottleIsCommandable,
  LUNAR_SURFACE_GRAVITY_MPS2,
} from "../hoverThrottle";

describe("hoverThrottleFraction", () => {
  it("uses lunar surface gravity near 1.62 m/s²", () => {
    expect(LUNAR_SURFACE_GRAVITY_MPS2).toBeGreaterThan(1.6);
    expect(LUNAR_SURFACE_GRAVITY_MPS2).toBeLessThan(1.65);
  });

  it("is about 54% at the PDI mass", () => {
    const f = hoverThrottleFraction(15_103);
    expect(f).toBeGreaterThan(0.5);
    expect(f).toBeLessThan(0.58);
  });

  it("is about 25% with the descent tanks nearly dry", () => {
    const f = hoverThrottleFraction(6_980);
    expect(f).toBeGreaterThan(0.23);
    expect(f).toBeLessThan(0.27);
    // 26% commanded at that mass climbs — the reported behaviour.
    expect(0.26).toBeGreaterThan(f);
  });

  it("falls as mass falls", () => {
    expect(hoverThrottleFraction(10_000)).toBeLessThan(hoverThrottleFraction(12_000));
  });

  it("is zero for non-physical mass", () => {
    expect(hoverThrottleFraction(0)).toBe(0);
    expect(hoverThrottleFraction(Number.NaN)).toBe(0);
  });

  it("only reports a commandable mark inside the DPS band", () => {
    expect(hoverThrottleIsCommandable(hoverThrottleFraction(6_980))).toBe(true);
    expect(hoverThrottleIsCommandable(0.05)).toBe(false);
    expect(hoverThrottleIsCommandable(1.4)).toBe(false);
  });
});
