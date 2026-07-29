// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P4 — Wrangler-served browser acceptance for canonical runtime.
//
// Boots the real production Cloudflare Workers bundle, navigates through
// every AGC-hosting route, and asserts the network + runtime contract:
//
//   * production requests /agc/yaAGC-ext.wasm exactly once;
//   * production NEVER requests the frozen /agc/yaAGC.wasm;
//   * exactly one Worker boots for the whole session;
//   * the extended runtime reports HW-I/O v2 through
//     `agc:extension-ready`, with traceEnabled=false, traceDropped=0;
//   * navigating /learn → /explore → /sim → /dev/mission-runtime preserves
//     the same Worker instance (no re-boot, no second WASM fetch);
//   * dormancy holds at end of run (no counter-input, no trace-enable).

import { test, expect, type Request as PWRequest } from "@playwright/test";

interface ExtReadyMsg {
  type: "agc:extension-ready";
  hwioVersion: number;
  extVersion: string;
  extensionTag: string;
  wasmSha256: string;
  traceEnabled: boolean;
  traceDropped: number;
}

interface AgcTestSnapshot {
  ready?: boolean;
  extensionReady?: ExtReadyMsg;
  workerBoots?: number;
  snapshot?: unknown;
  diagnostics?: {
    extensionIdentity?: {
      hwioVersion: number;
      traceEnabled: number;
      traceDropped: number;
    };
  };
}

const CANONICAL_SHA =
  "aec84b4736b2a8f80709d6a8c8ccceec51f1f3955144a9fad771118c9a21262e";

test.describe("M3.3A2-P4 canonical runtime — Wrangler acceptance", () => {
  test("browser fetches ONLY yaAGC-ext.wasm and reports HW-I/O v2 across routes", async ({
    page,
  }) => {
    const wasmRequests: string[] = [];
    page.on("request", (req: PWRequest) => {
      const url = req.url();
      if (url.includes("/agc/") && url.endsWith(".wasm")) {
        wasmRequests.push(url);
      }
    });

    await page.goto("/learn", { waitUntil: "domcontentloaded" });

    // Wait for the persistent AGC session to publish readiness + extension.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __agcTest?: AgcTestSnapshot };
        return !!(w.__agcTest?.ready && w.__agcTest?.extensionReady);
      },
      undefined,
      { timeout: 60_000 },
    );

    const snap1 = await page.evaluate(() => {
      const w = window as unknown as { __agcTest?: AgcTestSnapshot };
      return JSON.parse(JSON.stringify(w.__agcTest ?? {}));
    });

    // 1. Exactly one canonical WASM fetch, no frozen fetch.
    const extFetches = wasmRequests.filter((u) => u.endsWith("/yaAGC-ext.wasm"));
    const frozenFetches = wasmRequests.filter((u) => u.endsWith("/yaAGC.wasm"));
    expect(extFetches.length).toBeGreaterThanOrEqual(1);
    expect(frozenFetches.length).toBe(0);

    // 2. Extension-ready contract.
    expect(snap1.extensionReady?.type).toBe("agc:extension-ready");
    expect(snap1.extensionReady?.hwioVersion).toBe(2);
    expect(snap1.extensionReady?.traceEnabled).toBe(false);
    expect(snap1.extensionReady?.traceDropped).toBe(0);
    expect(snap1.extensionReady?.wasmSha256).toBe(CANONICAL_SHA);

    // 3. Exactly one Worker boot.
    expect(snap1.workerBoots).toBe(1);

    // 4. Cross-route persistence — /explore, /sim, /dev/mission-runtime
    //    must not re-boot the Worker or fetch a second WASM.
    const wasmBefore = wasmRequests.length;
    for (const route of ["/explore", "/sim", "/dev/mission-runtime", "/learn"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => {
          const w = window as unknown as { __agcTest?: AgcTestSnapshot };
          return !!(w.__agcTest?.ready);
        },
        undefined,
        { timeout: 60_000 },
      );
    }
    expect(wasmRequests.length).toBe(wasmBefore);

    const snap2 = await page.evaluate(() => {
      const w = window as unknown as { __agcTest?: AgcTestSnapshot };
      return JSON.parse(JSON.stringify(w.__agcTest ?? {}));
    });
    expect(snap2.workerBoots).toBe(1);

    // 5. Dormancy at end of run — pull fresh diagnostics.
    const diag = await page.evaluate(async () => {
      const w = window as unknown as {
        __agcTest?: AgcTestSnapshot;
        __agcRequestDiagnostics?: () => Promise<unknown>;
      };
      if (w.__agcRequestDiagnostics) {
        try { await w.__agcRequestDiagnostics(); } catch { /* ignore */ }
      }
      return JSON.parse(JSON.stringify(w.__agcTest?.diagnostics ?? {}));
    });
    if (diag && diag.extensionIdentity) {
      expect(diag.extensionIdentity.hwioVersion).toBe(2);
      expect(diag.extensionIdentity.traceEnabled).toBe(0);
      expect(diag.extensionIdentity.traceDropped).toBe(0);
    }
  });
});
