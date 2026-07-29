// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.e — monitor-mode browser acceptance.
//
// Proves, against the real Wrangler-served production bundle:
//   * simulation protocol v2 handshake on a SINGLE shared Worker,
//   * monitor dormancy as the production default,
//   * atomic entry/exit of `discrete-observer-v0` (trace arming, owned-bit
//     merges into CHAN 030/033, retained diagnostics cleared on exit),
//   * `descent-monitor-v1` is BLOCKED with authentic unresolved-mapping
//     reasons and never partially enters,
//   * interlock on scenario reset,
//   * throttle magnitude is never presented as a resolved percentage,
//   * LM physics is bit-identical with the monitor on and off.

import { expect, test, type Page } from "@playwright/test";

type Samples = Record<string, [number, number, number]>;

async function waitForSimReady(page: Page): Promise<void> {
  await expect(page.getByTestId("sim-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sim-protocol")).toHaveText("2");
  await expect(page.getByTestId("sim-tick-us")).toHaveText("20000");
  await expect(page.getByTestId("mission-snapshot")).toBeVisible({ timeout: 30_000 });
}

async function workerBoots(page: Page): Promise<number> {
  return await page.evaluate(() =>
    Number(((window as unknown as { __agcTest?: { workerBoots?: number } }).__agcTest?.workerBoots) ?? 0),
  );
}

async function readSamples(page: Page): Promise<Samples> {
  return await page.evaluate(() => {
    const w = window as unknown as { __missionSamples?: Samples };
    return { ...(w.__missionSamples ?? {}) };
  });
}

async function clearSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __missionSamples?: Samples }).__missionSamples = {};
  });
}

async function startGolden(page: Page): Promise<void> {
  await page.getByTestId("cmd-start-golden").click();
  await expect(page.getByTestId("ms-status")).toHaveText("running", { timeout: 30_000 });
}

test.describe("M3.3A2-P5.e monitor mode", () => {
  test("boots protocol v2 on one Worker with the monitor dormant", async ({ page }) => {
    const wasmRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith(".wasm")) wasmRequests.push(new URL(r.url()).pathname);
    });

    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);

    expect(await workerBoots(page)).toBe(1);
    // Only the canonical extended runtime is fetched in production.
    expect(new Set(wasmRequests)).toEqual(new Set(["/agc/yaAGC-ext.wasm"]));

    // Production default: no profile, no trace, no retained diagnostics.
    await expect(page.getByTestId("mon-profile")).toHaveText("off");
    await expect(page.getByTestId("mon-status")).toHaveText("off");
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
    await expect(page.getByTestId("mon-trace-count")).toHaveText("0");

    // The panel must state its own limits, verbatim.
    const banner = page.getByTestId("monitor-banner");
    await expect(banner).toContainText("DISCRETE INTERFACE DIAGNOSTIC ONLY");
    await expect(banner).toContainText("NOT A POWERED-DESCENT MONITOR");
    await expect(page.getByTestId("monitor-warning")).toContainText(
      "never applied to the spacecraft",
    );
  });

  test("entering discrete-observer-v0 arms the trace and merges owned bits", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    // Monitor entry requires an ACTIVE scenario — the profile may not arm
    // against an idle runtime.
    await startGolden(page);

    // Operator declares the discretes; the Worker never invents them.
    await page.getByTestId("av-engineArmed").click();
    await page.getByTestId("av-lgcInControl").click();
    await page.getByTestId("av-imuHealthy").click();
    await page.getByTestId("av-issOperate").click();

    await page.getByTestId("mon-enter-discrete").click();
    await expect(page.getByTestId("mon-profile")).toHaveText("discrete-observer-v0", { timeout: 30_000 });
    await expect(page.getByTestId("mon-status")).toHaveText("active");
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("true");

    // Owned input channels are rendered as COMPLETE octal words with a
    // non-empty owned mask; unowned bits stay under other host paths.
    const ch30 = page.getByTestId("mon-in-ch030");
    await expect(ch30).toContainText(/word 0[0-7]{5} owned-mask 0[0-7]{5}/);
    await expect(page.getByTestId("mon-in-ch033")).toContainText("CH033");
    const ch30Text = await ch30.textContent();
    expect(ch30Text).not.toContain("owned-mask 000000");

    // Retained diagnostics accumulate while active.
    await expect
      .poll(async () => Number(await page.getByTestId("mon-trace-count").textContent()), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    await page.getByTestId("mon-request-trace").click();
    await expect(page.getByTestId("mon-trace")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mon-trace-row").first()).toContainText(/IN {2}CH03[03]/);

    // Throttle magnitude is never resolved into a number or percentage.
    const throttle = page.getByTestId("mon-throttle");
    await expect(throttle).toHaveText("null — PHYSICAL THROTTLE SCALE NOT YET RESOLVED");
    await expect(throttle).not.toContainText("%");
  });

  test("descent-monitor-v1 is blocked with unresolved-mapping reasons", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);

    await page.getByTestId("mon-enter-descent").click();
    await expect(page.getByTestId("mon-blocked")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("mon-block-reason").first()).toContainText(
      "unresolved-sensor-mapping",
    );
    // No partial entry: the profile never becomes descent-monitor-v1.
    await expect(page.getByTestId("mon-profile")).not.toHaveText("descent-monitor-v1");
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
  });

  test("exiting the profile disarms the trace and clears retained diagnostics", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);
    await page.getByTestId("av-engineArmed").click();
    await page.getByTestId("mon-enter-discrete").click();
    await expect(page.getByTestId("mon-status")).toHaveText("active", { timeout: 30_000 });

    await page.getByTestId("mon-exit").click();
    await expect(page.getByTestId("mon-profile")).toHaveText("off", { timeout: 30_000 });
    await expect(page.getByTestId("mon-status")).toHaveText("off");
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
    await expect(page.getByTestId("mon-trace-count")).toHaveText("0");
  });

  test("a scenario reset interlocks the monitor instead of re-arming it", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);

    await page.getByTestId("av-engineArmed").click();
    await page.getByTestId("mon-enter-discrete").click();
    await expect(page.getByTestId("mon-status")).toHaveText("active", { timeout: 30_000 });

    await page.getByTestId("cmd-reset-scenario").click();
    await expect(page.getByTestId("mon-status")).toHaveText("interlocked", { timeout: 30_000 });
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
  });

  test("LM physics is bit-identical with the monitor off and on", async ({ browser }) => {
    // Two FRESH sessions rather than an in-page reset: each boots the same
    // canonical runtime and starts the same golden scenario, so physics is a
    // pure function of scenario-elapsed time in both.
    async function run(withMonitor: boolean): Promise<Samples> {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/dev/mission-runtime");
      await waitForSimReady(page);
      await startGolden(page);
      if (withMonitor) {
        await page.getByTestId("av-engineArmed").click();
        await page.getByTestId("av-lgcInControl").click();
        await page.getByTestId("mon-enter-discrete").click();
        await expect(page.getByTestId("mon-status")).toHaveText("active", { timeout: 30_000 });
      }
      await page.waitForTimeout(8_000);
      const samples = await readSamples(page);
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
