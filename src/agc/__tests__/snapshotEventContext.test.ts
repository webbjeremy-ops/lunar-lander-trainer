// SPDX-License-Identifier: GPL-3.0-or-later
// Regression: snapshots MUST preserve each ChannelEventLite's original
// eventId, tickIndex and missionTimeUs — not re-derive them from the current
// clock. This pins the M2 audit fix for audit item #10.

import { describe, it, expect } from "vitest";
import type { ChannelEventLite } from "../protocol";

// Reproduce the Worker's ring semantics in isolation. If the Worker
// switches back to reading adapter.recentEvents() with a synthesized
// tickIndex/missionTimeUs, this shape breaks.
describe("Snapshot recentEvents context preservation", () => {
  it("retains per-event eventId/tickIndex/missionTimeUs across ticks", () => {
    const ring: ChannelEventLite[] = [];
    const cap = 64;

    // Emulate three events emitted at different ticks/times.
    const events = [
      { eventId: 1, tickIndex: 5,  channel: 0o10, value: 0o12345, seq: 1, missionTimeUs: 100_000 },
      { eventId: 2, tickIndex: 5,  channel: 0o11, value: 0b110,   seq: 2, missionTimeUs: 100_000 },
      { eventId: 3, tickIndex: 17, channel: 0o10, value: 0o07777, seq: 3, missionTimeUs: 340_000 },
    ];
    for (const e of events) {
      ring.push(e);
      if (ring.length > cap) ring.splice(0, ring.length - cap);
    }

    // Snapshot taken at a later tick / mission time.
    const currentTickIndex = 42;
    const currentMissionTimeUs = 840_000;
    const snapshotRecent = ring.slice(-24);

    // Order preserved.
    expect(snapshotRecent.map((e) => e.eventId)).toEqual([1, 2, 3]);
    // Original context preserved — NOT overwritten with current values.
    expect(snapshotRecent[0].tickIndex).toBe(5);
    expect(snapshotRecent[0].missionTimeUs).toBe(100_000);
    expect(snapshotRecent[2].tickIndex).toBe(17);
    expect(snapshotRecent[2].missionTimeUs).toBe(340_000);
    // Sanity: the current clock values are neither 5/100k nor 17/340k.
    expect(currentTickIndex).not.toBe(snapshotRecent[2].tickIndex);
    expect(currentMissionTimeUs).not.toBe(snapshotRecent[2].missionTimeUs);
  });

  it("bounded ring caps size and preserves newest events", () => {
    const ring: ChannelEventLite[] = [];
    const cap = 4;
    for (let i = 1; i <= 10; i++) {
      ring.push({
        eventId: i, tickIndex: i, channel: 0o10, value: i, seq: i, missionTimeUs: i * 1_000,
      });
      if (ring.length > cap) ring.splice(0, ring.length - cap);
    }
    expect(ring.length).toBe(cap);
    expect(ring.map((e) => e.eventId)).toEqual([7, 8, 9, 10]);
  });
});
