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

// ---------------------------------------------------------------------------
// M4.1 final acceptance — full journey, isolation, and regression guards.
// ---------------------------------------------------------------------------

type Diag = { workerBoots?: number };

const readDiag = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __agcTest?: Diag }).__agcTest ?? {});

function collect(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const altitude = async (page: import("@playwright/test").Page) =>
  Number((await page.getByTestId("inst-altitude").innerText()).replace(/[^\d.]/g, ""));

test.describe("M4.1 acceptance", () => {
  test("full AGC-assisted journey: locked → DSKY → unlock → descent → player input", async ({
    page,
  }) => {
    const errors = collect(page);
    await page.goto("/play");
    await page.getByTestId("mission-apollo11-powered-descent").click();
    await page.getByTestId("mode-agc-assisted").click();
    await page.getByTestId("assist-pilot").click();
    await page.getByTestId("mission-start").click();

    // Controls locked, and no one-click bypass exists in AGC-assisted mode.
    await expect(page.getByTestId("flight-lock")).toBeVisible();
    await expect(page.getByTestId("ctl-throttle-up")).toBeDisabled();
    await expect(page.getByTestId("play-runpause")).toBeDisabled();
    await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC|PAUSED/, {
      timeout: 90_000,
    });

    // DSKY registers stay readable in the compact cockpit column.
    const dsky = page.getByTestId("dsky-registers");
    if (await dsky.count()) {
      const box = await dsky.first().boundingBox();
      expect(box!.width).toBeGreaterThan(120);
    }

    const key = (label: string) => page.getByTestId(`dsky-key-${label}`).click();

    // PHYSICS ISOLATION: keying the live AGC while locked moves nothing.
    const metBefore = await page.getByTestId("play-met").innerText();
    const altBefore = await altitude(page);
    for (const k of ["VERB", "3", "5", "ENTR"]) await key(k);
    expect(await page.getByTestId("play-met").innerText()).toBe(metBefore);
    expect(await altitude(page)).toBe(altBefore);
    await expect(page.getByTestId("procedure-progress")).toHaveText(/^0 \/ \d+$/);
    await key("CLR");

    // V37E 63E
    for (const k of ["VERB", "3", "7", "ENTR", "6", "3", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("1 / 5");

    // Wrong input does not advance; CLR/retry recovers.
    await key("9");
    await expect(page.getByTestId("procedure-message")).toContainText(/CLR/i);
    await expect(page.getByTestId("procedure-progress")).toHaveText("1 / 5");
    await key("CLR");

    // V16 N62 E, then PRO releases the flight lock.
    for (const k of ["VERB", "1", "6", "NOUN", "6", "2", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("2 / 5");
    await key("PRO");
    await expect(page.getByTestId("procedure-progress")).toHaveText("3 / 5");
    await expect(page.getByTestId("flight-lock")).toHaveCount(0);

    // Descent is actually running.
    await expect
      .poll(async () =>
        Number((await page.getByTestId("play-met").innerText()).replace(/[^\d.]/g, "")),
      )
      .toBeGreaterThan(0);

    // P66 takeover, then real player control input.
    for (const k of ["VERB", "0", "6", "NOUN", "6", "4", "ENTR"]) await key(k);
    for (const k of ["VERB", "3", "7", "ENTR", "6", "6", "ENTR"]) await key(k);
    await expect(page.getByTestId("procedure-progress")).toHaveText("5 / 5");
    await expect(page.getByTestId("control-authority")).toHaveText(/pilot has control/i);
    await expect(page.getByTestId("ctl-throttle-up")).toBeEnabled();
    await page.getByTestId("ctl-throttle-up").click();
    await page.getByTestId("ctl-rod-down").click();
    await page.keyboard.press("ArrowUp");

    // Deterministic active-flight state, single AGC worker, clean console.
    await expect(page.getByTestId("play-instruments")).toBeVisible();
    expect((await readDiag(page)).workerBoots).toBe(1);
    expect(errors).toEqual([]);
  });

  test("restart returns the mission and procedure to the initial state", async ({ page }) => {
    const errors = collect(page);
    await page.goto("/play");
    await page.getByTestId("mission-terminal-descent").click();
    await page.getByTestId("mode-agc-assisted").click();
    await page.getByTestId("mission-start").click();
    const alt0 = await altitude(page);

    await page.getByTestId("procedure-takeover").click();
    await expect
      .poll(async () =>
        Number((await page.getByTestId("play-met").innerText()).replace(/[^\d.]/g, "")),
      )
      .toBeGreaterThan(0);

    await page.getByTestId("play-restart").click();
    await expect(page.getByTestId("play-met")).toHaveText(/MET 0\.0 s/);
    expect(await altitude(page)).toBe(alt0);
    await expect(page.getByTestId("procedure-progress")).toHaveText(/^0 \/ \d+$/);
    await expect(page.getByTestId("flight-lock")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("navigating away and back does not duplicate the AGC worker or the mission loop", async ({
    page,
  }) => {
    const errors = collect(page);
    await page.goto("/play");
    await page.getByTestId("mission-landing-fundamentals").click();
    await page.getByTestId("mode-quick-manual").click();
    await page.getByTestId("mission-start").click();
    await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC|PAUSED/, {
      timeout: 90_000,
    });
    expect((await readDiag(page)).workerBoots).toBe(1);

    await page.getByRole("link", { name: "Learn", exact: true }).first().click();
    await expect(page).toHaveURL(/\/learn/);
    await page.goBack();
    await expect(page.getByTestId("mission-select")).toBeVisible();
    await page.getByTestId("mission-landing-fundamentals").click();
    await page.getByTestId("mission-start").click();
    await expect(page.getByTestId("play-cockpit")).toBeVisible();
    expect((await readDiag(page)).workerBoots).toBe(1);
    expect(errors).toEqual([]);
  });
});
