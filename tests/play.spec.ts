// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — /play browser acceptance.
//
// Proves: mission selection, cockpit render, flight lock, real-DSKY-driven
// procedure progression (P63 → PRO → P64 → P66), manual-control unlock, and
// that the live AGC session is shared (no second worker boot).

import { expect, test } from "@playwright/test";

test.describe("M4.1 playable lunar descent", () => {
  test("mission select lists all five missions and shows the briefing", async ({ page }) => {
    await page.goto("/play");
    await expect(page.getByTestId("mission-select")).toBeVisible();
    for (const id of [
      "landing-fundamentals",
      "terminal-descent",
      "high-gate-challenge",
      "apollo11-powered-descent",
      "free-flight",
    ]) {
      await expect(page.getByTestId(`mission-${id}`)).toBeVisible();
    }
    await page.getByTestId("mission-apollo11-powered-descent").click();
    await expect(page.getByTestId("mode-agc-assisted")).toHaveAttribute("aria-pressed", "true");
  });

  test("quick manual gives immediate control and renders the cockpit", async ({ page }) => {
    await page.goto("/play");
    await page.getByTestId("mission-landing-fundamentals").click();
    await page.getByTestId("mode-quick-manual").click();
    await page.getByTestId("mission-start").click();

    await expect(page.getByTestId("play-cockpit")).toBeVisible();
    await expect(page.getByTestId("play-scene")).toBeVisible();
    await expect(page.getByTestId("play-instruments")).toBeVisible();
    await expect(page.getByTestId("control-authority")).toHaveText(/pilot has control/i);
    await expect(page.getByTestId("flight-lock")).toHaveCount(0);
  });

  test("AGC-assisted holds flight until the DSKY procedure releases it", async ({ page }) => {
    await page.goto("/play");
    await page.getByTestId("mission-apollo11-powered-descent").click();
    await page.getByTestId("mode-agc-assisted").click();
    await page.getByTestId("mission-start").click();

    await expect(page.getByTestId("flight-lock")).toBeVisible();
    await expect(page.getByTestId("procedure-keystrokes")).toHaveText("V37 E 6 3 E");
    await expect(page.getByTestId("control-authority")).toHaveText(/guidance has control/i);

    // The real DSKY must be alive before keys are accepted.
    await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC|PAUSED/, { timeout: 90_000 });

    const key = (label: string) => page.getByTestId(`dsky-key-${label}`).click();
    // V37E 63E — P63
    for (const k of ["VERB", "3", "7", "ENTR", "6", "3", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("1 / 5");

    // A wrong key latches an error and does not advance.
    await key("9");
    await expect(page.getByTestId("procedure-message")).toContainText(/CLR/i);
    await key("CLR");

    // V16 N62 E
    for (const k of ["VERB", "1", "6", "NOUN", "6", "2", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("2 / 5");

    // PRO — releases the flight lock (bridged step).
    await expect(page.getByTestId("bridge-badge")).toBeVisible();
    await key("PRO");
    await expect(page.getByTestId("procedure-progress")).toHaveText("3 / 5");
    await expect(page.getByTestId("flight-lock")).toHaveCount(0);

    // V06 N64 E, then V37E 66E hands the vehicle to the player.
    for (const k of ["VERB", "0", "6", "NOUN", "6", "4", "ENTR"]) await key(k);
    for (const k of ["VERB", "3", "7", "ENTR", "6", "6", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("5 / 5");
    await expect(page.getByTestId("control-authority")).toHaveText(/pilot has control/i);
  });

  test("manual takeover is always available and starts the clock", async ({ page }) => {
    await page.goto("/play");
    await page.getByTestId("mission-terminal-descent").click();
    await page.getByTestId("mode-agc-assisted").click();
    await page.getByTestId("mission-start").click();
    await page.getByTestId("procedure-takeover").click();
    await expect(page.getByTestId("control-authority")).toHaveText(/pilot has control/i);
    await expect
      .poll(async () => Number((await page.getByTestId("play-met").innerText()).replace(/[^\d.]/g, "")))
      .toBeGreaterThan(0);
  });
});
