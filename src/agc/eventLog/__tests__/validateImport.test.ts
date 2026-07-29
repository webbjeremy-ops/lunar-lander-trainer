// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { buildEventLogExport } from "../buildExport";
import { canonicalJsonStringify, canonicalSha256 } from "../canonical";
import { validateImport } from "../validateImport";
import { decodedDskyCanonical, makeEmptyDecodedDsky } from "../../dsky/DskyDecoder";
import { IMPORT_LIMITS } from "../importSchema";
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
    ...overrides,
  };
}

function makeWorkerPayload(
  events: PublicEventRecord[],
  overrides: Partial<EventLogExportPayload> = {},
): EventLogExportPayload {
  const empty = makeEmptyDecodedDsky();
  return {
    sessionEpoch: 0,
    timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
    baseline: {
      tickIndex: 42,
      missionTimeUs: 840000,
      totalAgcSteps: 71672,
      decodedDsky: empty,
      decodedDskyChecksum: decodedDskyCanonical(empty),
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

async function makeValidDocJson(
  events: PublicEventRecord[] = [
    { type: "inputAccepted", eventId: 1, tickIndex: 43, missionTimeUs: 860000, totalAgcSteps: 71800, kind: "dskyKeyDown", keyCode: 0o21 },
    { type: "channelUpdate", eventId: 2, tickIndex: 43, missionTimeUs: 860000, totalAgcSteps: 71800, channel: 0o11, value: 0o1 },
  ],
): Promise<string> {
  const doc = await buildEventLogExport(
    makeWorkerPayload(events),
    makeReady(),
    { exportedAt: "2026-01-01T00:00:00.000Z" },
  );
  return JSON.stringify(doc);
}

describe("validateImport — happy path", () => {
  it("accepts a self-generated export and reports compatible against the same session", async () => {
    const json = await makeValidDocJson();
    const r = await validateImport(json, {
      currentSession: {
        ready: makeReady(),
        timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
      },
    });
    expect(r.status).toBe("valid-compatible");
    if (r.status !== "valid-compatible") return;
    expect(r.compatibility.replayEligible).toBe(true);
    expect(r.recording.summary.eventCount).toBe(2);
    expect(r.recording.summary.firstEventId).toBe(1);
    expect(r.recording.summary.lastEventId).toBe(2);
    expect(r.recording.summary.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports valid-incompatible against a different rope", async () => {
    const json = await makeValidDocJson();
    const r = await validateImport(json, {
      currentSession: {
        ready: makeReady({ ropeSha256: "c".repeat(64) }),
        timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
      },
    });
    expect(r.status).toBe("valid-incompatible");
    if (r.status !== "valid-incompatible") return;
    expect(r.compatibility.replayEligible).toBe(false);
    expect(r.compatibility.ropeSha256.status).toBe("differs");
  });

  it("returns unknown-current for every provenance field when no live session", async () => {
    const json = await makeValidDocJson();
    const r = await validateImport(json, {});
    expect(r.status).toBe("valid-incompatible");
    if (r.status !== "valid-incompatible") return;
    expect(r.compatibility.replayEligible).toBe(false);
    expect(r.compatibility.ropeSha256.status).toBe("unknown-current");
  });

  it("accepts bytes and ArrayBuffer as well as string", async () => {
    const json = await makeValidDocJson();
    const bytes = new TextEncoder().encode(json);
    const r1 = await validateImport(bytes);
    const r2 = await validateImport(bytes.buffer);
    expect(r1.status).not.toBe("invalid");
    expect(r2.status).not.toBe("invalid");
  });
});

describe("validateImport — integrity", () => {
  it("rejects when the declared canonical SHA-256 is tampered", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.integrity.canonicalSha256 = "0".repeat(64);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "integrity-hash-mismatch")).toBe(true);
  });

  it("rejects when the payload contents are tampered but hash left alone", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.events[0].keyCode = 0o37; // NOUN, legal but different
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "integrity-hash-mismatch")).toBe(true);
  });

  it("recomputes canonical hash from validated payload (order-independent)", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    // Rewrite the payload with keys in a different declaration order.
    const shuffled = { integrity: doc.payload.integrity, events: doc.payload.events, ...doc.payload };
    doc.payload = shuffled;
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("valid-incompatible"); // no live session
    // Hash equals canonical of the payload regardless of key order.
    if (r.status === "invalid") return;
    const recomputed = await canonicalSha256(doc.payload);
    expect(r.recording.summary.canonicalSha256).toBe(recomputed);
  });
});

describe("validateImport — malformed input", () => {
  it("rejects the empty file", async () => {
    const r = await validateImport(new Uint8Array());
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("empty-file");
  });

  it("rejects oversize files without parsing", async () => {
    const huge = new Uint8Array(IMPORT_LIMITS.maxUploadBytes + 1);
    const r = await validateImport(huge);
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("file-too-large");
  });

  it("rejects malformed JSON", async () => {
    const r = await validateImport("{ not json");
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("malformed-json");
  });

  it("rejects a JSON array at the root", async () => {
    const r = await validateImport("[]");
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("not-an-object");
  });

  it("rejects a document with the wrong format tag", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.format = "some-other-format";
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("wrong-format");
  });

  it("rejects an unsupported schema version with a specific code", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.schemaVersion = 999;
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors[0].code).toBe("unsupported-schema-version");
  });
});

describe("validateImport — semantic checks", () => {
  it("rejects the canonical startup RSET leaking into public input", async () => {
    // Bypass buildEventLogExport (which allows any keycode) and construct
    // a doc whose public event contains RSET.
    const rsetEvent: PublicEventRecord = {
      type: "inputAccepted",
      eventId: 1,
      tickIndex: 43,
      missionTimeUs: 860000,
      totalAgcSteps: 71800,
      kind: "dskyKeyDown",
      keyCode: 0o22, // RSET
    };
    const json = await makeValidDocJson([rsetEvent]);
    const r = await validateImport(json);
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "startup-rset-leaked-to-public-input")).toBe(true);
  });

  it("rejects non-strictly-increasing eventIds", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.events[1].eventId = doc.payload.events[0].eventId;
    // Rehash so we surface the semantic error rather than integrity.
    doc.integrity.canonicalSha256 = await canonicalSha256(doc.payload);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "event-ids-not-strictly-increasing")).toBe(true);
  });

  it("rejects a corrupted baseline decoded-DSKY checksum", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.baseline.decodedDskyChecksum = "not-the-real-canonical";
    doc.integrity.canonicalSha256 = await canonicalSha256(doc.payload);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "baseline-checksum-mismatch")).toBe(true);
  });

  it("rejects retention that says complete but reports drops", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.retention.droppedBeforeEventId = 100;
    doc.integrity.canonicalSha256 = await canonicalSha256(doc.payload);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "retention-inconsistent")).toBe(true);
  });

  it("rejects a channel value outside AGC 15-bit range", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.events[1].value = 0o100000; // 16-bit
    doc.integrity.canonicalSha256 = await canonicalSha256(doc.payload);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "out-of-range")).toBe(true);
  });

  it("rejects an unknown DSKY keycode", async () => {
    const doc = JSON.parse(await makeValidDocJson());
    doc.payload.events[0].keyCode = 0o77; // not a legal DSKY key
    doc.integrity.canonicalSha256 = await canonicalSha256(doc.payload);
    const r = await validateImport(JSON.stringify(doc));
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => e.code === "invalid-keycode")).toBe(true);
  });
});

describe("validateImport — immutability and live-session non-mutation", () => {
  it("does not mutate the input JSON string or the current-session context", async () => {
    const json = await makeValidDocJson();
    const ready = makeReady();
    const snap = canonicalJsonStringify(ready);
    const r = await validateImport(json, {
      currentSession: {
        ready,
        timing: { nominalStepNs: 11720, schedulerTickUs: 20000 },
      },
    });
    expect(r.status).not.toBe("invalid");
    expect(canonicalJsonStringify(ready)).toBe(snap);
  });

  it("recording.raw is a deep copy — mutating it does not affect a later validation", async () => {
    const json = await makeValidDocJson();
    const r1 = await validateImport(json);
    expect(r1.status).not.toBe("invalid");
    if (r1.status === "invalid") return;
    // Mutate the returned object.
    (r1.recording.raw.payload.events as unknown as unknown[]).length = 0;
    const r2 = await validateImport(json);
    expect(r2.status).not.toBe("invalid");
    if (r2.status === "invalid") return;
    expect(r2.recording.summary.eventCount).toBe(2);
  });
});
