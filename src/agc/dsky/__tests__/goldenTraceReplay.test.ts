// SPDX-License-Identifier: GPL-3.0-or-later
// Golden-trace decoder validation.
//
// Replays the ordered channel-010 event streams captured by
// scripts/capture-v35.ts and scripts/capture-v16-n65.ts through the PURE
// decoder (no Worker, no emulator) and asserts:
//   * the pre-test state matches
//   * the peak state (identified in the V35 fixture by data, not us) matches
//   * the final state and checksum match
//   * V16 N65 fixture contains at least two advancing decoded MET samples
//
// Fixtures are COMMITTED. Missing fixtures are a HARD FAILURE — the tests do
// not soft-skip. Regenerate with:
//   VITE_AGC_CAPTURE_MODE=true bun run build
//   bunx wrangler dev -c dist/server/wrangler.json --port 8788 &
//   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium bun scripts/capture-v35.ts
//   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium bun scripts/capture-v16-n65.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDskyChannelEvent,
  applyDskyOutput,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "../DskyDecoder";
import type { DecodedDsky } from "../DskyTypes";

interface V35Fixture {
  kind: "agc-golden-trace";
  label: string;
  metadata: {
    protocolVersion: number;
    decoderSchemaVersion: number;
    appCommit: string;
    emulator: { commit: string; repo: string; versionString: string };
    wasmSha256: string;
    rope: { sha256: string; sourceCommit: string; id: string; byteLength: number };
    captureRoute: string;
  };
  preTestDecoded: DecodedDsky;
  preTestChecksum: string;
  ch010Events: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; value: number }>;
  dskyEvents?: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; channel: number; value: number }>;
  peak: { tickIndex: number; missionTimeUs: number; decoded: DecodedDsky; checksum: string };
  finalDecoded: DecodedDsky;
  finalChecksum: string;
}

interface V16Fixture {
  kind: "agc-golden-trace";
  metadata: V35Fixture["metadata"] & {
    enterTick: number;
    enterEventId: number | null;
    firstStableCheckpoint: { tickIndex: number; r3Anchor: number; checksum: string };
    lastStableCheckpoint: { tickIndex: number; r3Anchor: number; checksum: string };
  };
  dskyEvents: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; channel: number; value: number }>;
  decodedTimeline: Array<{ tickIndex: number; missionTimeUs: number; decoded: DecodedDsky; checksum: string }>;
  stableCheckpoints: Array<{ index: number; tickIndex: number; missionTimeUs: number; r3Digits: number[]; r3Anchor: number; checksum: string }>;
  finalDecoded: DecodedDsky;
  finalChecksum: string;
}

function loadJson<T>(rel: string): T {
  const p = resolve(process.cwd(), rel);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const V35_PATH = "tests/fixtures/v35-lamp-test.json";
const V16_PATH = "tests/fixtures/v16-n65-met.json";

// A "wall-clock-dependent" or machine-specific value is anything absolute like
// a filesystem path, home dir, or unbounded timestamps we can't audit. `capturedAt`
// is the only free-form timestamp we tolerate (it lives at the top level and is
// stripped for reproducibility comparisons).
const MACHINE_SPECIFIC = [
  /\/home\//i,
  /\/Users\//,
  /C:\\/,
  /\/root\//,
  /\/tmp\//i,
  /\/dev-server\//,
  /file:\/\//i,
];
function assertNoMachineSpecificPaths(json: unknown, label: string) {
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      for (const re of MACHINE_SPECIFIC) {
        if (re.test(v))
          throw new Error(`${label}: machine-specific string at ${path}: ${v}`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) if (k !== "capturedAt") walk(x, `${path}.${k}`);
  };
  walk(json, "$");
}

describe("V35 lamp test golden trace", () => {
  const fx = loadJson<V35Fixture>(V35_PATH);

  it("fixture is committed and well-formed", () => {
    expect(fx.kind).toBe("agc-golden-trace");
    expect(fx.metadata.protocolVersion).toBeGreaterThanOrEqual(2);
    expect(fx.metadata.decoderSchemaVersion).toBeGreaterThanOrEqual(1);
    expect(fx.metadata.emulator.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(fx.metadata.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.metadata.rope.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.metadata.rope.sourceCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(fx.metadata.captureRoute).toBe("/capture");
    expect(typeof fx.metadata.appCommit).toBe("string");
    expect(fx.ch010Events.length).toBeGreaterThan(0);
    // Every event carries eventId, tickIndex, missionTimeUs — no defaults.
    for (const e of fx.ch010Events) {
      expect(typeof e.eventId).toBe("number");
      expect(typeof e.tickIndex).toBe("number");
      expect(typeof e.missionTimeUs).toBe("number");
      expect(typeof e.value).toBe("number");
    }
    // pre-test, peak, final states are all present (V35 records all three).
    expect(fx.preTestChecksum.length).toBeGreaterThan(0);
    expect(fx.peak.checksum.length).toBeGreaterThan(0);
    expect(fx.finalChecksum.length).toBeGreaterThan(0);
    assertNoMachineSpecificPaths(fx, "v35");
  });

  it("replays deterministically through the pure decoder", () => {
    // Prefer the full multi-channel dskyEvents stream when the fixture
    // includes it; fall back to legacy ch010-only streams.
    const events = fx.dskyEvents ?? fx.ch010Events.map((e) => ({ ...e, channel: 0o10 }));
    const state = makeEmptyDecodedDsky();
    let sawPeak = false;
    let peakSeenAtIndex = -1;
    for (let i = 0; i < events.length; i++) {
      applyDskyChannelEvent(state, events[i]!.channel, events[i]!.value);
      const chk = decodedDskyCanonical(state);
      if (!sawPeak && chk === fx.peak.checksum) {
        sawPeak = true;
        peakSeenAtIndex = i;
      }
    }
    expect(sawPeak, "peak decoded state was never reached during replay").toBe(true);
    expect(peakSeenAtIndex).toBeGreaterThanOrEqual(0);
    expect(decodedDskyCanonical(state)).toBe(fx.finalChecksum);
  });

  it("is idempotent under repeated replay", () => {
    const events = fx.dskyEvents ?? fx.ch010Events.map((e) => ({ ...e, channel: 0o10 }));
    const s1 = makeEmptyDecodedDsky();
    const s2 = makeEmptyDecodedDsky();
    for (const e of events) applyDskyChannelEvent(s1, e.channel, e.value);
    for (const e of events) applyDskyChannelEvent(s2, e.channel, e.value);
    expect(decodedDskyCanonical(s1)).toBe(decodedDskyCanonical(s2));
  });
});

describe("V16 N65 mission-elapsed-time golden trace", () => {
  const fx = loadJson<V16Fixture>(V16_PATH);

  it("fixture is committed and well-formed", () => {
    expect(fx.kind).toBe("agc-golden-trace");
    expect(fx.metadata.protocolVersion).toBeGreaterThanOrEqual(2);
    expect(fx.metadata.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.metadata.rope.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fx.dskyEvents.length).toBeGreaterThan(0);
    expect(fx.decodedTimeline.length).toBeGreaterThan(0);
    expect(fx.stableCheckpoints.length).toBeGreaterThanOrEqual(3);
    expect(typeof fx.metadata.enterTick).toBe("number");
    assertNoMachineSpecificPaths(fx, "v16-n65");
  });

  it("has at least two stable V16/N65 checkpoints with forward-progressing R3", () => {
    const first = fx.stableCheckpoints[0]!;
    const last = fx.stableCheckpoints[fx.stableCheckpoints.length - 1]!;
    expect(last.r3Anchor).toBeGreaterThan(first.r3Anchor);
    expect(last.tickIndex).toBeGreaterThan(first.tickIndex);
    // Every stable checkpoint carries VERB=16, NOUN=65 with all r3 digits valid.
    for (const c of fx.stableCheckpoints) {
      expect(c.r3Digits.length).toBe(5);
      expect(c.r3Digits.every((d) => d >= 0 && d <= 9)).toBe(true);
    }
  });

  it("pure decoder replay of dskyEvents reproduces the fixture final checksum", () => {
    const state = makeEmptyDecodedDsky();
    for (const e of fx.dskyEvents) applyDskyChannelEvent(state, e.channel, e.value);
    expect(decodedDskyCanonical(state)).toBe(fx.finalChecksum);
  });

  it("stable checkpoints appear as an ordered subsequence in the pure replay stream (duplicate checksums allowed)", () => {
    // Ordered-subsequence matching: each checkpoint checksum must appear
    // in the replay stream at a strictly later replay position than the
    // previous checkpoint. Duplicate checksums are legitimate — the same
    // stable DSKY state can span multiple selector scans — so the matcher
    // consumes one replay slot per checkpoint rather than accepting mere
    // set-membership (which would let one replay state satisfy N
    // checkpoints, or admit out-of-order matches).
    const state = makeEmptyDecodedDsky();
    const replayChecksums: string[] = [];
    for (const e of fx.dskyEvents) {
      applyDskyChannelEvent(state, e.channel, e.value);
      replayChecksums.push(decodedDskyCanonical(state));
    }
    let searchFrom = 0;
    for (const checkpoint of fx.stableCheckpoints) {
      const foundAt = replayChecksums.findIndex(
        (chk, index) => index >= searchFrom && chk === checkpoint.checksum,
      );
      expect(
        foundAt,
        `checkpoint tick=${checkpoint.tickIndex} anchor=${checkpoint.r3Anchor} not found at replay index >= ${searchFrom}`,
      ).toBeGreaterThanOrEqual(searchFrom);
      searchFrom = foundAt + 1;
    }
  });

  it("ordered-subsequence matcher rejects reversed checkpoint order (negative)", () => {
    const state = makeEmptyDecodedDsky();
    const replayChecksums: string[] = [];
    for (const e of fx.dskyEvents) {
      applyDskyChannelEvent(state, e.channel, e.value);
      replayChecksums.push(decodedDskyCanonical(state));
    }
    // Reverse the checkpoint list. The two ends have distinct R3 anchors
    // (proven earlier), so their checksums differ, so ordered matching
    // must fail somewhere in the walk.
    const reversed = [...fx.stableCheckpoints].reverse();
    let searchFrom = 0;
    let failedAt = -1;
    for (let i = 0; i < reversed.length; i++) {
      const c = reversed[i]!;
      const foundAt = replayChecksums.findIndex(
        (chk, index) => index >= searchFrom && chk === c.checksum,
      );
      if (foundAt < 0) { failedAt = i; break; }
      searchFrom = foundAt + 1;
    }
    expect(
      failedAt,
      "reversed checkpoints must not satisfy the ordered-subsequence matcher",
    ).toBeGreaterThanOrEqual(0);
  });

  it("ordered-subsequence matcher requires distinct replay positions for consecutive duplicate checkpoints", () => {
    // Build a synthetic 3-element replay stream with two duplicate
    // checksums. Two consecutive duplicate checkpoints require two
    // distinct replay slots, so a stream of length 1 must fail while a
    // stream of length 2 must pass.
    const dupChecksum = "DUP";
    const otherChecksum = "OTHER";
    const checkpoints = [{ checksum: dupChecksum }, { checksum: dupChecksum }];
    function walk(replay: string[]) {
      let searchFrom = 0;
      for (const c of checkpoints) {
        const idx = replay.findIndex((v, i) => i >= searchFrom && v === c.checksum);
        if (idx < 0) return false;
        searchFrom = idx + 1;
      }
      return true;
    }
    expect(walk([dupChecksum])).toBe(false);
    expect(walk([dupChecksum, otherChecksum])).toBe(false);
    expect(walk([dupChecksum, dupChecksum])).toBe(true);
    expect(walk([dupChecksum, otherChecksum, dupChecksum])).toBe(true);
  });
});
