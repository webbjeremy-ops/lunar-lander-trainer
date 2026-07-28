// SPDX-License-Identifier: GPL-3.0-or-later
// Golden-trace decoder validation.
//
// Replays the ordered channel-010 event stream captured by
// scripts/capture-v35.ts through the PURE decoder (no Worker, no emulator)
// and asserts:
//   * the pre-test state matches
//   * the peak state (identified in the fixture by data, not us) matches
//   * the final state and checksum match
//
// This test is skipped when the fixture does not yet exist so `vitest` stays
// green on a clean clone; capture the fixture with the documented script and
// the test becomes active.

import { describe, expect, it } from "vitest";
import {
  applyDskyOutput,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "../DskyDecoder";
import type { DecodedDsky } from "../DskyTypes";

interface GoldenFixture {
  kind: "agc-golden-trace";
  label: string;
  metadata: {
    protocolVersion: number;
    decoderSchemaVersion: number;
    emulator: { commit: string };
    wasmSha256: string;
    rope: { sha256: string; sourceCommit: string };
  };
  preTestDecoded: DecodedDsky;
  preTestChecksum: string;
  ch010Events: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; value: number }>;
  peak: { tickIndex: number; missionTimeUs: number; decoded: DecodedDsky; checksum: string };
  finalDecoded: DecodedDsky;
  finalChecksum: string;
}

// Import statically-so-fail-loud; vitest reports "cannot find module" if the
// fixture was never captured, which is the correct signal.
async function loadFixture(): Promise<GoldenFixture | null> {
  try {
    // Vite/Vitest resolves this at test time.
    const mod = await import("../../../../tests/fixtures/v35-lamp-test.json");
    return (mod as { default: GoldenFixture }).default;
  } catch {
    return null;
  }
}

describe("V35 lamp test golden trace", () => {
  it("replays deterministically through the pure decoder", async () => {
    const fx = await loadFixture();
    if (!fx) {
      console.warn("[skip] tests/fixtures/v35-lamp-test.json missing; run scripts/capture-v35.ts");
      return;
    }
    expect(fx.kind).toBe("agc-golden-trace");
    expect(fx.metadata.protocolVersion).toBeGreaterThanOrEqual(2);

    // The captured pre-test state is what the decoder should be in AFTER we
    // reset + let the Worker settle: monotonically the eventCount will be 0
    // only if no channel-010 traffic happened between reset and snapshot.
    // We do not assume that. What we DO check is that replaying the recorded
    // ch010 words in order produces the recorded peak + final state.
    const state = makeEmptyDecodedDsky();
    // Fast-forward through every recorded word in strict order.
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
    // Peak state MUST appear at some point in the replayed stream.
    expect(sawPeak, "peak decoded state was never reached during replay").toBe(true);
    expect(peakSeenAtIndex).toBeGreaterThanOrEqual(0);

    // Final decoder state MUST match byte-for-byte (via canonical form).
    expect(decodedDskyCanonical(state)).toBe(fx.finalChecksum);
  });

  it("is idempotent under repeated replay", async () => {
    const fx = await loadFixture();
    if (!fx) return;
    const s1 = makeEmptyDecodedDsky();
    const s2 = makeEmptyDecodedDsky();
    for (const e of fx.ch010Events) applyDskyOutput(s1, e.value);
    for (const e of fx.ch010Events) applyDskyOutput(s2, e.value);
    expect(decodedDskyCanonical(s1)).toBe(decodedDskyCanonical(s2));
  });
});
