// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Cloudflare made `nodejs_compat` the default on 2026-08-04 and now *errors* if
 * a Worker still declares it ("The compatibility flag nodejs_compat became the
 * default as of 2026-08-04 so does not need to be specified anymore"), which
 * turns every SSR request into a 502. The generated `dist/server/wrangler.json`
 * still emits the flag, so strip it once the compatibility date is on/after the
 * cut-over.
 */
const NODEJS_COMPAT_DEFAULT_DATE = "2026-08-04";

function stripRedundantNodeCompatFlag(): Plugin {
  return {
    name: "tranquility:strip-redundant-nodejs-compat",
    apply: "build",
    enforce: "post",
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
      const file = path.resolve(process.cwd(), "dist/server/wrangler.json");
      if (!fs.existsSync(file)) return;
      try {
        const config = JSON.parse(fs.readFileSync(file, "utf8")) as {
          compatibility_date?: string;
          compatibility_flags?: string[];
        };
        const date = config.compatibility_date ?? "";
        const flags = config.compatibility_flags ?? [];
        if (date < NODEJS_COMPAT_DEFAULT_DATE) return;
        if (!flags.includes("nodejs_compat")) return;
        config.compatibility_flags = flags.filter((f) => f !== "nodejs_compat");
        fs.writeFileSync(file, JSON.stringify(config, null, 2));
        } catch {
          // Never fail the build over a cosmetic wrangler patch.
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [stripRedundantNodeCompatFlag()],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
