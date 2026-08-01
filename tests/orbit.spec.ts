// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Browser acceptance for /play/orbit: reading an orbit, planning a
// node, flying a finite burn, the time-acceleration guard, and the debrief.

import { expect, test } from "@playwright/test";

test.describe("M5.0 — lunar orbital operations", () => {
  test("the cockpit reads out an orbit and offers every exercise", async ({ page }) => {
    await page.goto("/play/orbit");
    await expect(page.getByTestId("orbit-scenario-select")).toBeVisible();
    await expect(page.getByTestId("orbit-map")).toBeVisible();
    await expect(page.getByTestId("orbit-hud")).toBeVisible();

    for (const id of [
      "orbit-fundamentals",
      "save-the-periapsis",
      "circularization-trainer",
      "phasing-burn-trainer",
      "apollo11-orbital-operations",
      "orbit-sandbox",
    ]) {
      await expect(page.getByTestId(`orbit-scenario-${id}`)).toBeVisible();
    }

    // The AGC is never presented as the controller of this vehicle.
    await expect(page.locator("main")).toContainText(
      "the AGC is not controlling this vehicle",
    );
  });

  test("a low periapsis is flagged as an impact trajectory", async ({ page }) => {
    await page.goto("/play/orbit");
    await page.getByTestId("orbit-scenario-save-the-periapsis").click();
    await expect(page.getByTestId("orbit-impact-warning")).toBeVisible();
    await expect(page.getByTestId("orbit-hud")).toContainText("IMPACT TRAJECTORY");
  });

  test("planning a node shows a labelled impulsive preview", async ({ page }) => {
    await page.goto("/play/orbit");
    await page.getByTestId("orbit-scenario-save-the-periapsis").click();

    await page.getByTestId("node-lead").fill("30");
    await page.getByTestId("node-direction").selectOption("prograde");
    await page.getByTestId("node-deltav").fill("15");
    await page.getByTestId("node-commit").click();

    const preview = page.getByTestId("impulsive-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("IMPULSIVE MANEUVER PREVIEW");
    await expect(preview).toContainText("EDUCATIONAL PLANNING APPROXIMATION");

    // Time acceleration is capped while a node is close.
    await expect(page.getByTestId("orbit-time-guard")).toBeVisible();
  });

  test("a guided solution can be loaded and flown, and changes the orbit", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/play/orbit");
    await page.getByTestId("orbit-scenario-save-the-periapsis").click();

    await expect(page.getByTestId("guided-solutions")).toBeVisible();
    await page.getByTestId("guided-solutions").getByRole("button", { name: /load/i }).first().click();
    await expect(page.getByTestId("node-countdown")).toBeVisible();

    // An explicit player action is the only thing that ever fires the engine.
    await page.getByTestId("burn-ignite").click();
    await expect(page.getByTestId("burn-cutoff")).toBeVisible();

    // The burn is finite: it runs for a while, then the planner is free again.
    await expect(page.getByTestId("burn-ignite")).toBeVisible({ timeout: 90_000 });

    // Mission time advanced, so the kernel really integrated.
    const met = await page.getByTestId("orbit-met").textContent();
    expect(Number((met ?? "0").replace(/[^\d.]/g, ""))).toBeGreaterThan(0);
  });

  test("ending an exercise produces a scored debrief with a trace checksum", async ({
    page,
  }) => {
    await page.goto("/play/orbit");
    await page.getByTestId("orbit-scenario-circularization-trainer").click();
    await page.getByTestId("orbit-end").click();

    const debrief = page.getByTestId("orbit-debrief");
    await expect(debrief).toBeVisible();
    await expect(page.getByTestId("orbit-score")).toBeVisible();
    await expect(page.getByTestId("orbit-trace-checksum")).toContainText("trace checksum");
  });
});
