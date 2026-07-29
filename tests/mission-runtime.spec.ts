// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.2 /dev/mission-runtime Playwright acceptance.
//
// Verifies the mission-runtime harness renders against the SAME AGC Worker
// the rest of the app holds — no second Worker, no independent emulator
// state — and that the runtime status persists across route navigation.

import { expect, test, type Page } from "@playwright/test";

async function readWorkerBoots(page: Page): Promise<number> {
  return await page.evaluate(() =>
    Number(((window as unknown as { __agcTest?: { workerBoots?: number } }).__agcTest?.workerBoots) ?? 0),
  );
}

async function waitForSimReady(page: Page): Promise<void> {
  await expect(page.getByTestId("sim-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sim-protocol")).toHaveText("1");
  await expect(page.getByTestId("sim-tick-us")).toHaveText("20000");
}

test.describe("M3.2 /dev/mission-runtime", () => {
  test("harness renders sim:ready and publishes a mission snapshot", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await expect(page.getByTestId("mission-snapshot")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ms-status")).toHaveText(/idle|running/);
    // Snapshot must include the shared MissionClock pause state and be
    // distinct from runtime status — see MissionSnapshot contract.
    await expect(page.getByTestId("ms-clock-paused")).toHaveText(/true|false/);
  });

  test("workerBoots stays at 1 across /learn ↔ /dev/mission-runtime navigation", async ({ page }) => {
    await page.goto("/learn");
    // Wait for the shared session to boot the Worker once.
    await page.waitForFunction(
      () => Number(((window as unknown as { __agcTest?: { workerBoots?: number } }).__agcTest?.workerBoots) ?? 0) >= 1,
      undefined,
      { timeout: 30_000 },
    );
    const boot1 = await readWorkerBoots(page);
    expect(boot1).toBe(1);

    await page.getByTestId("nav-mission-runtime").click();
    await waitForSimReady(page);
    const boot2 = await readWorkerBoots(page);
    expect(boot2).toBe(1);

    await page.getByTestId("nav-learn").click();
    // Give React one macrotask to settle after navigation.
    await page.waitForTimeout(200);
    const boot3 = await readWorkerBoots(page);
    expect(boot3).toBe(1);
  });

  test("startScenario transitions status to running and physics advances", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await page.getByTestId("cmd-start-golden").click();

    // Wait for the runtime to accept the command and enter `running`.
    await expect(page.getByTestId("ms-status")).toHaveText("running", { timeout: 30_000 });
    // Scenario elapsed µs must strictly increase across two snapshots.
    const first = await page.getByTestId("ms-elapsed").innerText();
    await page.waitForTimeout(500);
    const second = await page.getByTestId("ms-elapsed").innerText();
    expect(Number(second)).toBeGreaterThan(Number(first));
  });
});
