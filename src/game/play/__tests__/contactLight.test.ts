// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CONTACT_PROBE_LENGTH_M, contactLightState } from "../contactLight";

describe("lunar contact light", () => {
  it("uses the 67-inch probe length", () => {
    expect(CONTACT_PROBE_LENGTH_M).toBeCloseTo(1.7, 6);
  });

  it("stays dark while the probes are clear of the surface", () => {
    const s = contactLightState({ altitudeM: 3, terminalState: null });
    expect(s.on).toBe(false);
    expect(s.metresToContactM).toBeCloseTo(1.3, 6);
  });

  it("lights the instant a probe touches", () => {
    expect(contactLightState({ altitudeM: 1.7, terminalState: null }).on).toBe(true);
    expect(contactLightState({ altitudeM: 0.4, terminalState: null }).metresToContactM).toBe(0);
  });

  it("latches on after touchdown and stays dark after a crash", () => {
    expect(contactLightState({ altitudeM: 0, terminalState: "landed" }).on).toBe(true);
    expect(contactLightState({ altitudeM: 0, terminalState: "crashed" }).on).toBe(false);
  });
});
