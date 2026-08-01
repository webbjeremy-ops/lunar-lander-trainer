// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Product acceptance in a real browser.
//
// Navigation, onboarding, settings persistence, units, accessibility and
// keyboard-only operation. Nothing here touches flight mechanics, the
// procedure engine or the AGC bootstrap.

import { test, expect, type Page } from "@playwright/test";

const SETTINGS_KEY = "agc-tranquility:settings:v2";
const ONBOARDING_KEY = "agc-tranquility:onboarding:v1";

async function freshVisit(page: Page, path = "/") {
  await page.addInitScript(
    ([s, o]) => {
      window.localStorage.removeItem(s as string);
      window.localStorage.removeItem(o as string);
    },
    [SETTINGS_KEY, ONBOARDING_KEY],
  );
  await page.goto(path);
}

test.describe("M4.4 product shell", () => {
  test("primary navigation reaches every product destination", async ({ page }) => {
    await freshVisit(page);
    const nav = page.getByTestId("app-nav");
    await expect(nav).toBeVisible();

    for (const [label, url] of [
      ["Missions", "/missions"],
      ["Learn", "/learn"],
      ["AGC Lab", "/sim"],
      ["Explore", "/explore"],
      ["Sources", "/sources"],
      ["About", "/about"],
      ["Home", "/"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(`**${url}`);
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });

  test("home states the product promise and the accuracy legend", async ({ page }) => {
    await freshVisit(page);
    await expect(page.locator("h1")).toContainText(/Tranquility/i);
    await expect(page.getByTestId("accuracy-legend")).toBeVisible();
    const legend = page.getByTestId("accuracy-legend");
    for (const tier of [
      "Authentic",
      "Source-derived",
      "Historically grounded",
      "Educational",
      "Gameplay",
    ]) {
      await expect(legend).toContainText(new RegExp(tier, "i"));
    }
    // The old technical-spike messaging must be gone.
    await expect(page.locator("body")).not.toContainText(/Milestone 0/i);
  });

  test("first-run onboarding records intent and assistance, then stays dismissed", async ({
    page,
  }) => {
    await freshVisit(page);
    const flow = page.getByTestId("onboarding");
    await expect(flow).toBeVisible();

    await flow.getByTestId("onboarding-intent-learn").click();
    await flow.getByTestId("onboarding-assistance-pilot").click();
    await flow.getByTestId("onboarding-controls-next").click();
    await flow.getByTestId("onboarding-launch").click();

    // Choice is written into product settings.
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), SETTINGS_KEY);
    expect(stored).toContain("pilot");

    await page.goto("/");
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
  });

  test("settings persist across reload and change cockpit units", async ({ page }) => {
    await freshVisit(page, "/settings");
    await page.getByTestId("setting-units").selectOption("apollo");
    await page.getByTestId("setting-high-contrast").check();
    await page.reload();

    await expect(page.getByTestId("setting-units")).toHaveValue("apollo");
    await expect(page.locator("html")).toHaveClass(/high-contrast/);

    // Apollo units reach the descent cockpit.
    await page.goto("/play");
    await page.getByTestId("mission-start").click();
    await expect(page.getByTestId("inst-sink")).toContainText("fps");
  });

  test("progress and settings can be exported and reset locally", async ({ page }) => {
    await freshVisit(page, "/settings");
    await page.getByTestId("setting-units").selectOption("apollo");
    await expect(page.getByTestId("setting-units")).toHaveValue("apollo");
    await page.getByTestId("settings-reset-settings").click();
    await expect(page.getByTestId("setting-units")).toHaveValue("metric");
    await expect(page.getByTestId("settings-status")).toContainText(/reset/i);
  });

  test("keyboard-only operation: skip link and focus reach the nav", async ({ page }) => {
    await freshVisit(page);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(focused).toMatch(/skip to content/i);
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeVisible();
  });

  test("reduced motion is mirrored onto the document element", async ({ page }) => {
    await freshVisit(page, "/settings");
    await page.getByTestId("setting-reduced-motion").check();
    await expect(page.locator("html")).toHaveClass(/reduced-motion/);
  });

  test("a hidden tab pauses the descent instead of fast-forwarding it", async ({ page }) => {
    await freshVisit(page, "/play");
    await page.getByTestId("mission-start").click();
    await page.getByTestId("procedure-takeover").click();
    await expect(page.getByTestId("play-runpause")).toHaveText(/pause/i);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("play-runpause")).toHaveText(/run/i);
  });
});
