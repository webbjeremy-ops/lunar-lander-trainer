// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  applyNext,
  canDeterministicallyPlay,
  clampIndex,
  eventIndexToSliderValue,
  initReplayState,
  isReplayable,
  reconstructAt,
  sliderValueToEventIndex,
} from "../ReplayReducer";
import { buildEventLogExport } from "../../eventLog/buildExport";
import { decodedDskyCanonical, makeEmptyDecodedDsky } from "../../dsky/DskyDecoder";
import type {
  EventLogExportPayload,
  PublicEventRecord,
  ReadyPayload,
} from "../../protocol";
import type { ImportResult } from "../../eventLog/importSchema";

function makeReady(): ReadyPayload {
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
  };
}

function makeWorkerPayload(events: PublicEventRecord[]): EventLogExportPayload {
  const empty = makeEmptyDecodedDsky();
  return {
    sessionEpoch: 0,
    timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
    baseline: {
      tickIndex: 42,
      missionTimeUs: 840000,
      totalAgcSteps: 71672,
      decodedDsky: empty,
      decodedDskyChecksum: "chk",
      channelValues: { "8": 0, "11": 0, "163": 0 },
    },
    events,
    retention: {
      completeEpoch: true,
      droppedBeforeEventId: null,
      retainedEventLimit: 32768,
    },
  };
}

async function makePayload(events: PublicEventRecord[]) {
  const doc = await buildEventLogExport(
    makeWorkerPayload(events),
    makeReady(),
    { exportedAt: "2026-01-01T00:00:00.000Z" },
  );
  return doc.payload;
}

/** A short "V 35 E → lamp test peak → clear" style stream. Digits appear
 *  via channel 010 with selector-1 (R1 low pair) and clear back to blank. */
function v35ish(): PublicEventRecord[] {
  return [
    { type: "inputAccepted", eventId: 1, tickIndex: 43, missionTimeUs: 860_000, totalAgcSteps: 71_800, kind: "dskyKeyDown", keyCode: 0o27 },
    { type: "channelUpdate",  eventId: 2, tickIndex: 43, missionTimeUs: 860_000, totalAgcSteps: 71_800, channel: 0o11, value: 0o1 },
    { type: "channelUpdate",  eventId: 3, tickIndex: 44, missionTimeUs: 880_000, totalAgcSteps: 71_900, channel: 0o11, value: 0o1 }, // duplicate value
    { type: "channelUpdate",  eventId: 4, tickIndex: 45, missionTimeUs: 900_000, totalAgcSteps: 72_000, channel: 0o163, value: 0o40 },
    { type: "channelUpdate",  eventId: 5, tickIndex: 45, missionTimeUs: 900_000, totalAgcSteps: 72_000, channel: 0o11, value: 0 }, // same MET as prev
    { type: "channelUpdate",  eventId: 6, tickIndex: 46, missionTimeUs: 920_000, totalAgcSteps: 72_100, channel: 0o163, value: 0 },
  ];
}

// ---------------------------------------------------------------------------

describe("ReplayReducer — scrubber slider mapping", () => {
  it("slider 0 ↔ baseline (-1)", () => {
    expect(sliderValueToEventIndex(0)).toBe(-1);
    expect(eventIndexToSliderValue(-1)).toBe(0);
  });
  it("slider 1 ↔ event 0", () => {
    expect(sliderValueToEventIndex(1)).toBe(0);
    expect(eventIndexToSliderValue(0)).toBe(1);
  });
  it("slider N ↔ event N-1 (last event)", () => {
    expect(sliderValueToEventIndex(6)).toBe(5);
    expect(eventIndexToSliderValue(5)).toBe(6);
  });
  it("clampIndex tolerates empty recordings", () => {
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(5, 0)).toBe(-1);
    expect(clampIndex(-99, 3)).toBe(-1);
    expect(clampIndex(99, 3)).toBe(2);
  });
});

describe("ReplayReducer — initialisation", () => {
  it("initReplayState matches baseline exactly", async () => {
    const p = await makePayload(v35ish());
    const s = initReplayState(p);
    expect(s.status).toBe("idle");
    expect(s.currentEventIndex).toBe(-1);
    expect(s.currentEventId).toBeNull();
    expect(s.tickIndex).toBe(p.baseline.tickIndex);
    expect(s.missionTimeUs).toBe(p.baseline.missionTimeUs);
    expect(s.totalAgcSteps).toBe(p.baseline.totalAgcSteps);
    expect(decodedDskyCanonical(s.decodedDsky)).toBe(decodedDskyCanonical(p.baseline.decodedDsky));
    expect(s.channelValues).toEqual(p.baseline.channelValues);
  });

  it("empty recording remains at baseline forever", async () => {
    const p = await makePayload([]);
    const s = initReplayState(p);
    expect(s.currentEventIndex).toBe(-1);
    // reconstructAt on empty recording is baseline.
    const s2 = reconstructAt(p, 5);
    expect(s2.currentEventIndex).toBe(-1);
    expect(decodedDskyCanonical(s2.decodedDsky)).toBe(decodedDskyCanonical(s.decodedDsky));
  });
});

describe("ReplayReducer — determinism", () => {
  it("sequential replay == reconstructAt at every index", async () => {
    const p = await makePayload(v35ish());
    let seq = initReplayState(p);
    for (let i = 0; i < p.events.length; i++) {
      seq = applyNext(seq, p.events[i]!, i);
      const jumped = reconstructAt(p, i);
      expect(seq.currentEventIndex).toBe(jumped.currentEventIndex);
      expect(seq.currentEventId).toBe(jumped.currentEventId);
      expect(seq.tickIndex).toBe(jumped.tickIndex);
      expect(seq.missionTimeUs).toBe(jumped.missionTimeUs);
      expect(seq.totalAgcSteps).toBe(jumped.totalAgcSteps);
      expect(seq.channelValues).toEqual(jumped.channelValues);
      expect(decodedDskyCanonical(seq.decodedDsky)).toBe(decodedDskyCanonical(jumped.decodedDsky));
    }
  });

  it("repeated reconstructAt(i) is byte-identical", async () => {
    const p = await makePayload(v35ish());
    for (let i = -1; i < p.events.length; i++) {
      const a = reconstructAt(p, i);
      const b = reconstructAt(p, i);
      expect(a).toEqual(b);
      expect(decodedDskyCanonical(a.decodedDsky)).toBe(decodedDskyCanonical(b.decodedDsky));
    }
  });

  it("duplicate-value channel writes remain distinct events", async () => {
    const p = await makePayload(v35ish());
    // Events 2 and 3 both write ch 011 = 1. Both must advance the cursor.
    const s2 = reconstructAt(p, 1);
    const s3 = reconstructAt(p, 2);
    expect(s2.currentEventIndex).toBe(1);
    expect(s3.currentEventIndex).toBe(2);
    // Channel value is stable across the duplicate write.
    expect(s2.channelValues["9"]).toBe(1);
    expect(s3.channelValues["9"]).toBe(1);
  });

  it("simultaneous mission-time events preserve event-id order", async () => {
    const p = await makePayload(v35ish());
    // Events 4 and 5 share missionTimeUs=900_000; ids 4<5.
    const s4 = reconstructAt(p, 3);
    const s5 = reconstructAt(p, 4);
    expect(s4.currentEventId).toBe(4);
    expect(s5.currentEventId).toBe(5);
    expect(s4.missionTimeUs).toBe(s5.missionTimeUs);
  });
});

describe("ReplayReducer — event-type semantics", () => {
  it("inputAccepted never fabricates channel or DSKY output", async () => {
    const p = await makePayload([
      { type: "inputAccepted", eventId: 1, tickIndex: 50, missionTimeUs: 1_000_000, totalAgcSteps: 80_000, kind: "dskyKeyDown", keyCode: 0o27 },
    ]);
    const base = initReplayState(p);
    const s = applyNext(base, p.events[0]!, 0);
    expect(s.channelValues).toEqual(base.channelValues);
    expect(decodedDskyCanonical(s.decodedDsky)).toBe(decodedDskyCanonical(base.decodedDsky));
    // Cursor and timing still advanced.
    expect(s.currentEventIndex).toBe(0);
    expect(s.tickIndex).toBe(50);
    expect(s.currentEventId).toBe(1);
  });

  it("channelUpdate to a DSKY channel updates decoded DSKY through the canonical decoder", async () => {
    // Selector 12 annunciator row on ch 010: word=0o60000 turns all masks off.
    // Then a selector-1 write should illuminate R1 digits.
    const p = await makePayload([
      { type: "channelUpdate", eventId: 1, tickIndex: 43, missionTimeUs: 860_000, totalAgcSteps: 71_800, channel: 0o10, value: (1 << 11) | (5 << 5) | 3 },
    ]);
    const s = reconstructAt(p, 0);
    // Decoder canonical should differ from empty baseline now.
    expect(decodedDskyCanonical(s.decodedDsky)).not.toBe(decodedDskyCanonical(makeEmptyDecodedDsky()));
    expect(s.channelValues["8"]).toBe((1 << 11) | (5 << 5) | 3);
  });

  it("channelUpdate to a non-DSKY channel updates channelValues but leaves DSKY intact", async () => {
    const p = await makePayload([
      { type: "channelUpdate", eventId: 1, tickIndex: 43, missionTimeUs: 860_000, totalAgcSteps: 71_800, channel: 0o30, value: 0o777 },
    ]);
    const s = reconstructAt(p, 0);
    expect(s.channelValues["24"]).toBe(0o777);
    expect(decodedDskyCanonical(s.decodedDsky)).toBe(decodedDskyCanonical(makeEmptyDecodedDsky()));
  });
});

describe("ReplayReducer — compatibility gate", () => {
  it("canDeterministicallyPlay only for valid-compatible", () => {
    const compat = { status: "valid-compatible" } as unknown as ImportResult;
    const incompat = { status: "valid-incompatible" } as unknown as ImportResult;
    const invalid = { status: "invalid", errors: [], truncated: false } as ImportResult;
    expect(canDeterministicallyPlay(compat)).toBe(true);
    expect(canDeterministicallyPlay(incompat)).toBe(false);
    expect(canDeterministicallyPlay(invalid)).toBe(false);
    expect(canDeterministicallyPlay(null)).toBe(false);
    expect(isReplayable(compat)).toBe(true);
    expect(isReplayable(incompat)).toBe(true);
    expect(isReplayable(invalid)).toBe(false);
  });
});
