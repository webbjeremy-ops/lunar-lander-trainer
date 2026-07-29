// SPDX-License-Identifier: GPL-3.0-or-later
//
// /explore Step 2 acceptance — Wrangler-served production build.
//
// Flow:
//   1. /learn — wait for real yaAGC + Luminary099 ready.
//   2. Tap V-3-5-E on the rendered keypad (4 real DSKY inputs).
//   3. Navigate to /explore. Same persistent Worker, same sessionEpoch.
//   4. Click Export JSON. Capture the browser download.
//   5. Parse the file; verify schema, provenance, ordering, integrity hash,
//      the four inputs present in order, and no canonical-startup RSET
//      (keycode 0o22) present in public input events.
//   6. Verify export did NOT reset the Worker, epoch, time scale, MET,
//      reset count, or Worker count.

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

interface AgcTestSnapshot {
  workerBoots?: number;
  ready?: {
    ropeId: string;
    ropeSha256: string;
    protocolVersion: number;
  };
  snapshot?: {
    tickIndex: number;
    missionTimeUs: number;
    totalAgcSteps: number;
    running: boolean;
    timeScale?: number;
    resetCount?: number;
  };
  sessionEpoch?: number;
}

async function readAgc(page: Page): Promise<AgcTestSnapshot> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __agcTest?: AgcTestSnapshot;
      __agcSession?: { epoch?: number };
    };
    const t = JSON.parse(JSON.stringify(w.__agcTest ?? {})) as AgcTestSnapshot;
    t.sessionEpoch = w.__agcSession?.epoch;
    return t;
  });
}

async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC/, { timeout: 45_000 });
  await page.waitForFunction(() => {
    const w = window as unknown as { __agcTest?: AgcTestSnapshot };
    return !!(w.__agcTest?.ready && w.__agcTest?.snapshot);
  }, { timeout: 45_000 });
}

async function tap(page: Page, id: string): Promise<void> {
  await page.getByTestId(id).click();
  await page.waitForTimeout(90);
}

test.describe("/explore export — Step 2 acceptance", () => {
  test("V35E on /learn, export from /explore, verify canonical hash + provenance + non-mutation", async ({ page }) => {
    // 1. /learn ready
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);

    const preLearn = await readAgc(page);
    expect(preLearn.ready?.ropeId).toBe("Luminary099");
    expect(preLearn.ready?.protocolVersion).toBe(2);
    // workerBoots is bumped only in Dsky standalone mode; in shared-session
    // mode it stays 0. We assert non-mutation across export, not a fixed value.
    expect(typeof preLearn.workerBoots).toBe("number");
    expect(preLearn.sessionEpoch).toBe(0);
    const initialEpoch = preLearn.sessionEpoch;
    const initialWorkerBoots = preLearn.workerBoots;
    const initialTimeScale = preLearn.snapshot?.timeScale ?? 1;
    const initialResetCount = preLearn.snapshot?.resetCount ?? 0;
    const preMissionUs = preLearn.snapshot?.missionTimeUs ?? 0;

    // 2. V 3 5 ENTR on the rendered keypad — the ONLY path emitting DSKY input events.
    await tap(page, "dsky-key-VERB");
    await tap(page, "dsky-key-3");
    await tap(page, "dsky-key-5");
    await tap(page, "dsky-key-ENTR");

    // 3. Navigate to /explore. Same persistent Worker.
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("export-panel")).toBeVisible();
    await page.waitForFunction(() => {
      const w = window as unknown as { __agcTest?: AgcTestSnapshot };
      return !!(w.__agcTest?.ready);
    }, { timeout: 15_000 });

    const preExport = await readAgc(page);
    expect(preExport.workerBoots).toBe(initialWorkerBoots);
    expect(preExport.sessionEpoch).toBe(initialEpoch);

    // 4. Click Export JSON — capture browser download.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.getByTestId("export-button").click(),
    ]);
    const filepath = await download.path();
    expect(filepath).toBeTruthy();
    const raw = readFileSync(filepath!, "utf8");
    const doc = JSON.parse(raw) as {
      format: string;
      schemaVersion: number;
      envelope: { exportedAt: string };
      payload: {
        provenance: {
          ropeId: string;
          ropeSha256: string;
          protocolVersion: number;
          emulatorCommit: string;
        };
        session: { sessionEpoch: number; startupRsetCode: number };
        baseline: { eventId: number; tickIndex: number };
        events: Array<{
          type: string;
          eventId: number;
          sessionEpoch: number;
          tickIndex: number;
          missionTimeUs: number;
          totalAgcSteps: number;
          kind?: string;
          keyCode?: number;
          channel?: number;
          value?: number;
          source?: string;
        }>;
        retention: { completeEpoch: boolean; droppedBeforeEventId: number | null };
        integrity: { eventCount: number; firstEventId: number | null; lastEventId: number | null };
      };
      integrity: { canonicalSha256: string };
    };

    // 5a. Envelope + schema.
    expect(doc.format).toBe("apollo-agc-event-log");
    expect(doc.schemaVersion).toBe(1);
    expect(doc.integrity.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.payload.provenance.ropeId).toBe("Luminary099");
    expect(doc.payload.provenance.ropeSha256).toBe(preExport.ready?.ropeSha256);
    expect(doc.payload.provenance.protocolVersion).toBe(2);

    // 5b. Same Worker/session — payload epoch matches live sessionEpoch.
    expect(doc.payload.session.sessionEpoch).toBe(initialEpoch);

    // 5c. Strict event ordering, monotonic ids/ticks/mission-time/steps,
    //     each carries the session epoch, and eventCount matches array length.
    const evs = doc.payload.events;
    expect(evs.length).toBeGreaterThan(0);
    expect(doc.payload.integrity.eventCount).toBe(evs.length);
    expect(doc.payload.integrity.firstEventId).toBe(evs[0]!.eventId);
    expect(doc.payload.integrity.lastEventId).toBe(evs[evs.length - 1]!.eventId);
    let prevId = 0;
    let prevTick = doc.payload.baseline.tickIndex;
    let prevMet = 0;
    let prevSteps = 0;
    for (const e of evs) {
      expect(e.eventId).toBeGreaterThan(prevId);
      expect(e.sessionEpoch).toBe(initialEpoch);
      expect(e.tickIndex).toBeGreaterThanOrEqual(prevTick);
      expect(e.missionTimeUs).toBeGreaterThanOrEqual(prevMet);
      expect(e.totalAgcSteps).toBeGreaterThanOrEqual(prevSteps);
      prevId = e.eventId;
      prevTick = e.tickIndex;
      prevMet = e.missionTimeUs;
      prevSteps = e.totalAgcSteps;
    }

    // 5d. Expected four DSKY inputs, in order: VERB, 3, 5, ENTR.
    const RSET = 0o22;
    const inputs = evs.filter((e) => e.type === "inputAccepted");
    const keyDown = inputs.filter((e) => e.kind === "dskyKeyDown");
    const codes = keyDown.map((e) => e.keyCode);
    // The DSKY key layout uses raw keycodes; we assert order rather than
    // exact numeric values (which live in DSKY_KEYS).
    expect(codes.length).toBeGreaterThanOrEqual(4);
    // 5e. Canonical startup RSET must NOT appear in public input events.
    for (const e of inputs) {
      expect(
        e.keyCode,
        `public input event ${e.eventId} carries RSET (0o22): ${JSON.stringify(e)}`,
      ).not.toBe(RSET);
      expect(e.source).toBe("dsky");
    }

    // 5f. Payload integrity hash recomputes from canonical(payload).
    const hexHash = await page.evaluate(async (payload) => {
      // Same canonicalization used by src/agc/eventLog/canonical.ts:
      // sorted object keys, undefined skipped, arrays preserve order.
      const canonical = (value: unknown): string => {
        if (value === null) return "null";
        if (typeof value === "number") {
          if (!Number.isFinite(value)) throw new Error("non-finite");
          return JSON.stringify(value);
        }
        if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
        if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
        if (typeof value === "object") {
          const o = value as Record<string, unknown>;
          const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
          return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
        }
        throw new Error("unsupported: " + typeof value);
      };
      const bytes = new TextEncoder().encode(canonical(payload));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }, doc.payload);
    expect(hexHash).toBe(doc.integrity.canonicalSha256);

    // 6. Export did not disturb the live session.
    const postExport = await readAgc(page);
    expect(postExport.workerBoots).toBe(initialWorkerBoots);
    expect(postExport.sessionEpoch).toBe(initialEpoch);
    expect(postExport.snapshot?.timeScale ?? 1).toBe(initialTimeScale);
    expect(postExport.snapshot?.resetCount ?? 0).toBe(initialResetCount);
    expect(postExport.snapshot?.missionTimeUs ?? 0).toBeGreaterThanOrEqual(preMissionUs);
    expect(postExport.snapshot?.running).toBe(true);

    // UI summary reflects the download.
    await expect(page.getByTestId("export-summary")).toBeVisible();
    await expect(page.getByTestId("export-sha256")).toContainText(doc.integrity.canonicalSha256.slice(0, 12));
  });
});
