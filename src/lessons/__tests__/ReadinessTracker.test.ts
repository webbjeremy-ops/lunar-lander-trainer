// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { ReadinessTracker, readinessProjectionCanonical } from "../ReadinessTracker";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import { decodedDskyCanonical } from "@/agc/dsky/DskyDecoder";
import { V35_READINESS_QUIET_TICKS } from "../fixtureExpectations";
import type { ChannelEventLite, EventBoundaryPayload } from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";

/** Channel 0163 word toggling the RESTART annunciator (bit 0o200). */
function ch0163Restart(on: boolean): number {
  return on ? 0o200 : 0o000;
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

function baseline(
  decoded: DecodedDsky,
  opts: { boundaryEventId?: number; tickIndex?: number; totalAgcSteps?: number } = {},
): EventBoundaryPayload {
  const tickIndex = opts.tickIndex ?? 100;
  const boundaryEventId = opts.boundaryEventId ?? 999;
  const totalAgcSteps = opts.totalAgcSteps ?? 10_000;
  return {
    boundaryEventId,
    tickIndex,
    missionTimeUs: tickIndex * 20000,
    totalAgcSteps,
    decodedDsky: decoded,
    decodedDskyChecksum: decodedDskyCanonical(decoded),
  };
}

/** Advance the tracker by `n` ticks with AGC steps advancing 1000/step. */
function advanceQuietTicks(t: ReadinessTracker, from: number, n: number, stepBase = 10_000): void {
  for (let i = 1; i <= n; i++) {
    t.noteTickAdvance({
      tickIndex: from + i,
      missionTimeUs: (from + i) * 20000,
      totalAgcSteps: stepBase + i * 1000,
    });
  }
}

describe("readinessProjectionCanonical", () => {
  it("ignores COMP ACTY, UPLINK ACTY, and Verb/Noun FLASH", () => {
    const a = makeEmptyDecodedDsky();
    const b = makeEmptyDecodedDsky();
    b.annunciators.compActy = true;
    b.annunciators.uplinkActy = true;
    b.annunciators.verbNounFlash = true;
    expect(readinessProjectionCanonical(a)).toEqual(readinessProjectionCanonical(b));
  });

  it("detects material annunciator changes (e.g. RESTART)", () => {
    const a = makeEmptyDecodedDsky();
    const b = makeEmptyDecodedDsky();
    b.annunciators.restart = true;
    expect(readinessProjectionCanonical(a)).not.toEqual(readinessProjectionCanonical(b));
  });

  it("detects digit changes", () => {
    const a = makeEmptyDecodedDsky();
    const b = makeEmptyDecodedDsky();
    b.verb.digits[0] = { value: 3, segments: 0x7f };
    expect(readinessProjectionCanonical(a)).not.toEqual(readinessProjectionCanonical(b));
  });
});

describe("ReadinessTracker", () => {
  it("stays not-ready when RESTART is asserted", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec));
    advanceQuietTicks(t, 100, V35_READINESS_QUIET_TICKS + 5);
    expect(t.isReady()).toBe(false);
    expect(t.snapshot().blockingReason).toBe("restart-asserted");
  });

  it("stays not-ready when STANDBY is asserted", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.standby = true;
    t.noteBaseline(baseline(dec));
    advanceQuietTicks(t, 100, V35_READINESS_QUIET_TICKS + 5);
    expect(t.isReady()).toBe(false);
    expect(t.snapshot().blockingReason).toBe("standby-asserted");
  });

  it("becomes ready with a settled baseline and a full quiet window (no ch010 recurrence needed)", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    // Blank, settled baseline — mirrors the committed V35 pre-command state.
    t.noteBaseline(baseline(dec, { tickIndex: 6, totalAgcSteps: 5_000 }));
    expect(t.snapshot().restartCleared).toBe(true);
    advanceQuietTicks(t, 6, V35_READINESS_QUIET_TICKS, 5_000);
    expect(t.isReady()).toBe(true);
  });

  it("RESTART clearing via a channel event is sufficient without repeated selector-11 scans", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec, { tickIndex: 100, totalAgcSteps: 5_000 }));
    t.applyChannelEvent(ev(0o163, ch0163Restart(false), 105));
    // Zero recurrence of selector 11 — pure quiet window advance.
    advanceQuietTicks(t, 105, V35_READINESS_QUIET_TICKS, 5_000);
    expect(t.isReady()).toBe(true);
  });

  it("relevant projection changes reset the quiet window", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    t.noteBaseline(baseline(dec, { tickIndex: 100, totalAgcSteps: 5_000 }));
    advanceQuietTicks(t, 100, V35_READINESS_QUIET_TICKS - 1, 5_000);
    // Assert RESTART via ch0163 — a decoder-material annunciator change.
    t.applyChannelEvent(ev(0o163, ch0163Restart(true), 100 + V35_READINESS_QUIET_TICKS));
    expect(t.snapshot().quietTicks).toBe(0);
    expect(t.isReady()).toBe(false);
  });

  it("COMP ACTY / UPLINK ACTY / FLASH toggles do NOT reset the quiet window", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    t.noteBaseline(baseline(dec, { tickIndex: 100, totalAgcSteps: 5_000 }));
    // Ch011 has compActy bit; toggle it mid-window.
    advanceQuietTicks(t, 100, 5, 5_000);
    // Channel 011 word that flips compActy. From CH011 masks (bit 0o2 in yaDSKY2).
    t.applyChannelEvent(ev(0o11, 0o2, 105));
    advanceQuietTicks(t, 105, V35_READINESS_QUIET_TICKS - 5, 10_000);
    expect(t.isReady()).toBe(true);
  });

  it("stalled AGC steps block readiness even if ticks advance", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    t.noteBaseline(baseline(dec, { tickIndex: 100, totalAgcSteps: 5_000 }));
    for (let i = 1; i <= V35_READINESS_QUIET_TICKS + 5; i++) {
      t.noteTickAdvance({
        tickIndex: 100 + i,
        missionTimeUs: (100 + i) * 20000,
        totalAgcSteps: 5_000, // never advances
      });
    }
    expect(t.isReady()).toBe(false);
    // Steps only advance = baseline count; blocking reason should mention it.
    const s = t.snapshot();
    expect(s.quietTicks).toBe(0);
  });

  it("ignores channel events at or before the baseline event id", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    dec.annunciators.restart = true;
    t.noteBaseline(baseline(dec, { boundaryEventId: 5000, tickIndex: 100 }));
    const stale: ChannelEventLite = {
      eventId: 5000, tickIndex: 100, channel: 0o163, value: 0, seq: 5000, missionTimeUs: 0,
    };
    t.applyChannelEvent(stale);
    expect(t.snapshot().restartCleared).toBe(false);
  });

  it("reset() cancels a gated attempt", () => {
    const t = new ReadinessTracker();
    const dec = makeEmptyDecodedDsky();
    t.noteBaseline(baseline(dec, { tickIndex: 100 }));
    advanceQuietTicks(t, 100, V35_READINESS_QUIET_TICKS);
    expect(t.isReady()).toBe(true);
    t.reset();
    expect(t.isReady()).toBe(false);
    expect(t.snapshot().seeded).toBe(false);
  });
});
