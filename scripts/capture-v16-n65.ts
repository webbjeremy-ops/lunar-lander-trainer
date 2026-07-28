#!/usr/bin/env -S bunx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reproducible V16 N65 (mission-elapsed-time monitor) golden-trace capture.
// Same architecture as scripts/capture-v35.ts.
//
// Usage:
//   1) bun run build
//   2) bunx wrangler dev -c dist/server/wrangler.json --port 8788 &
//   3) bun scripts/capture-v16-n65.ts

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:8788";
const OUT_PATH = "tests/fixtures/v16-n65-met.json";
const APP_COMMIT = process.env.CAPTURE_APP_COMMIT ?? "uncommitted";
const DECODER_SCHEMA_VERSION = 1;

const KEY = {
  VERB: 0o21, NOUN: 0o37, ENTR: 0o34,
  ONE: 0o01, FIVE: 0o05, SIX: 0o06,
};

async function waitReady(page: import("playwright").Page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(
      () => (window as unknown as { __agcCapture?: { isReady(): boolean } }).__agcCapture?.isReady(),
    );
    if (ok) return;
    await page.waitForTimeout(100);
  }
  throw new Error("harness not ready");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/capture`, { waitUntil: "domcontentloaded" });
  await waitReady(page);

  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as { __agcCapture: { reset(): void } }).__agcCapture.reset());
  await page.waitForTimeout(800);

  const preTest = await page.evaluate(() =>
    (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture.snapshotFixture("pre-test"),
  );

  const seq: Array<[string, number]> = [
    ["VERB", KEY.VERB], ["ONE", KEY.ONE], ["SIX", KEY.SIX],
    ["NOUN", KEY.NOUN], ["SIX", KEY.SIX], ["FIVE", KEY.FIVE],
    ["ENTR", KEY.ENTR],
  ];
  for (const [label, code] of seq) {
    await page.evaluate((c) => (window as unknown as { __agcCapture: { dskyKeyDown(n: number): void } }).__agcCapture.dskyKeyDown(c), code);
    console.log(`  ${label}`);
    await page.waitForTimeout(220);
  }

  // Sample two time windows so validation can assert the MET register
  // actually advances between them.
  await page.waitForTimeout(3000);
  const sampleA = await page.evaluate(() =>
    (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture.snapshotFixture("sample-A"),
  );
  await page.waitForTimeout(3000);
  const sampleB = await page.evaluate(() =>
    (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture.snapshotFixture("sample-B"),
  );

  await browser.close();

  const A = sampleA as { finalDecoded: unknown; finalChecksum: string; finalSnapshot: { missionTimeUs: number; tickIndex: number } | null };
  const B = sampleB as { finalDecoded: unknown; finalChecksum: string; finalSnapshot: { missionTimeUs: number; tickIndex: number } | null; ch010Events: unknown[]; commands: unknown[]; emulator: unknown; wasmSha256: string; rope: unknown; protocolVersion: number };

  const out = {
    kind: "agc-golden-trace",
    label: "V16 N65 mission-elapsed-time monitor (Luminary099)",
    capturedAt: new Date().toISOString(),
    metadata: {
      protocolVersion: B.protocolVersion,
      decoderSchemaVersion: DECODER_SCHEMA_VERSION,
      appCommit: APP_COMMIT,
      emulator: B.emulator,
      wasmSha256: B.wasmSha256,
      rope: B.rope,
      captureRoute: "/capture",
      note:
        "Digits are authoritative decoder output at each sample. Only advance/monotonic assertions are meaningful across runs — real time content differs.",
    },
    preTestDecoded: (preTest as { finalDecoded: unknown }).finalDecoded,
    preTestChecksum: (preTest as { finalChecksum: string }).finalChecksum,
    commands: B.commands,
    ch010EventCount: (B.ch010Events as unknown[]).length,
    samples: [
      { label: "A", decoded: A.finalDecoded, checksum: A.finalChecksum, snapshot: A.finalSnapshot },
      { label: "B", decoded: B.finalDecoded, checksum: B.finalChecksum, snapshot: B.finalSnapshot },
    ],
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const dtUs = (B.finalSnapshot?.missionTimeUs ?? 0) - (A.finalSnapshot?.missionTimeUs ?? 0);
  console.log(`captured A→B mission-time delta: ${dtUs} µs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
