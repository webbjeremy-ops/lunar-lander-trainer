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
| `yaAGC.wasm` | 132617 | `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14` | verified-byte-identical-to-webAGC@0575ea7 |

**`origin: verified-byte-identical-to-webAGC@0575ea7`** was established during
M3.3A2 Phase 0 by cloning `michaelfranzl/webAGC @ 0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
and computing `sha256sum src/yaAGC.wasm` on the shipped file. It matches this
repository's copy exactly. `webAGC@0575ea7/README.md` further attests that its
`yaAGC.wasm` was built from `michaelfranzl/virtualagc @ ddc65e7bed41f1301921b934fcbaaee93db99dda`,
and the running WASM's `version()` export returns that exact commit ID. Source
ancestry is therefore established even without a byte-identical local rebuild.

A local rebuild has NOT yet been attempted. `virtualagc @ ddc65e7b/yaAGC/Makefile`
targets the WASI SDK (not Emscripten); the reproduction recipe is documented in
`scripts/build-webagc-wasm.md`. See `docs/M3_3A2_PHASE0.md` for the full Phase 0
findings and toolchain investigation.

## License notices

Any upstream `LICENSE` or `NOTICE` file from webAGC that must be preserved
alongside redistributed source lives in this directory. Do not delete or
modify those files without also updating `THIRD_PARTY_NOTICES.md`.
