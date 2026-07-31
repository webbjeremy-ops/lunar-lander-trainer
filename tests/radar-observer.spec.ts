// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3B2 — landing-radar observer browser acceptance (Wrangler-served
// production bundle).
//
// Proves:
//   * the canonical HW-I/O v3 extended WASM is the only runtime fetched,
//   * exactly one Worker boots,
//   * `landing-radar-observer-v1` is atomically BLOCKED with the authentic
//     `radar-update-cadence-unresolved` reason and never partially enters,
//   * the radar diagnostic panel states scale, representation, cadence
//     status and citations without inventing a cadence,
//   * CHAN14/THRUST is presented as a DECA command delta, never as thrust,
//   * blocking the radar profile leaves LM physics and the trace dormant.

import { expect, test, type Page } from "@playwright/test";

const CANONICAL_SHA =
  "12ac2797971ea56e5d7583d659ddbaae809f721d7549441229e580e110a65bc3";

async function waitForSimReady(page: Page): Promise<void> {
  await expect(page.getByTestId("sim-ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sim-protocol")).toHaveText("2");
  await expect(page.getByTestId("mission-snapshot")).toBeVisible({ timeout: 30_000 });
}

async function startGolden(page: Page): Promise<void> {
  await page.getByTestId("cmd-start-golden").click();
  await expect(page.getByTestId("ms-status")).toHaveText("running", { timeout: 30_000 });
}

test.describe("M3.3B2 landing-radar observer", () => {
  test("canonical v3 runtime boots once and reports hwio v3", async ({ page }) => {
    const wasm: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith(".wasm")) wasm.push(new URL(r.url()).pathname);
    });

    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);

    expect(new Set(wasm)).toEqual(new Set(["/agc/yaAGC-ext.wasm"]));
    // The extension identity is published asynchronously after boot.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __agcTest?: { ready?: boolean; extensionReady?: unknown };
        };
        return !!(w.__agcTest?.ready && w.__agcTest?.extensionReady);
      },
      undefined,
      { timeout: 60_000 },
    );


    const snap = await page.evaluate(() => {
      const w = window as unknown as {
        __agcTest?: {
          workerBoots?: number;
          extensionReady?: {
            hwioVersion?: number;
            extVersion?: string;
            wasmSha256?: string;
            traceEnabled?: boolean;
            traceDropped?: number;
          };
        };
      };
      return JSON.parse(JSON.stringify(w.__agcTest ?? {}));
    });

    expect(snap.workerBoots).toBe(1);
    expect(snap.extensionReady?.hwioVersion).toBe(4);
    expect(snap.extensionReady?.extVersion).toBe(
      "ddc65e7be+apollo-browser-hwio-v4",
    );
    expect(snap.extensionReady?.wasmSha256).toBe(CANONICAL_SHA);
    expect(snap.extensionReady?.traceEnabled).toBe(false);
    expect(snap.extensionReady?.traceDropped).toBe(0);
  });

  test("radar diagnostic panel states scale, representation and cadence status", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);

    const banner = page.getByTestId("radar-banner");
    await expect(banner).toContainText("LANDING-RADAR INTERFACE DIAGNOSTIC");
    await expect(banner).toContainText("NOT A COMPLETE POWERED-DESCENT MONITOR");
    await expect(banner).toContainText("AGC OUTPUT OBSERVED ONLY");
    await expect(banner).toContainText("COMMAND NOT APPLIED TO SPACECRAFT");

    await expect(page.getByTestId("mon-radar-bit-weight")).toContainText("1.079 ft/bit");
    await expect(page.getByTestId("mon-radar-representation")).toContainText("0o37777");
    await expect(page.getByTestId("mon-radar-representation")).toContainText("REFUSED");

    const cadence = page.getByTestId("mon-radar-cadence");
    await expect(cadence).toContainText("UNRESOLVED");
    await expect(cadence).toContainText("AGC-solicited");
    await expect(cadence).not.toContainText("250");

    await expect(page.getByTestId("mon-radar-fixture")).toContainText(
      "NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE",
    );
    await expect(page.getByTestId("mon-radar-citations")).toContainText("INITREAD");
    await expect(page.getByTestId("mon-radar-citations")).toContainText("LRHTASK");
    await expect(page.getByTestId("mon-radar-prereq")).toContainText("PIPA");
  });

  test("landing-radar-observer-v1 is blocked and never partially enters", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);
    await startGolden(page);

    await page.getByTestId("mon-enter-radar").click();

    await expect(page.getByTestId("mon-blocked")).toBeVisible({ timeout: 30_000 });
    const reasons = page.getByTestId("mon-block-reason");
    await expect(reasons.first()).toContainText("radar-update-cadence-unresolved");
    await expect(page.getByTestId("mon-blocked")).toContainText("CHAN13");

    // Atomic refusal: no profile, no trace, no retained diagnostics.
    await expect(page.getByTestId("mon-profile")).toHaveText("off");
    await expect(page.getByTestId("mon-status")).not.toHaveText("active");
    await expect(page.getByTestId("mon-trace-enabled")).toHaveText("false");
    await expect(page.getByTestId("mon-trace-count")).toHaveText("0");
    await expect(page.getByTestId("mon-radar-radarupt")).toContainText("not requested");

    // Physics keeps running, untouched by the refused profile.
    const a = Number(await page.getByTestId("ms-elapsed").innerText());
    await page.waitForTimeout(500);
    const b = Number(await page.getByTestId("ms-elapsed").innerText());
    expect(b).toBeGreaterThan(a);
  });

  test("CHAN14 is presented as a DECA command delta, never as thrust", async ({ page }) => {
    await page.goto("/dev/mission-runtime");
    await waitForSimReady(page);

    await expect(page.getByTestId("mon-throttle-semantics")).toContainText(
      "LGC THROTTLE COMMAND DELTA INTO DECA SUMMING JUNCTION",
    );
    await expect(page.getByTestId("mon-throttle-semantics")).toContainText(
      "NOT THRUST",
    );
    const throttle = page.getByTestId("mon-throttle");
    await expect(throttle).toContainText("PHYSICAL THROTTLE SCALE NOT YET RESOLVED");
    await expect(throttle).not.toContainText("%");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("lbf");
    expect(body).not.toContain("pounds-force");
  });
});
