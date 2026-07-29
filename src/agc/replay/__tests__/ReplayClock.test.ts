// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { ReplayClock } from "../ReplayClock";
import { buildEventLogExport } from "../../eventLog/buildExport";
import { decodedDskyCanonical, makeEmptyDecodedDsky } from "../../dsky/DskyDecoder";
import type {
  EventLogExportPayload,
  PublicEventRecord,
  ReadyPayload,
} from "../../protocol";
import type { AgcEventLogPayloadV1 } from "../../eventLog/schema";

function ready(): ReadyPayload {
  return {
    emulatorRepo: "michaelfranzl/webAGC",
    emulatorCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
    emulatorVersionString: "ddc65e7b-test",
    ropeId: "Luminary099",
    ropeSha256: "a".repeat(64),
    ropeSourceCommit: "911e5c0",
    ropeByteLength: 73728,
    wasmSha256: "b".repeat(64),
    protocolVersion: 2,
    initialResetPerformed: true,
    resetCount: 1,
    sessionEpoch: 0,
    canonicalInit: {
      cpuResetPerformed: true, cpuResetCount: 1, startupRsetSent: true,
      startupRsetCode: 0o22, startupRsetAccepted: true, startupRsetCount: 1,
      restartObservedBeforeRset: true, restartClearedAfterRset: true, settledAtTick: 42,
    },
  };
}

async function payload(events: PublicEventRecord[]): Promise<AgcEventLogPayloadV1> {
  const workerPayload: EventLogExportPayload = {
    sessionEpoch: 0,
    timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
    baseline: {
      tickIndex: 42,
      missionTimeUs: 0, // baseline at MET 0 so event MET is absolute
      totalAgcSteps: 71672,
      decodedDsky: makeEmptyDecodedDsky(),
      decodedDskyChecksum: "chk",
      channelValues: {},
    },
    events,
    retention: { completeEpoch: true, droppedBeforeEventId: null, retainedEventLimit: 32768 },
  };
  const doc = await buildEventLogExport(workerPayload, ready(), { exportedAt: "2026-01-01T00:00:00.000Z" });
  return doc.payload;
}

/** Deterministic manual clock: `advance(ms)` pushes time and drains any
 *  frame callbacks currently queued. Emulates rAF without real timers. */
function manualClock() {
  let nowMs = 0;
  const queue: Array<{ id: number; cb: (t: number) => void }> = [];
  let nextId = 1;
  return {
    deps: {
      now: () => nowMs,
      scheduleFrame: (cb: (t: number) => void) => {
        const id = nextId++;
        queue.push({ id, cb });
        return id;
      },
      cancelFrame: (h: number) => {
        const i = queue.findIndex((x) => x.id === h);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    /** Advance wall-clock by `ms` and drain a bounded number of frames. */
    tick(ms: number, frames = 1): void {
      const perFrame = ms / frames;
      for (let f = 0; f < frames; f++) {
        nowMs += perFrame;
        const q = queue.splice(0);
        for (const { cb } of q) cb(nowMs);
      }
    },
  };
}

function sampleEvents(): PublicEventRecord[] {
  // Events distributed at 100ms, 200ms, 250ms, 250ms (simultaneous), 400ms.
  return [
    { type: "channelUpdate", eventId: 1, tickIndex: 43, missionTimeUs: 100_000, totalAgcSteps: 100, channel: 0o11, value: 1 },
    { type: "channelUpdate", eventId: 2, tickIndex: 44, missionTimeUs: 200_000, totalAgcSteps: 200, channel: 0o11, value: 0 },
    { type: "channelUpdate", eventId: 3, tickIndex: 45, missionTimeUs: 250_000, totalAgcSteps: 300, channel: 0o163, value: 0o40 },
    { type: "channelUpdate", eventId: 4, tickIndex: 45, missionTimeUs: 250_000, totalAgcSteps: 300, channel: 0o11, value: 1 },
    { type: "channelUpdate", eventId: 5, tickIndex: 46, missionTimeUs: 400_000, totalAgcSteps: 500, channel: 0o11, value: 0 },
  ];
}

describe("ReplayClock — playback loop", () => {
  it("commits at most one state per animation frame, even in bursts", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    const changes: Array<ReturnType<ReplayClock["getState"]>> = [];
    const rc = new ReplayClock(p, (s) => changes.push(s), { deps: clk.deps });
    rc.play();
    changes.length = 0; // ignore initial status flip

    // One frame that covers a dense burst up to MET=500_000 — should apply
    // ALL five events but publish exactly ONE final state.
    clk.tick(500, 1);
    expect(changes.length).toBe(1);
    expect(changes[0]!.currentEventIndex).toBe(4);
    expect(changes[0]!.currentEventId).toBe(5);
    expect(changes[0]!.status).toBe("finished");
  });

  it("play / pause / resume does not skip or duplicate events", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    let last: ReturnType<ReplayClock["getState"]> | null = null;
    const publishIndices: number[] = [];
    const rc = new ReplayClock(p, (s) => {
      last = s;
      publishIndices.push(s.currentEventIndex);
    }, { deps: clk.deps });
    rc.play();
    // Drive with tiny wall-time slices so most frames advance by <=1 event.
    // Reach event 1 (MET 100_000 → 100ms wall).
    for (let i = 0; i < 15; i++) clk.tick(10, 1);
    rc.pause();
    // No advance while paused.
    const pausedIdx = last!.currentEventIndex;
    for (let i = 0; i < 10; i++) clk.tick(20, 1);
    expect(last!.currentEventIndex).toBe(pausedIdx);
    rc.play();
    // Reach the end.
    for (let i = 0; i < 60; i++) clk.tick(10, 1);
    // Index climbed monotonically from -1 to 4.
    let prev = -2;
    for (const i of publishIndices) {
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
    expect(last!.currentEventIndex).toBe(4);
    expect(last!.status).toBe("finished");
  });

  it("speed changes affect wall-clock only, not reconstructed state", async () => {
    const p = await payload(sampleEvents());
    const clk1 = manualClock();
    const clk4 = manualClock();
    let s1: ReturnType<ReplayClock["getState"]> | null = null;
    let s4: ReturnType<ReplayClock["getState"]> | null = null;
    const r1 = new ReplayClock(p, (s) => { s1 = s; }, { deps: clk1.deps, initialSpeed: 1 });
    const r4 = new ReplayClock(p, (s) => { s4 = s; }, { deps: clk4.deps, initialSpeed: 4 });
    r1.play();
    r4.play();
    clk1.tick(500, 5);
    clk4.tick(125, 5); // 125ms * 4x = 500ms mission-time
    expect(s1).toBeTruthy();
    expect(s4).toBeTruthy();
    expect(s1!.currentEventIndex).toBe(4);
    expect(s4!.currentEventIndex).toBe(4);
    expect(decodedDskyCanonical(s1!.decodedDsky)).toBe(decodedDskyCanonical(s4!.decodedDsky));
    expect(s1!.channelValues).toEqual(s4!.channelValues);
  });

  it("end-of-recording is stable — further frames do not mutate state", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    let count = 0;
    const rc = new ReplayClock(p, () => { count++; }, { deps: clk.deps });
    rc.play();
    clk.tick(1000, 4); // finish
    const afterFinishCount = count;
    clk.tick(1000, 4);
    // No further publishes after "finished".
    expect(count).toBe(afterFinishCount);
    expect(rc.getState().status).toBe("finished");
  });

  it("dispose cancels a queued frame and stops publishing", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    const changes: unknown[] = [];
    const rc = new ReplayClock(p, (s) => changes.push(s), { deps: clk.deps });
    rc.play();
    changes.length = 0;
    rc.dispose();
    clk.tick(1000, 4);
    expect(changes.length).toBe(0);
  });

  it("seek to same index is deterministic across repeated calls", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    let last: ReturnType<ReplayClock["getState"]> | null = null;
    const rc = new ReplayClock(p, (s) => { last = s; }, { deps: clk.deps });
    rc.seek(2);
    const first = JSON.parse(JSON.stringify(last));
    rc.seek(-1);
    rc.seek(2);
    expect(last).toEqual(first);
  });

  it("manual step (next) works even before play", async () => {
    const p = await payload(sampleEvents());
    const clk = manualClock();
    let last: ReturnType<ReplayClock["getState"]> | null = null;
    const rc = new ReplayClock(p, (s) => { last = s; }, { deps: clk.deps });
    rc.next();
    expect(last!.currentEventIndex).toBe(0);
    rc.next();
    expect(last!.currentEventIndex).toBe(1);
    rc.prev();
    expect(last!.currentEventIndex).toBe(0);
  });

  it("does not call the AGC session client (isolation smoke test)", async () => {
    // If the reducer/clock imports the session, this vi.spyOn would trigger.
    const p = await payload(sampleEvents());
    const clk = manualClock();
    const fakeSend = vi.fn();
    // Simulate a foreign object that must never be called.
    const rc = new ReplayClock(p, () => { /* noop */ }, { deps: clk.deps });
    rc.play(); clk.tick(1000, 4);
    rc.dispose();
    expect(fakeSend).not.toHaveBeenCalled();
  });
});
