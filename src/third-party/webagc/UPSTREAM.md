# Upstream: webAGC / yaAGC

This directory vendors the exact upstream source and WebAssembly artifact used
by the AGC — Tranquility runtime. The files here — not any live GitHub URL —
are what ship in the build. `vite.config.ts` copies `yaAGC.wasm` into
`public/agc/` at build time so the Worker can fetch it same-origin at a stable
URL, and the two copies are guaranteed byte-identical by construction (they
are the same file on disk with a single filesystem copy).

## Upstream reference

- Repository: https://github.com/michaelfranzl/webAGC
- Pinned commit: `0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
- Package version (upstream): 1.1.0
- Upstream license: GPL-2.0-or-later (with the linking exception recorded in
  the yaAGC source tree; see `LICENSES/GPL-2.0-or-later.txt` for the license
  text). yaAGC upstream: https://github.com/virtualagc/virtualagc

## Vendored artifacts and measured SHA-256

The following digests were measured against the files actually committed to
this directory at the time of vendoring:

| File | Bytes | SHA-256 | Origin |
| --- | --- | --- | --- |
| `yaAGC.wasm` | 132617 | `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14` | inherited-from-milestone-0 |

**`origin: inherited-from-milestone-0`** means the byte-identical WASM was
carried forward from Milestone 0 rather than rebuilt from the pinned upstream
commit in this repository. Rebuilding it requires the Emscripten toolchain the
upstream project uses; see `scripts/build-webagc-wasm.md` for exact
instructions. Until a reproducible build is confirmed the runtime does NOT
claim provenance beyond "vendored copy, matches this SHA-256".

## License notices

Any upstream `LICENSE` or `NOTICE` file from webAGC that must be preserved
alongside redistributed source lives in this directory. Do not delete or
modify those files without also updating `THIRD_PARTY_NOTICES.md`.
