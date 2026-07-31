// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3E — browser acceptance for the SYNTHETIC AGC HARDWARE-INTERFACE LAB.
//
// Runs against the real Wrangler-served production bundle, the single shared
// Worker and the canonical HW-I/O v4 runtime. Proves in the browser:
//
//   * the lab is opt-in and dormant by default;
//   * entering it delivers native PIPA pulses derived ONLY from scenario
//     specific force;
//   * the panel never claims rope consumption, never reports an authentic
//     mission request, and never runs a repeating host radar timer;
//   * exiting clears every retained lab diagnostic;
//   * LM physics stays bit-identical with the lab off and on (physics
//     firewall: AGC output is diagnostic only).

import { expect, test, type Page } from "@playwright/test";

type Samples = Record<string, [number, number, number]>;

async function waitForSimReady(page: Page): Promise<void> {
  await expect(page.getByTestId("sim-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sim-protocol")).toHaveText("2");
  await expect(page.getByTestId("mission-snapshot")).toBeVisible({ timeout: 30_000 });
}

async function startGolden(page: Page): Promise<void> {
  await page.getByTestId("cmd-start-golden").click();
  await expect(page.getByTestId("ms-status")).toHaveText("running", { timeout: 30_000 });
}

async function enterLab(page: Page): Promise<void> {
  for (const d of ["engineArmed", "lgcInControl", "imuHealthy", "issOperate", "pipaHealthy"]) {
    const toggle = page.getByTestId(`av-${d}`);
    if (await toggle.count()) await toggle.click();
  }
  await page.getByTestId("mon-enter-lab").click();
  await expect(page.getByTestId("mon-profile")).toHaveText(
    "agc-hardware-interface-lab-v1",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("mon-status")).toHaveText("active");
}

test.describe("M3.3E synthetic hardware-interface lab", () => {
  test("is dormant until explicitly entered", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await expect(page.getByTestId("mon-profile")).toHaveText("off");
    await expect(page.getByTestId("mon-lab")).toHaveCount(0);
  });

  test("delivers native PIPA pulses and labels itself synthetic", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);
    await enterLab(page);

    const lab = page.getByTestId("mon-lab");
    await expect(lab).toBeVisible({ timeout: 30_000 });
    await expect(lab).toContainText("SYNTHETIC");

    // Scenario thrust produces real hardware pulses.
    await expect
      .poll(async () => Number(await page.getByTestId("mon-lab-pulses").textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // Delivery is never presented as rope consumption.
    await expect(page.getByTestId("mon-lab-rope")).toContainText("NO —");
    await expect(page.getByTestId("mon-lab-rope")).toContainText(
      "rope consumption not active in this scenario",
    );

    // No fabricated Apollo operation: no authentic mission request, no
    // repeating host-side radar timer.
    await expect(page.getByTestId("mon-lab-authentic")).toHaveText("0");
    await expect(page.getByTestId("mon-lab-timer")).not.toContainText("true");
  });

  test("radar transactions only ever follow an observed CHAN13 request", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);
    await enterLab(page);
    await expect(page.getByTestId("mon-lab")).toBeVisible({ timeout: 30_000 });

    await page.waitForTimeout(5_000);
    const observed = Number(await page.getByTestId("mon-lab-chan13").textContent());
    const [delivered, refused] = (await page.getByTestId("mon-lab-radar").textContent())!
      .split("/")
      .map((s) => Number(s.trim()));

    // Luminary in P00 solicits nothing, so answers can never exceed requests.
    expect(delivered + refused).toBeLessThanOrEqual(observed);
    expect(delivered).toBeLessThanOrEqual(observed);
  });

  test("exiting clears every retained lab diagnostic", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);
    await enterLab(page);
    await expect
      .poll(async () => Number(await page.getByTestId("mon-lab-pulses").textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    await page.getByTestId("mon-exit").click();
    await expect(page.getByTestId("mon-profile")).toHaveText("off", { timeout: 30_000 });
    await expect(page.getByTestId("mon-lab")).toHaveCount(0);
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
  });

  test("LM physics is bit-identical with the lab off and on", async ({ browser }) => {
    async function run(withLab: boolean): Promise<Samples> {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/dev/mission-runtime");
      await waitForSimReady(page);
      await startGolden(page);
      if (withLab) await enterLab(page);
      await page.waitForTimeout(8_000);
      const samples = await page.evaluate(() => {
        const w = window as unknown as { __missionSamples?: Samples };
        return { ...(w.__missionSamples ?? {}) };
      });
      await context.close();
      return samples;
    }

    const runOff = await run(false);
    const runOn = await run(true);
    expect(Object.keys(runOff).length).toBeGreaterThan(3);
    const shared = Object.keys(runOff).filter((k) => k in runOn);
    expect(shared.length).toBeGreaterThan(2);
    for (const k of shared) {
      expect(runOn[k], `scenarioElapsedUs=${k}`).toEqual(runOff[k]);
    }
  });
});
