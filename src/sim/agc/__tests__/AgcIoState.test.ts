// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { AgcIoState } from "../AgcIoState";
import { DSKY_LAMPS } from "../AgcChannelRegistry";

describe("AgcIoState", () => {
  it("caches channel values and only reports changes", () => {
    const s = new AgcIoState({ now: () => 0 });
    expect(s.ingest(0o10, 0x1234)).toBe(true);
    expect(s.ingest(0o10, 0x1234)).toBe(false);
    expect(s.channel(0o10)).toBe(0x1234);
    expect(s.ingest(0o10, 0x0001)).toBe(true);
    expect(s.channel(0o10)).toBe(0x0001);
  });

  it("folds channel 011 lamp bits (COMP_ACTY, UPLINK_ACTY)", () => {
    const s = new AgcIoState({ now: () => 0 });
    // bits 2 and 3 of ch 011 → COMP_ACTY, UPLINK_ACTY
    s.ingest(0o11, 0b110);
    expect(s.lampBits() & DSKY_LAMPS.COMP_ACTY).toBeTruthy();
    expect(s.lampBits() & DSKY_LAMPS.UPLINK_ACTY).toBeTruthy();
    // clearing on ch 011 should clear those two but leave 0163 bits alone
    s.ingest(0o163, DSKY_LAMPS.RESTART);
    s.ingest(0o11, 0);
    expect(s.lampBits() & DSKY_LAMPS.COMP_ACTY).toBe(0);
    expect(s.lampBits() & DSKY_LAMPS.RESTART).toBeTruthy();
  });

  it("records events in a bounded ring buffer, newest first", () => {
    const s = new AgcIoState({ ringSize: 4, now: () => 0 });
    for (let i = 1; i <= 6; i++) s.ingest(0o10, i);
    const recent = s.recentEvents();
    expect(recent.map((e) => e.value)).toEqual([6, 5, 4, 3]);
    expect(s.totalEvents()).toBe(6);
  });

  it("reset() clears channels, lamps, and ring", () => {
    const s = new AgcIoState({ now: () => 0 });
    s.ingest(0o11, 0b110);
    s.ingest(0o10, 42);
    s.reset();
    expect(s.channel(0o10)).toBe(0);
    expect(s.lampBits()).toBe(0);
    expect(s.recentEvents().length).toBe(0);
  });
});
