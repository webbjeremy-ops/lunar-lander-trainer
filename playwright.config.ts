// SPDX-License-Identifier: GPL-3.0-or-later
// Playwright configuration for the Wrangler-served /learn acceptance suite.
// Serves the real production Cloudflare Workers bundle from dist/, exactly as
// deployed. Serial execution; a single browser context per test.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PW_PORT ?? 4173);

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
    launchOptions: {
      executablePath:
        process.env.PW_CHROMIUM ?? "/chromium-1194/chrome-linux/chrome",
    },
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
