// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.2 — one complete learn → fly → debrief flow, plus local-progress
// durability and defensive handling of corrupt stored progress.

import { test, expect } from "@playwright/test";

const PROGRESS_KEY = "agc-tranquility:learning-progress:v1";

test.describe("M4.2 learning campaign", () => {
  test("tracks render and lesson progress survives a reload", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.getByRole("navigation", { name: /Track 1/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Track 4/ })).toBeVisible();
    await expect(page.getByTestId("progress-panel")).toBeVisible();

    // Complete a short reading lesson by acknowledging every step.
    await page.getByTestId("lesson-nav-lesson-08-why-the-lm-falls").click();
    for (let i = 0; i < 12; i++) {
      const ack = page.getByTestId("lesson-ack");
      if (!(await ack.isVisible().catch(() => false))) break;
      await ack.click();
    }
    await expect(page.getByTestId("lesson-complete-banner")).toBeVisible();

    const stored = await page.evaluate((k) => window.localStorage.getItem(k), PROGRESS_KEY);
    expect(stored).toContain("lesson-08-why-the-lm-falls");

    await page.reload();
    await expect(page.getByTestId("progress-summary")).toContainText("/16 lessons");
    await expect(page.getByTestId("progress-summary")).not.toContainText("0/16");
  });

  test("corrupt stored progress fails safely", async ({ page }) => {
    await page.goto("/learn");
    await page.evaluate((k) => window.localStorage.setItem(k, "{not json"), PROGRESS_KEY);
    await page.reload();
    await expect(page.getByTestId("progress-summary")).toContainText("0/16 lessons");
    await expect(page.getByRole("navigation", { name: /Track 1/ })).toBeVisible();
  });

  test("lesson challenge hands off to /play and the result returns to the lesson", async ({
    page,
  }) => {
    await page.goto("/learn");
    await page.getByTestId("lesson-nav-lesson-13-fly-the-terminal-descent").click();

    // Advance to the challenge step.
    for (let i = 0; i < 12; i++) {
      const fly = page.getByTestId("lesson-fly-it");
      if (await fly.isVisible().catch(() => false)) break;
      const ack = page.getByTestId("lesson-ack");
      if (!(await ack.isVisible().catch(() => false))) break;
      await ack.click();
    }
    const fly = page.getByTestId("lesson-fly-it");
    await expect(fly).toBeVisible();
    await fly.click();

    await expect(page).toHaveURL(/\/play\?.*lesson=lesson-13/);
    await expect(page.getByTestId("challenge-briefing")).toBeVisible();

    // Simulate the completed flight result the game publishes on debrief.
    await page.evaluate(() => {
      const result = {
        version: 1,
        lessonId: "lesson-13-fly-the-terminal-descent",
        stepId: new URLSearchParams(window.location.search).get("step"),
        missionId: "terminal-descent",
        difficulty: "instructor",
        score: 780,
        maxScore: 1000,
        grade: "B",
        outcome: "landed",
        passed: true,
        flight: {
          verticalSpeedMps: -0.6,
          horizontalSpeedMps: 0.2,
          propellantRemainingKg: 380,
          landingZoneErrorM: 45,
          missionTimeS: 121,
        },
        atMs: Date.now(),
      };
      window.sessionStorage.setItem(
        "agc-tranquility:challenge-result:v1",
        JSON.stringify(result),
      );
    });

    await page.goto("/learn");
    await expect(page.getByTestId("lesson-challenge-result")).toBeVisible();
    await expect(page.getByTestId("lesson-result-score")).toContainText("780");
    await expect(page.getByTestId("progress-summary")).toContainText("1 challenge flown");
  });
});
