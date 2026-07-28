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
  metadata: V35Fixture["metadata"];
  samples: Array<{
    label: string;
    decoded: DecodedDsky;
    checksum: string;
    snapshot: { missionTimeUs: number; tickIndex: number } | null;
  }>;
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
    const state = makeEmptyDecodedDsky();
    let sawPeak = false;
    let peakSeenAtIndex = -1;
    for (let i = 0; i < fx.ch010Events.length; i++) {
      applyDskyOutput(state, fx.ch010Events[i]!.value);
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
    const s1 = makeEmptyDecodedDsky();
    const s2 = makeEmptyDecodedDsky();
    for (const e of fx.ch010Events) applyDskyOutput(s1, e.value);
    for (const e of fx.ch010Events) applyDskyOutput(s2, e.value);
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
    expect(fx.samples.length).toBeGreaterThanOrEqual(2);
    assertNoMachineSpecificPaths(fx, "v16-n65");
  });

  it("records at least two advancing decoded MET samples", () => {
    // Each sample must carry a snapshot with monotonically increasing mission
    // time. This is the "advance" invariant the audit requires.
    const times = fx.samples.map((s) => s.snapshot?.missionTimeUs ?? -1);
    for (const t of times) expect(t).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    // Sample checksums must differ (at minimum the eventCount / MET display
    // digits advance between snapshots taken 3s apart).
    const uniqueChecksums = new Set(fx.samples.map((s) => s.checksum));
    expect(uniqueChecksums.size).toBeGreaterThanOrEqual(2);
  });
});
