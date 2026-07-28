# Reproducible-build instructions for `yaAGC.wasm`

The Worker loads `yaAGC.wasm` from `src/third-party/webagc/yaAGC.wasm` (copied
to `public/agc/yaAGC.wasm` at build time). The committed WASM's SHA-256 is
recorded in `src/third-party/webagc/UPSTREAM.md`. Its provenance is currently
`inherited-from-milestone-0` — the reproducible build below is a follow-up
task; the runtime does not claim provenance it has not verified.

## Pinned upstream

- Repository: https://github.com/michaelfranzl/webAGC
- Commit: `0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
- Package version: 1.1.0

## Toolchain

The upstream project targets Emscripten. Use the version pinned in the
upstream repository's `Makefile` / documentation at the commit above. Do NOT
substitute a different Emscripten version without recording the substitution
in `UPSTREAM.md` — it will change the SHA-256 of the produced WASM.

## Steps

1. Install the pinned Emscripten SDK per its documentation (`emsdk install`
   and `emsdk activate` for the version referenced by upstream).
2. `source ./emsdk_env.sh`.
3. `git clone https://github.com/michaelfranzl/webAGC && cd webAGC && git checkout 0575ea7a1231e3948bae7d2c22a6ac146da0c38d`.
4. Follow the upstream build target that produces `yaAGC.wasm` (typically
   `make yaAGC.wasm` — verify against the upstream README at this commit).
5. Compute `sha256sum` of the produced `yaAGC.wasm`. If it matches the value
   recorded in `UPSTREAM.md`, replace `src/third-party/webagc/yaAGC.wasm`
   with the freshly built copy and update `UPSTREAM.md`'s `origin` field from
   `inherited-from-milestone-0` to `reproduced-locally`.

Never edit the WASM binary. Never invent a build command or timestamp in
`UPSTREAM.md`.
