# AGC assets — provenance and update procedure

Every file under `public/agc/` is served **same-origin** by Vite/Nitro at the
URL that mirrors its path. Do not move them without updating
`src/sim/agc/roms.ts`.

## `yaAGC.wasm`

- Origin: [michaelfranzl/webAGC](https://github.com/michaelfranzl/webAGC), a
  WebAssembly build of Ron Burkey's yaAGC (Virtual AGC).
- License: **GPL-2.0-or-later** (inherited from yaAGC). Attribution and
  source availability are handled on the in-app `/sources` page.
- How it was obtained: downloaded the prebuilt `yaAGC.wasm` from the
  webAGC release used at project bootstrap and committed here verbatim.
  We do NOT modify the binary — modifying it would invalidate the point of
  running the real emulator.

To update:
1. Pull the desired webAGC commit and copy `yaAGC.wasm` here.
2. Note the upstream commit hash in `src/sim/agc/roms.ts` (add a
   `commit` field if you introduce version pinning).
3. Verify the app still boots and V35E still passes.

## `rope/Luminary099.bin`, `rope/Comanche055.bin`

- Origin: assembled from [chrislgarry/Apollo-11](https://github.com/chrislgarry/Apollo-11)
  (NASA-authored source, public domain) using the Virtual AGC assembler
  (`yaYUL`), then packed to the binary rope-image format yaAGC's
  `set_fixed` expects.
- License: NASA public domain (no license issue); attribution only.
- SHA-256 hashes are pinned in `src/sim/agc/roms.ts` and verified at
  runtime. A mismatch is surfaced in the DSKY status readout as MISMATCH
  and should be treated as a data-integrity failure — regenerate the rope
  and update the hash rather than silencing the check.

To regenerate a rope from source:

```sh
# Requires the Virtual AGC toolchain (yaYUL).
git clone https://github.com/chrislgarry/Apollo-11
cd Apollo-11/Luminary099
yaYUL --html MAIN.agc > MAIN.lst   # emits Luminary099.bin next to MAIN.agc
```

Copy the resulting `Luminary099.bin` into `public/agc/rope/`, then update the
`sha256` field in `src/sim/agc/roms.ts` with the new digest.

## Why the assets live here (not in src/)

Vite treats `public/` as verbatim static assets — no bundling, no hashing,
correct `application/wasm` MIME. The AGC adapter uses
`WebAssembly.compileStreaming(fetch("/agc/yaAGC.wasm"))`, which requires the
`application/wasm` content type.
