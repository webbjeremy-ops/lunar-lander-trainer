// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { buildEventLogExport, suggestedFileName } from "../buildExport";
import { canonicalSha256 } from "../canonical";
import { makeEmptyDecodedDsky } from "../../dsky/DskyDecoder";
import type {
  EventLogExportPayload,
  PublicEventRecord,
  ReadyPayload,
} from "../../protocol";

function makeReady(overrides: Partial<ReadyPayload> = {}): ReadyPayload {
  return {
    emulatorRepo: "michaelfranzl/webAGC",
    emulatorCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
    emulatorVersionString: "ddc65e7b-test",
    ropeId: "Luminary099",
    ropeSha256: "a".repeat(64),
    ropeSourceCommit: "911e5c0" ,
    ropeByteLength: 73728,
    wasmSha256: "b".repeat(64),
    protocolVersion: 2,
    initialResetPerformed: true,
    resetCount: 1,
    sessionEpoch: 0,
    canonicalInit: {
      cpuResetPerformed: true,
      cpuResetCount: 1,
      startupRsetSent: true,
      startupRsetCode: 0o22,
      startupRsetAccepted: true,
      startupRsetCount: 1,
      restartObservedBeforeRset: true,
      restartClearedAfterRset: true,
      settledAtTick: 42,
    },
    ...overrides,
  };
}

function makeWorkerPayload(events: PublicEventRecord[], overrides: Partial<EventLogExportPayload> = {}): EventLogExportPayload {
  const empty = makeEmptyDecodedDsky();
  return {
    sessionEpoch: 0,
    timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
    baseline: {
      tickIndex: 42,
      missionTimeUs: 840000,
      totalAgcSteps: 71672,
      decodedDsky: empty,
      decodedDskyChecksum: "chk-empty",
      channelValues: { "8": 0, "11": 0, "163": 0 },
    },
    events,
    retention: {
      completeEpoch: true,
      droppedBeforeEventId: null,
      retainedEventLimit: 32768,
    },
    ...overrides,
  };
}

describe("buildEventLogExport", () => {
  it("wraps a worker payload into the versioned envelope", async () => {
    const events: PublicEventRecord[] = [
      { type: "inputAccepted", eventId: 1, tickIndex: 43, missionTimeUs: 860000, totalAgcSteps: 71800, kind: "dskyKeyDown", keyCode: 0o27 },
      { type: "channelUpdate", eventId: 2, tickIndex: 43, missionTimeUs: 860000, totalAgcSteps: 71800, channel: 0o11, value: 0o1 },
    ];
    const doc = await buildEventLogExport(makeWorkerPayload(events), makeReady(), { exportedAt: "2026-01-01T00:00:00.000Z" });
    expect(doc.format).toBe("apollo-agc-event-log");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.payload.integrity.eventCount).toBe(2);
    expect(doc.payload.integrity.firstEventId).toBe(1);
    expect(doc.payload.integrity.lastEventId).toBe(2);
    expect(doc.payload.events[0]).toMatchObject({ type: "inputAccepted", sessionEpoch: 0, source: "dsky" });
    expect(doc.payload.baseline.eventId).toBe(0);
    expect(doc.integrity.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("integrity hash matches canonical payload SHA-256", async () => {
    const doc = await buildEventLogExport(makeWorkerPayload([]), makeReady(), { exportedAt: "2026-01-01T00:00:00.000Z" });
    const recomputed = await canonicalSha256(doc.payload);
    expect(doc.integrity.canonicalSha256).toBe(recomputed);
  });

  it("bytes are identical across exports when only exportedAt differs", async () => {
    const p = makeWorkerPayload([
      { type: "channelUpdate", eventId: 1, tickIndex: 1, missionTimeUs: 20000, totalAgcSteps: 1706, channel: 0o11, value: 1 },
    ]);
    const a = await buildEventLogExport(p, makeReady(), { exportedAt: "2026-01-01T00:00:00.000Z" });
    const b = await buildEventLogExport(p, makeReady(), { exportedAt: "2099-12-31T23:59:59.999Z" });
    expect(a.integrity.canonicalSha256).toBe(b.integrity.canonicalSha256);
    expect(a.payload).toEqual(b.payload);
  });

  it("rejects non-monotonic event order", async () => {
    const bad: PublicEventRecord[] = [
      { type: "channelUpdate", eventId: 2, tickIndex: 1, missionTimeUs: 0, totalAgcSteps: 0, channel: 0o11, value: 0 },
      { type: "channelUpdate", eventId: 1, tickIndex: 1, missionTimeUs: 0, totalAgcSteps: 0, channel: 0o11, value: 0 },
    ];
    await expect(buildEventLogExport(makeWorkerPayload(bad), makeReady())).rejects.toThrow(/strictly ordered/);
  });

  it("rejects mismatched session epoch", async () => {
    await expect(
      buildEventLogExport(makeWorkerPayload([], { sessionEpoch: 1 }), makeReady({ sessionEpoch: 0 })),
    ).rejects.toThrow(/session-epoch mismatch/);
  });

  it("reports honest retention when events have been dropped", async () => {
    const events: PublicEventRecord[] = [
      { type: "channelUpdate", eventId: 501, tickIndex: 500, missionTimeUs: 0, totalAgcSteps: 0, channel: 0o11, value: 1 },
      { type: "channelUpdate", eventId: 502, tickIndex: 501, missionTimeUs: 0, totalAgcSteps: 0, channel: 0o11, value: 0 },
    ];
    const doc = await buildEventLogExport(
      makeWorkerPayload(events, {
        retention: { completeEpoch: false, droppedBeforeEventId: 501, retainedEventLimit: 500 },
      }),
      makeReady(),
    );
    expect(doc.payload.retention).toEqual({
      completeEpoch: false,
      droppedBeforeEventId: 501,
      retainedEventLimit: 500,
    });
    expect(doc.payload.integrity.firstEventId).toBe(501);
  });
});

describe("suggestedFileName", () => {
  it("includes the rope, epoch, and UTC timestamp", () => {
    const when = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(suggestedFileName("Luminary099", 3, when)).toBe(
      "apollo-agc-luminary099-epoch-3-20260102-030405.json",
    );
  });
});
