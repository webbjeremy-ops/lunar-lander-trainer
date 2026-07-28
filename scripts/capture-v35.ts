#!/usr/bin/env -S bunx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reproducible V35 (lamp test) golden-trace capture.
//
// Usage:
//   1) bun run build
//   2) bunx wrangler dev -c dist/server/wrangler.json --port 8788 &
//   3) bun scripts/capture-v35.ts
//
// The script drives the /capture route (real Worker, real yaAGC.wasm, real
// Luminary099 rope, real DSKY decoder) and writes a byte-stable fixture to
// tests/fixtures/v35-lamp-test.json. Expected DSKY digits/lamps are NEVER
// hand-authored — they are whatever the pinned emulator produces.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:8788";
const OUT_PATH = "tests/fixtures/v35-lamp-test.json";
const APP_COMMIT = process.env.CAPTURE_APP_COMMIT ?? "uncommitted";
const DECODER_SCHEMA_VERSION = 1;

// Authentic DSKY key-codes (must match src/sim/agc/AgcChannelRegistry.ts).
const KEY = { VERB: 0o21, THREE: 0o03, FIVE: 0o05, ENTR: 0o34 };

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 20_000): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[page]", m.text());
  });
  await page.goto(`${BASE_URL}/capture`, { waitUntil: "domcontentloaded" });

  // Wait for the harness to install and the Worker to signal ready.
  await waitFor(() => page.evaluate(() => (window as unknown as { __agcCapture?: { isReady(): boolean } }).__agcCapture?.isReady()));

  // Give the AGC ~2 s of run time so its power-up initialization stabilizes,
  // then reset to a canonical starting state before the V35 sequence.
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as { __agcCapture: { reset(): void } }).__agcCapture.reset());
  await page.waitForTimeout(800);

  // Snapshot the canonical pre-test decoded state from a fresh segment.
  const preTestSegment = await page.evaluate(() => {
    const api = (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture;
    return api.snapshotFixture("pre-test");
  });

  // Drive V 3 5 ENTR with 200 ms spacing.
  const sequence: Array<[string, number]> = [
    ["VERB",  KEY.VERB],
    ["THREE", KEY.THREE],
    ["FIVE",  KEY.FIVE],
    ["ENTR",  KEY.ENTR],
  ];
  for (const [label, code] of sequence) {
    await page.evaluate((c) => (window as unknown as { __agcCapture: { dskyKeyDown(n: number): void } }).__agcCapture.dskyKeyDown(c), code);
    console.log(`  pressed ${label}`);
    await page.waitForTimeout(220);
  }

  // Give the lamp test ample time to reach its peak (all lamps + all digits
  // lit). yaDSKY V35 runs ~5 s; we sample the full timeline.
  await page.waitForTimeout(8000);

  // Extract the full captured trace.
  const fixture = await page.evaluate(() => {
    const api = (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture;
    return api.snapshotFixture("v35-lamp-test");
  }) as {
    protocolVersion: number;
    emulator: { repo: string; commit: string; versionString: string };
    wasmSha256: string;
    rope: { id: string; sha256: string; sourceCommit: string; byteLength: number };
    commands: unknown[];
    ch010Events: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; value: number }>;
    decodedTimeline: Array<{ tickIndex: number; missionTimeUs: number; decoded: unknown; checksum: string }>;
    finalDecoded: unknown;
    finalChecksum: string;
    finalSnapshot: unknown;
  };

  await browser.close();

  // Compute the "peak" decoded state = the timeline record with the highest
  // number of lit annunciators + digit segments. Chosen by data, not by us.
  type Ann = Record<string, boolean>;
  const scoreOf = (rec: { decoded: unknown }): number => {
    const d = rec.decoded as {
      annunciators: Ann;
      program: { digits: { segments: number }[] };
      verb: { digits: { segments: number }[] };
      noun: { digits: { segments: number }[] };
      r1: { digits: { segments: number }[]; sign?: { plus: boolean; minus: boolean } };
      r2: { digits: { segments: number }[]; sign?: { plus: boolean; minus: boolean } };
      r3: { digits: { segments: number }[]; sign?: { plus: boolean; minus: boolean } };
    };
    let s = 0;
    for (const v of Object.values(d.annunciators)) if (v) s += 8;
    const litSegs = (reg: { digits: { segments: number }[] }) =>
      reg.digits.reduce((acc, dig) => acc + (dig.segments & 0x7f ? 1 : 0), 0);
    s += litSegs(d.program) + litSegs(d.verb) + litSegs(d.noun);
    s += litSegs(d.r1) + litSegs(d.r2) + litSegs(d.r3);
    for (const r of [d.r1, d.r2, d.r3]) {
      if (r.sign?.plus) s += 2;
      if (r.sign?.minus) s += 2;
    }
    return s;
  };
  let peak: (typeof fixture.decodedTimeline)[number] | null = null;
  let peakScore = -1;
  for (const rec of fixture.decodedTimeline) {
    const s = scoreOf(rec);
    if (s > peakScore) {
      peakScore = s;
      peak = rec;
    }
  }
  if (!peak) throw new Error("no decoded timeline records captured");

  const out = {
    kind: "agc-golden-trace",
    label: "V35 lamp test (Luminary099)",
    capturedAt: new Date().toISOString(),
    metadata: {
      protocolVersion: fixture.protocolVersion,
      decoderSchemaVersion: DECODER_SCHEMA_VERSION,
      appCommit: APP_COMMIT,
      emulator: fixture.emulator,
      wasmSha256: fixture.wasmSha256,
      rope: fixture.rope,
      captureRoute: "/capture",
      note:
        "Every digit/lamp value in this file was produced by yaAGC running Luminary099 through the pinned decoder. Do NOT hand-edit.",
    },
    preTestDecoded: (preTestSegment as { finalDecoded: unknown }).finalDecoded,
    preTestChecksum: (preTestSegment as { finalChecksum: string }).finalChecksum,
    commands: fixture.commands,
    ch010Events: fixture.ch010Events,
    peak: {
      tickIndex: peak.tickIndex,
      missionTimeUs: peak.missionTimeUs,
      score: peakScore,
      decoded: peak.decoded,
      checksum: peak.checksum,
    },
    finalDecoded: fixture.finalDecoded,
    finalChecksum: fixture.finalChecksum,
    finalSnapshot: fixture.finalSnapshot,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`captured ${fixture.ch010Events.length} ch010 events, ${fixture.decodedTimeline.length} decoded frames → ${OUT_PATH}`);
  console.log(`peak checksum: ${peak.checksum}`);
  console.log(`final checksum: ${fixture.finalChecksum}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
