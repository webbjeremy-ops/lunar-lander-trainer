// SPDX-License-Identifier: GPL-3.0-or-later
// Playwright configuration for the Wrangler-served /learn acceptance suite.
// Serves the real production Cloudflare Workers bundle from dist/, exactly as
// deployed. Serial execution; a single browser context per test.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * Resolve a Chromium binary that actually exists on this machine.
 *
 * Playwright pins a browser build number per release; sandboxes and CI images
 * frequently ship a different build under PLAYWRIGHT_BROWSERS_PATH. Rather than
 * hard-coding a build that goes stale, discover the installed chromium-* folder
 * and fall back to Playwright's own resolution when nothing is found.
 */
function resolveChromium(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const bin = join(root, dir, "chrome-linux", "chrome");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const chromiumPath = resolveChromium();

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 1800 },
    trace: "retain-on-failure",
    // Resolve Chromium from PLAYWRIGHT_BROWSERS_PATH by default; only override
    // when PW_CHROMIUM explicitly points at a binary.
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },

  webServer: {
    // Requires a prior `bun run build`. We do NOT rebuild here; CI/dev flows
    // must call build before playwright.
    // The generated wrangler.json pins today's compatibility date, which can be
    // newer than the installed workerd binary supports; clamp it before serving.
    command: `node -e "const f='dist/server/wrangler.json',fs=require('fs'),c=JSON.parse(fs.readFileSync(f,'utf8'));const max=process.env.PW_COMPAT_DATE||'2026-07-29';if(c.compatibility_date>max){c.compatibility_date=max;fs.writeFileSync(f,JSON.stringify(c,null,2));}" && bunx wrangler dev -c dist/server/wrangler.json --port ${PORT} --ip 127.0.0.1`,

    url: `http://127.0.0.1:${PORT}/learn`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
