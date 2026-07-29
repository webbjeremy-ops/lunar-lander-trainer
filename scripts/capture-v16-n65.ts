#!/usr/bin/env -S bunx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reproducible V16 N65 (mission-elapsed-time monitor) golden-trace capture.
//
// Same architecture as scripts/capture-v35.ts. Emits the complete post-Enter
// dskyEvents stream (Ch 010 / 011 / 0163 in emission order), the decoded
// timeline, and identifies the first stable VERB=16/NOUN=65 checkpoint plus
// at least one later checkpoint with a forward-advanced Noun 65 display.
//
// Termination is deterministic:
//   * success once ≥2 stable Verb=16/Noun=65 decoded frames exist and the
//     latest frame's R3 anchor > the first stable frame's anchor.
//   * hard bound at MAX_WALL_MS.
// On hard bound the script writes a diagnostic report instead of a fixture
// and exits non-zero — do NOT loosen the lesson predicate to accept it.
//
// Usage:
//   1) bun run build
//   2) bunx wrangler dev -c dist/server/wrangler.json --port 8788 &
//   3) bun scripts/capture-v16-n65.ts

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:8788";
const OUT_PATH = "tests/fixtures/v16-n65-met.json";
const DIAG_PATH = "tests/fixtures/v16-n65-diagnostic.json";
const APP_COMMIT = process.env.CAPTURE_APP_COMMIT ?? "uncommitted";
const DECODER_SCHEMA_VERSION = 1;
const MAX_WALL_MS = Number(process.env.CAPTURE_MAX_WALL_MS ?? 45_000);
const KEY_SPACING_MS = 220;
const KEY = {
  VERB: 0o21, NOUN: 0o37, ENTR: 0o34,
  ONE: 0o01, FIVE: 0o05, SIX: 0o06,
};

// —————————————————————————————————————————————————————————————————————
// Shapes shared with capture.tsx (kept structural, no import to avoid vite).
interface DskyDigit { value: number | null; segments: number; }
interface DskyRegister { digits: DskyDigit[]; sign?: { plus: boolean; minus: boolean } }
interface DecodedDsky {
  program: DskyRegister; verb: DskyRegister; noun: DskyRegister;
  r1: DskyRegister; r2: DskyRegister; r3: DskyRegister;
  annunciators: Record<string, boolean>;
}
interface DecodedRecord {
  tickIndex: number; missionTimeUs: number; decoded: DecodedDsky; checksum: string;
}
interface StableCheckpoint {
  index: number; tickIndex: number; missionTimeUs: number;
  r3Digits: number[]; r3Anchor: number; checksum: string;
}

function r3Anchor(digs: (number | null)[]): number | null {
  if (digs.some((d) => d === null)) return null;
  let n = 0;
  for (const d of digs) n = n * 10 + (d as number);
  return n;
}

function classify(rec: DecodedRecord): StableCheckpoint | null {
  const v = rec.decoded.verb.digits.map((d) => d.value);
  const n = rec.decoded.noun.digits.map((d) => d.value);
  const r3 = rec.decoded.r3.digits.map((d) => d.value);
  if (v[0] !== 1 || v[1] !== 6) return null;
  if (n[0] !== 6 || n[1] !== 5) return null;
  const anchor = r3Anchor(r3);
  if (anchor === null) return null;
  return {
    index: -1, tickIndex: rec.tickIndex, missionTimeUs: rec.missionTimeUs,
    r3Digits: r3 as number[], r3Anchor: anchor, checksum: rec.checksum,
  };
}

async function waitReady(page: Page, timeoutMs = 20_000) {
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

async function pollForProgression(page: Page, maxMs: number) {
  const start = Date.now();
  let last: { total: number; stableCount: number; firstAnchor: number | null; lastAnchor: number | null; lastTick: number } = {
    total: 0, stableCount: 0, firstAnchor: null, lastAnchor: null, lastTick: 0,
  };
  while (Date.now() - start < maxMs) {
    const res = await page.evaluate(() => {
      const api = (window as unknown as { __agcCapture: { getLog(): { decodedTimeline: DecodedRecord[]; latestTickIndex: number } } }).__agcCapture;
      const tl = api.getLog().decodedTimeline;
      const stable: { tick: number; anchor: number }[] = [];
      for (const rec of tl) {
        const v = rec.decoded.verb.digits.map((d) => d.value);
        const n = rec.decoded.noun.digits.map((d) => d.value);
        const r3 = rec.decoded.r3.digits.map((d) => d.value);
        if (v[0] !== 1 || v[1] !== 6) continue;
        if (n[0] !== 6 || n[1] !== 5) continue;
        if (r3.some((d) => d === null)) continue;
        let anc = 0; for (const d of r3) anc = anc * 10 + (d as number);
        stable.push({ tick: rec.tickIndex, anchor: anc });
      }
      return {
        total: tl.length,
        stableCount: stable.length,
        firstAnchor: stable[0]?.anchor ?? null,
        lastAnchor: stable[stable.length - 1]?.anchor ?? null,
        lastTick: api.getLog().latestTickIndex,
      };
    });
    last = res;
    if (res.stableCount >= 3 && res.firstAnchor !== null && res.lastAnchor !== null && res.lastAnchor > res.firstAnchor) {
      return { done: true, ...res };
    }
    await page.waitForTimeout(150);
  }
  return { done: false, ...last };
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext()).newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.goto(`${BASE_URL}/capture`, { waitUntil: "domcontentloaded" });
  await waitReady(page);

  // Canonical initialization only — NO capture-only reset. Wait for the
  // SAME readiness state /learn's gate requires. See scripts/capture-v35.ts.
  const readySnap = await page.evaluate(
    () => (window as unknown as { __agcCapture: { waitReady(t?: number): Promise<unknown> } })
      .__agcCapture.waitReady(30_000),
  );
  console.log(`  readiness reached: ${JSON.stringify(readySnap)}`);

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
    await page.waitForTimeout(KEY_SPACING_MS);
  }

  console.log("polling for stable V16 N65 + progression…");
  const progress = await pollForProgression(page, MAX_WALL_MS);
  console.log(`  total decoded frames: ${progress.total}`);
  console.log(`  stable frames:        ${progress.stableCount}`);
  console.log(`  first anchor:         ${progress.firstAnchor}`);
  console.log(`  last  anchor:         ${progress.lastAnchor}`);
  console.log(`  lastTick:             ${progress.lastTick}`);

  const fixture = await page.evaluate(() =>
    (window as unknown as { __agcCapture: { snapshotFixture(l: string): unknown } }).__agcCapture.snapshotFixture("v16-n65-met"),
  ) as {
    protocolVersion: number;
    emulator: { repo: string; commit: string; versionString: string };
    wasmSha256: string;
    rope: { id: string; sha256: string; sourceCommit: string; byteLength: number };
    commands: Array<{ tickIndex: number; missionTimeUs: number; kind: string; payload: unknown }>;
    ch010Events: unknown[];
    dskyEvents: Array<{ eventId: number; tickIndex: number; missionTimeUs: number; channel: number; value: number }>;
    decodedTimeline: DecodedRecord[];
    finalDecoded: DecodedDsky;
    finalChecksum: string;
    finalSnapshot: { tickIndex: number; missionTimeUs: number } | null;
  };
  await browser.close();

  // Identify Enter boundary from the recorded command stream.
  const enterCmd = [...fixture.commands].reverse().find(
    (c) => c.kind === "dskyKeyDown" && (c.payload as { keyCode?: number }).keyCode === KEY.ENTR,
  );
  const enterTick = enterCmd?.tickIndex ?? -1;

  // Locate the first dskyEvent strictly after Enter — its eventId is the
  // earliest post-Enter channel event id. Predicate scoping uses this.
  const firstPostEnterEvent =
    fixture.dskyEvents.find((e) => e.tickIndex >= enterTick) ?? null;

  // Derive stable checkpoints from the captured decodedTimeline.
  const stableCheckpoints: StableCheckpoint[] = [];
  fixture.decodedTimeline.forEach((rec, idx) => {
    if (rec.tickIndex < enterTick) return;
    const c = classify(rec);
    if (c) stableCheckpoints.push({ ...c, index: idx });
  });

  if (!progress.done || stableCheckpoints.length < 3) {
    // Selector histogram from post-Enter Ch010 events for diagnostic report.
    const selectorHist: Record<number, number> = {};
    for (const e of fixture.dskyEvents) {
      if (e.channel !== 0o10) continue;
      if (e.tickIndex < enterTick) continue;
      const sel = (e.value >>> 11) & 0x0f;
      selectorHist[sel] = (selectorHist[sel] ?? 0) + 1;
    }
    const diag = {
      kind: "agc-capture-diagnostic",
      reason: "did not reach stable V16 N65 with forward progression",
      progress,
      enterTick,
      firstPostEnterEvent,
      stableCheckpointsFound: stableCheckpoints.length,
      postEnterSelectorHistogram: selectorHist,
      recentCommands: fixture.commands.slice(-16),
      finalDecoded: fixture.finalDecoded,
      finalSnapshot: fixture.finalSnapshot,
      metadata: {
        emulator: fixture.emulator, wasmSha256: fixture.wasmSha256, rope: fixture.rope,
        protocolVersion: fixture.protocolVersion, appCommit: APP_COMMIT,
      },
    };
    await mkdir(dirname(DIAG_PATH), { recursive: true });
    await writeFile(DIAG_PATH, JSON.stringify(diag, null, 2) + "\n", "utf8");
    console.error(`FAIL: capture did not stabilize; diagnostic written to ${DIAG_PATH}`);
    process.exit(2);
  }

  const first = stableCheckpoints[0]!;
  const last = stableCheckpoints[stableCheckpoints.length - 1]!;

  const out = {
    kind: "agc-golden-trace",
    label: "V16 N65 mission-elapsed-time monitor (Luminary099)",
    capturedAt: new Date().toISOString(),
    metadata: {
      protocolVersion: fixture.protocolVersion,
      decoderSchemaVersion: DECODER_SCHEMA_VERSION,
      appCommit: APP_COMMIT,
      emulator: fixture.emulator,
      wasmSha256: fixture.wasmSha256,
      rope: fixture.rope,
      captureRoute: "/capture",
      enterTick,
      enterEventId: firstPostEnterEvent?.eventId ?? null,
      firstStableCheckpoint: { tickIndex: first.tickIndex, r3Anchor: first.r3Anchor, checksum: first.checksum },
      lastStableCheckpoint: { tickIndex: last.tickIndex, r3Anchor: last.r3Anchor, checksum: last.checksum },
      note:
        "Full post-power-on trace. Decoded timeline and dskyEvents are authoritative. R3 progression is proven by ≥2 stableCheckpoints with strictly increasing r3Anchor.",
    },
    preTestDecoded: (preTest as { finalDecoded: unknown }).finalDecoded,
    preTestChecksum: (preTest as { finalChecksum: string }).finalChecksum,
    commands: fixture.commands,
    ch010EventCount: (fixture.ch010Events as unknown[]).length,
    dskyEvents: fixture.dskyEvents,
    decodedTimeline: fixture.decodedTimeline,
    stableCheckpoints,
    finalDecoded: fixture.finalDecoded,
    finalChecksum: fixture.finalChecksum,
    finalSnapshot: fixture.finalSnapshot,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`OK: ${stableCheckpoints.length} stable checkpoints, r3 ${first.r3Anchor} → ${last.r3Anchor}`);
  console.log(`  wrote ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
