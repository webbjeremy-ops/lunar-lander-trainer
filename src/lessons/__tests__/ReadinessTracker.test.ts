// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { ReadinessTracker } from "../ReadinessTracker";
import { makeEmptyDecodedDsky, decodedDskyCanonical } from "@/agc/dsky/DskyDecoder";
import type { ChannelEventLite, EventBoundaryPayload } from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";

/** Build a channel-010 word with selector `sel`, sign=0, codes=(a,b). */
function ch010Word(sel: number, a = 0, b = 0): number {
  return ((sel & 0x0f) << 11) | ((a & 0x1f) << 5) | (b & 0x1f);
}

/** Channel 0163 word that sets/clears the RESTART annunciator (bit 0x20). */
function ch0163Restart(on: boolean): number {
  return on ? 0x20 : 0x00;
}

let eid = 1000;
function ev(channel: number, value: number, tick: number): ChannelEventLite {
  return {
    eventId: ++eid,
    tickIndex: tick,
    channel,
    value,
    seq: eid,
    missionTimeUs: tick * 20000,
  };
}

function baseline(decoded: DecodedDsky, boundaryEventId = 999, tickIndex = 100): EventBoundaryPayload {
  return {
    boundaryEventId,
    tickIndex,
    missionTimeUs: tickIndex * 20000,
    totalAgcSteps: 0,
    decodedDsky: decoded,
    decodedDskyChecksum: decodedDskyCanonical(decoded),
  };
}

describe("ReadinessTracker", () => {
  it("stays not-ready when RESTART is still asserted", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec));
    // Drive many complete scans while RESTART is still on.
    for (let i = 0; i < 10; i++) {
      for (let s = 1; s <= 11; s++) t.applyChannelEvent(ev(0o10, ch010Word(s), 200 + i));
    }
    expect(t.isReady()).toBe(false);
    expect(t.snapshot().restartCleared).toBe(false);
  });

  it("requires a scan-complete after RESTART clears (clear alone is insufficient)", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec));
    t.applyChannelEvent(ev(0o163, ch0163Restart(false), 210));
    expect(t.snapshot().restartCleared).toBe(true);
    expect(t.isReady()).toBe(false); // no scans yet
    // One complete scan still insufficient (need two + stability).
    for (let s = 1; s <= 11; s++) t.applyChannelEvent(ev(0o10, ch010Word(s), 220));
    expect(t.isReady()).toBe(false);
  });

  it("becomes ready after two consecutive identical scans post-restart", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec));
    t.applyChannelEvent(ev(0o163, ch0163Restart(false), 210));
    // Two identical scans (same codes).
    for (let scan = 0; scan < 2; scan++) {
      for (let s = 1; s <= 11; s++) t.applyChannelEvent(ev(0o10, ch010Word(s, 1, 2), 220 + scan));
    }
    const snap = t.snapshot();
    expect(snap.scansAfterRestart).toBe(2);
    expect(snap.stableConsecutiveScans).toBe(1);
    expect(snap.restartCleared).toBe(true);
    expect(t.isReady()).toBe(true);
  });

  it("regressing back into RESTART cancels readiness", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    t.noteBaseline(baseline(dec)); // starts with restart=false, so seeded cleared
    for (let scan = 0; scan < 2; scan++) {
      for (let s = 1; s <= 11; s++) t.applyChannelEvent(ev(0o10, ch010Word(s), 300 + scan));
    }
    expect(t.isReady()).toBe(true);
    t.applyChannelEvent(ev(0o163, ch0163Restart(true), 400));
    expect(t.isReady()).toBe(false);
    expect(t.snapshot().restartCleared).toBe(false);
  });

  it("ignores channel events at or before the baseline event id", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec, 5000, 100));
    const stale: ChannelEventLite = {
      eventId: 5000, tickIndex: 100, channel: 0o163, value: 0, seq: 5000, missionTimeUs: 0,
    };
    t.applyChannelEvent(stale);
    expect(t.snapshot().restartCleared).toBe(false);
  });
});
