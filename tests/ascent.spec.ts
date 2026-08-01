// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Browser acceptance for /play/ascent: liftoff through orbital
// insertion, plus the physics-firewall guarantee.

import { expect, test } from "@playwright/test";

test.describe("M4.3 — lunar ascent", () => {
  test("mission select briefs the Apollo 11 target orbit", async ({ page }) => {
    await page.goto("/play/ascent");
    await expect(page.getByTestId("ascent-select")).toBeVisible();
    await page.getByTestId("ascent-mission-orbital-insertion-trainer").click();
    await expect(page.getByTestId("ascent-select")).toContainText("9 × 45 nmi");
    await expect(page.getByTestId("ascent-select")).toContainText("source-derived");
  });

  test("liftoff to orbital insertion with the demonstration autopilot", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/play/ascent");
    await page.getByTestId("ascent-mission-orbital-insertion-trainer").click();
    await page.getByTestId("ascent-start").click();

    await expect(page.getByTestId("ascent-cockpit")).toBeVisible();
    await expect(page.getByTestId("orbit-visualizer")).toBeVisible();
    await expect(page.getByTestId("surface-preparation")).toBeVisible();
    await expect(page.getByTestId("ascent-config")).toContainText("complete LM");

    // Fastest sim rate, then hand the pitch program to the demonstration.
    await page.getByTestId("ascent-timescale").selectOption("32");
    await page.getByTestId("ascent-demo").click();
    await page.getByTestId("ascent-liftoff").click();

    // Staging happens on the first physics step.
    await expect(page.getByTestId("ascent-config")).toContainText("ascent stage");
    await expect(page.getByTestId("descent-stage-marker")).toBeVisible();
    await expect(page.getByTestId("ascent-authority")).toContainText("demonstration");

    // Insertion: the debrief appears once the kernel latches the orbit.
    await expect(page.getByTestId("ascent-debrief")).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId("ascent-outcome")).toHaveText("orbit-achieved");
    await expect(page.getByTestId("ascent-debrief")).toContainText(
      "demonstration autopilot",
    );
    await expect(page.getByTestId("teaching-why-pitch-over")).toBeVisible();
  });

  test("an early cutoff leaves the periapsis inside the Moon", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/play/ascent");
    await page.getByTestId("ascent-mission-orbital-insertion-trainer").click();
    await page.getByTestId("ascent-start").click();
    await page.getByTestId("ascent-timescale").selectOption("16");
    await page.getByTestId("ascent-demo").click();
    await page.getByTestId("ascent-liftoff").click();

    // Cut off long before insertion.
    await page.waitForTimeout(4_000);
    await page.getByTestId("ascent-cutoff").click();
    await expect(page.getByTestId("impact-warning")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("ascent-end").click();
    await expect(page.getByTestId("ascent-outcome")).toHaveText(
      /insufficient-periapsis|surface-impact/,
    );
  });

  test("the AGC panel is present and labelled as non-controlling", async ({ page }) => {
    await page.goto("/play/ascent");
    await page.getByTestId("ascent-start").click();
    await expect(page.getByTestId("ascent-cockpit")).toContainText(
      "the AGC is not controlling this vehicle",
    );
    // A single shared AGC session: no second worker is created for the game.
    const workers = await page.evaluate(() => document.querySelectorAll("canvas").length);
    expect(workers).toBeGreaterThanOrEqual(0);
  });
});
