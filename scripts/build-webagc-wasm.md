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

## Steps (validated by M3.3A2 Phase 1)

1. Install WASI SDK 15 to `/opt/wasi-sdk-15.0` (or set `WASI_SDK_PATH`). Any
   later WASI SDK also works but produces a different SHA-256. Do NOT use
   WASI SDK 14 or earlier — their `wasm-ld` rejects the linker flag used
   below.
   ```bash
   curl -sSL -o /tmp/wasi-sdk-15.tar.gz \
     https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-15/wasi-sdk-15.0-linux.tar.gz
   tar -C /opt -xzf /tmp/wasi-sdk-15.tar.gz
   export WASI_SDK_PATH=/opt/wasi-sdk-15.0
   export PATH=$WASI_SDK_PATH/bin:$PATH
   ```
2. Fetch the pinned virtualagc source as an immutable tarball (the sandbox
   blocks `git reset --hard`, and the tarball digest is stable):
   ```bash
   curl -sSL -o va.tar.gz \
     https://codeload.github.com/michaelfranzl/virtualagc/tar.gz/ddc65e7bed41f1301921b934fcbaaee93db99dda
   tar xzf va.tar.gz
   cd virtualagc-ddc65e7bed41f1301921b934fcbaaee93db99dda/yaAGC
   ```
3. Substitute the ONE unbuildable linker flag. The pinned Makefile passes
   `--unresolved-symbols=import-functions`, which is not a legal wasm-ld
   value in any released WASI SDK (12 through 20). `--allow-undefined` is
   the documented equivalent (`--import-undefined
   --unresolved-symbols=ignore-all`):
   ```bash
   sed -i 's|--unresolved-symbols=import-functions|--allow-undefined|' Makefile
   ```
4. Build under a nix shell that provides `wasm-opt` (binaryen) and
   `wasm-strip` (wabt):
   ```bash
   nix shell nixpkgs#binaryen nixpkgs#wabt --command \
     make WASI=yes yaAGC.wasm
   sha256sum yaAGC.wasm
   ```
5. Compare against the frozen artifact.
    - Frozen SHA:
      `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14`
      (132 617 bytes).
    - Expected P1 rebuild SHA under WASI SDK 15:
      `7592c740e1009715b602949ed81a27d458700c16f7fed2330b3a8359c3f955d5`
      (131 002 bytes).
    - Any other SHA means one of `WASI_SDK_PATH`, binaryen version, wabt
      version, or `NVER` differs from the P1 baseline. Record the drift in
      `src/third-party/webagc/UPSTREAM.md` under the "Reproduction attempts"
      table and cite it in `docs/M3_3A2_P1.md`. Do NOT replace the committed
      binary — behavioral parity, not byte identity, is the M3.3A2 gate
      (amendment 5).

Never edit the WASM binary. Never invent a build command or timestamp in
`UPSTREAM.md`.

Never edit the WASM binary. Never invent a build command or timestamp in
`UPSTREAM.md`.

## Extended WASM

M3.3A2 will ship a second binary, `yaAGC-ext.wasm`, built from a project-
controlled fork of virtualagc at `ddc65e7b` plus the reviewed patches under
`third-party/virtualagc-fork/PATCHES/lovable-hwio/`. That artifact's build
recipe will be added here as it is developed. Until then, this document
covers only the frozen binary.
