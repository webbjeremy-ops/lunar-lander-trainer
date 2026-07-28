# Third-party notices

AGC — Tranquility is an independent educational project. It is not sponsored,
approved, or endorsed by NASA, MIT, the Virtual AGC project, or any original
Apollo contributor.

The distributed combined application is licensed under GPL-3.0-or-later (see
`LICENSE`). Individual third-party components retain their own upstream
licenses, listed below.

## Apollo Guidance Computer emulator

- Project: **webAGC** — https://github.com/michaelfranzl/webAGC
- Copyright: © Michael Karl Franzl
- License: **GPL-2.0-or-later** (see `LICENSES/GPL-2.0-or-later.txt`)
- Vendored at commit: `0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
- Vendored under: `src/third-party/webagc/`
- Runtime artifact: `src/third-party/webagc/yaAGC.wasm`, copied to
  `public/agc/yaAGC.wasm` at build time (byte-identical).

`webAGC` in turn is a WebAssembly port of:

- Project: **Virtual AGC / yaAGC** — https://github.com/virtualagc/virtualagc
- Copyright: © Ron Burkey and contributors
- License: **GPL-2.0-or-later**, with linking exceptions preserved in the
  vendored source files where applicable.

## Rope memory images

- Source: **chrislgarry/Apollo-11** — https://github.com/chrislgarry/Apollo-11
- Original author: NASA (public domain)
- Pinned commit: `911e5c0283c629c50cb97666f34065e8c07d71a5`
- Build toolchain: **yaYUL** from
  https://github.com/virtualagc/virtualagc at commit
  `b6d27dc645fdc1ac75a3f825fea1d81e06729cc3`
  (GPL-2.0-or-later; used at build time only)
- Runtime rope: `public/ropes/Luminary099.bin` with manifest
  `public/ropes/Luminary099.manifest.json` (both same-origin at runtime).
- Reproducible build: `scripts/build-luminary099.sh` + CI workflow
  `.github/workflows/reproduce-rope.yml`.

## npm dependencies

Only npm packages that ship into the browser build are listed here. Dev-only
tools (Vite, Vitest, ESLint, TypeScript, Playwright) retain their upstream
licenses as declared in `node_modules/*/package.json`.

- React, ReactDOM — MIT
- TanStack Router / React Query / React Start — MIT
- Radix UI primitives — MIT
- lucide-react — ISC
- tailwindcss (v4) — MIT
- @wasmer/wasi, @wasmer/wasmfs — MIT
- Zod, sonner, cmdk, embla-carousel-react, etc. — MIT

See each package's `LICENSE` file in `node_modules/` for the full text.

## Attribution note

Newly-written project files (worker, worker client, mission clock, snapshot
coalescer, event log, checksum, UI components, routes) carry only the
GPL-3.0-or-later SPDX identifier. They do NOT carry webAGC / yaAGC copyright
attribution, because they contain no code derived from those upstreams. The
adapter shim `src/sim/agc/AgcCoreAdapter.ts` IS derived from webAGC and
therefore retains the GPL-2.0-or-later notice and the upstream copyright line.
