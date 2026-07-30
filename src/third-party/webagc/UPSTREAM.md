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
| `yaAGC.wasm` | 132617 | `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14` | verified-byte-identical-to-webAGC@0575ea7 (frozen; comparison-only) |
| `yaAGC-ext.wasm` | 275205 | `12ac2797971ea56e5d7583d659ddbaae809f721d7549441229e580e110a65bc3` | M3.3B2 extended build (HW-I/O v3 — adds the allow-listed RADARUPT latch `agc_request_hardware_interrupt`, the atomic serial landing-radar transaction `agc_landing_radar_update_apply`, and read-only interrupt observation exports; RNRAD (0o46) capability widened to SHINC/SHANC. v2 exports and semantics unchanged; trace still defaults disabled). Canonical production runtime — see `src/agc/AgcRuntimeManifest.ts` and `third-party/virtualagc-fork/PATCHES/lovable-hwio/README.md`. Superseded SHAs: v3-unstamped (empty `version()`, provenance defect — never frozen) `8cac2dc90d4896caa5f80888d4334616e5357b58f45233f6b27599e68a4b85cf`, v2 `aec84b4736b2a8f80709d6a8c8ccceec51f1f3955144a9fad771118c9a21262e`, v1 `4a03b921f831e59c4b32b47762f2bd81a91d3b726420a940a98a04e7a19828aa`. |

**`origin: verified-byte-identical-to-webAGC@0575ea7`** was established during
M3.3A2 Phase 0 by cloning `michaelfranzl/webAGC @ 0575ea7a1231e3948bae7d2c22a6ac146da0c38d`
and computing `sha256sum src/yaAGC.wasm` on the shipped file. It matches this
repository's copy exactly. `webAGC@0575ea7/README.md` further attests that its
`yaAGC.wasm` was built from `michaelfranzl/virtualagc @ ddc65e7bed41f1301921b934fcbaaee93db99dda`,
and the running WASM's `version()` export returns that exact commit ID. Source
ancestry is therefore established even without a byte-identical local rebuild.

A local WASI SDK rebuild was performed in M3.3A2 Phase 1. The pinned upstream
source at `virtualagc @ ddc65e7b` builds cleanly under WASI SDK 15 (and, for
comparison, WASI SDK 12) but does **not** reproduce byte-identity with the
frozen artifact. All nine exported symbols and the memory-import shape match;
`version()` returns `"2020-12-24 ddc65e7be"` on the frozen artifact,
confirming the ancestry. See `docs/M3_3A2_P1.md` for the full P1 report,
reproduction attempts, drift analysis, and P2 preconditions.

Reproduction recipe: `scripts/build-webagc-wasm.md`. Phase 0 toolchain
investigation: `docs/M3_3A2_PHASE0.md`.

## Reproduction attempts

| Attempt | Toolchain | Bytes | SHA-256 | Byte-identical? |
| --- | --- | --- | --- | --- |
| Frozen (webAGC upstream) | unknown WASI SDK, 2021-05 vintage | 132617 | `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14` | reference |
| P1 rebuild #1 | WASI SDK 15.0 (LLVM 14) + binaryen 124 + wabt 1.0.37, `NVER=""` | 131002 | `7592c740e1009715b602949ed81a27d458700c16f7fed2330b3a8359c3f955d5` | no — see `docs/M3_3A2_P1.md` §3 |
| P1 rebuild #2 | WASI SDK 12.0 (LLVM 11) + binaryen 124 + wabt 1.0.37, `NVER=""` | 130051 | `92bd540a26afc932f57908c145056cea3e02423a39d41aa73350d493a1266f91` | no — see `docs/M3_3A2_P1.md` §3 |
| M3.3B2 v3 build #1 (rejected) | WASI SDK 15.0 + binaryen 124 + wabt 1.0.37, **`NVER` unset** | 275189 | `8cac2dc90d4896caa5f80888d4334616e5357b58f45233f6b27599e68a4b85cf` | n/a — provenance defect: `version()` returned `""` |
| M3.3B2 v3 build #2 (**canonical**) | WASI SDK 15.0 (LLVM 14) + binaryen 124 + wabt 1.0.37, `NVER="2020-12-24 ddc65e7be"` | 275205 | `12ac2797971ea56e5d7583d659ddbaae809f721d7549441229e580e110a65bc3` | n/a — extended artifact; `version()` = `"2020-12-24 ddc65e7be"`, `agc_ext_version()` = `"ddc65e7be+apollo-browser-hwio-v3"`, `agc_hwio_version()` = 3 |

### `NVER` provenance stamp (M3.3B2)

The legacy `version()` export returns the compile-time `-DNVER=...` macro
(`yaAGC/version.c:6`, applied by `yaAGC/Makefile:246` in the WASI `%.o` rule).
Upstream derives `NVER` from `git describe`-style metadata in the *parent*
Makefile; building from the immutable source **tarball** leaves it empty,
which is exactly how the rejected build #1 lost its ancestry string. It MUST
be passed explicitly and reproducibly on the `make` command line:

```bash
make WASI=yes NVER="2020-12-24 ddc65e7be" yaAGC-ext.wasm
```

The stamp is never synthesised in runtime JavaScript; `AgcRuntimeManifest.ts`
only *asserts* the value the artifact itself reports.

Both P1 rebuilds required substituting the pinned Makefile's
`--unresolved-symbols=import-functions` linker flag with `--allow-undefined`;
the pinned value is not accepted by any released WASI SDK's `wasm-ld` from
version 12 through 20. The substitution is behaviourally equivalent per
wasm-ld's own documentation.

## License notices

Any upstream `LICENSE` or `NOTICE` file from webAGC that must be preserved
alongside redistributed source lives in this directory. Do not delete or
modify those files without also updating `THIRD_PARTY_NOTICES.md`.
