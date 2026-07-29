# Reproducible-build instructions for `yaAGC.wasm`

The Worker loads `yaAGC.wasm` from `src/third-party/webagc/yaAGC.wasm` (copied
to `public/agc/yaAGC.wasm` at build time). The committed WASM's SHA-256 is
recorded in `src/third-party/webagc/UPSTREAM.md`. As of M3.3A2 Phase 0, the
file has been verified byte-identical to the WASM shipped by webAGC at the
pinned upstream commit — provenance is `verified-byte-identical-to-webAGC@0575ea7`.
A local rebuild has not been performed; the instructions below describe how.

## Pinned upstream

- webAGC repository: https://github.com/michaelfranzl/webAGC
- webAGC commit: `0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
- webAGC package version: 1.1.0
- **Actual C source for the WASM** — `webAGC@0575ea7` only ships the compiled
  binary and JS glue. Its README states the binary was built from:
  - virtualagc repository: https://github.com/michaelfranzl/virtualagc
  - virtualagc commit: `ddc65e7bed41f1301921b934fcbaaee93db99dda`

## Toolchain

**The build uses the WASI SDK, not Emscripten.** See
`virtualagc/yaAGC/Makefile` lines 137–164 at the pinned commit for the
authoritative flags. Relevant excerpts:

- `--target=wasm32-wasi`
- `--sysroot ${WASI_SDK_PATH}/share/wasi-sysroot`
- `-O3 -flto -fwhole-program-vtables -fvirtual-function-elimination -matomics -mbulk-memory`
- Linker (`wasm-ld`) flags include `--no-entry --export-dynamic --import-undefined --import-memory --lto-O3 --shared-memory --no-check-features --initial-memory=196608 --max-memory=262144`.

The specific WASI SDK version used by webAGC upstream is not recorded in the
`ddc65e7b` Makefile. Reproduction should try the WASI SDK version current at
the pinned commit's date (2021-05); if a different version produces byte-
identical output, record it here. Do NOT substitute a different WASI SDK
version without recording the substitution in `UPSTREAM.md` — it will change
the SHA-256 of the produced WASM.

**Emscripten is not a substitute.** `emcc` will produce a functionally similar
binary but will not reproduce the recorded SHA and would defeat the M3.3A2
Phase 3 parity gate.

## Steps

1. Install WASI SDK to `/opt/wasi-sdk` (or set `WASI_SDK_PATH`). In this
   sandbox, `nix shell nixpkgs#wasi-sdk` provides one.
2. Clone virtualagc and reset to the pinned commit:
   ```bash
   git clone https://github.com/michaelfranzl/virtualagc
   cd virtualagc
   git reset --hard ddc65e7bed41f1301921b934fcbaaee93db99dda
   ```
3. Build the WASM target:
   ```bash
   cd yaAGC
   make WASI=yes yaAGC.wasm
   ```
4. Compute `sha256sum yaAGC/yaAGC.wasm`.
   - If it matches `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14`,
     update `UPSTREAM.md` origin field to `reproduced-locally`.
   - If it does not match, record the exact WASI SDK version, host OS, and
     resulting SHA in `UPSTREAM.md` under a `reproduction-attempts:` block.
     Do NOT replace the committed binary — behavioral parity, not byte
     identity, is the M3.3A2 gate (amendment 5).

Never edit the WASM binary. Never invent a build command or timestamp in
`UPSTREAM.md`.

## Extended WASM

M3.3A2 will ship a second binary, `yaAGC-ext.wasm`, built from a project-
controlled fork of virtualagc at `ddc65e7b` plus the reviewed patches under
`third-party/virtualagc-fork/PATCHES/lovable-hwio/`. That artifact's build
recipe will be added here as it is developed. Until then, this document
covers only the frozen binary.
