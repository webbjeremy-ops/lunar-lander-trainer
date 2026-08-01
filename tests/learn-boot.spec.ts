// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — /learn boot acceptance.
//
// Scope: cold start of the shared AGC session only. Proves the real rope and
// emulator are loaded, exactly one dedicated Worker exists, the accessibility
// live-region budget is respected, and the boot presentation is explicit.
// Contains NO lesson interaction, so a failure here is unambiguously a boot
// or bundling regression.

import { test, expect } from "@playwright/test";
import {
  attachRecorder,
  diagnostics,
  expectNoRelevantErrors,
  readAgc,
  waitForReady,
  type LearnRecorder,
} from "./support/learn";

test.describe("/learn boot", () => {
  let rec: LearnRecorder;

  test.beforeEach(async ({ page, context }) => {
    rec = attachRecorder(page, context);
  });

  test("boots the pinned rope and emulator in exactly one Worker", async ({ page }) => {
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);

    const agc = await readAgc(page);
    expect(agc.ready?.ropeId, `diag=${await diagnostics(page)}`).toBe("Luminary099");
    expect(agc.ready?.ropeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(agc.ready?.emulatorCommit).toBeTruthy();
    expect(agc.ready?.protocolVersion).toBe(2);

    expect(rec.agcWorkers().length, `workers=${JSON.stringify(rec.workerUrls)}`).toBe(1);
    expect(agc.workerBoots).toBe(1);
    expect(agc.snapshot!.tickIndex).toBeGreaterThan(0);

    expectNoRelevantErrors(rec);
  });

  test("exposes exactly two aria-live regions", async ({ page }) => {
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);

    expect(await page.locator("[aria-live]").count(), "expected exactly 2 aria-live regions").toBe(2);
    await expect(page.getByTestId("dsky-live")).toBeVisible();
    await expect(page.getByTestId("lesson-host-status")).toBeVisible();
  });

  test("cold start reserves DSKY layout so boot causes no shift", async ({ page }) => {
    await page.goto("/learn", { waitUntil: "domcontentloaded" });

    // The DSKY frame and its phase badge must exist before the rope finishes
    // loading — the panel reserves its own space rather than popping in.
    const frame = page.getByTestId("agc-dsky");
    await expect(frame).toBeVisible({ timeout: 30_000 });
    const before = await frame.boundingBox();
    expect(before, "DSKY frame must occupy layout during boot").toBeTruthy();

    await waitForReady(page);
    const after = await frame.boundingBox();
    expect(after).toBeTruthy();
    // Height must not jump when the emulator becomes ready.
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);
  });
});
