# M3.3A2 — Phase 0 findings report (stop-and-report before Phase 1)

Written per the M3.3A2 plan's report-back requirement ("stop and report any
unresolved prerequisite before proceeding"). No production code was changed
in this phase. The purpose of this report is to give the user the concrete
information they need before we commit to the multi-turn Phases 1–6 build.

## 1. Frozen WASM provenance — upgraded

- Repo file: `src/third-party/webagc/yaAGC.wasm`
- SHA-256: `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14`
- Bytes: 132 617

Compared byte-for-byte to `src/yaAGC.wasm` at the pinned upstream
`michaelfranzl/webAGC @ 0575ea7a1231e3948bae7d2c22a6ac146da0c38d`.
The two files are **identical**. Provenance is upgraded from
`inherited-from-milestone-0` to **`verified-byte-identical-to-webAGC@0575ea7`**
in `src/third-party/webagc/UPSTREAM.md`.

## 2. Source ancestry to `ddc65e7b` confirmed

`webAGC@0575ea7/README.md` states verbatim that its shipped `yaAGC.wasm`
was built from `michaelfranzl/virtualagc @ ddc65e7bed41f1301921b934fcbaaee93db99dda`
and that the WASM `version()` export returns that exact commit ID at runtime.
Our runtime confirms `version()` = `ddc65e7be…`. Ancestry gate satisfied
per amendment 5.

## 3. Toolchain reality — WASI SDK, not Emscripten

`virtualagc @ ddc65e7b` builds `yaAGC.wasm` with the **WASI SDK**, not
Emscripten (see `yaAGC/Makefile` lines 137–164):

```
--target=wasm32-wasi
--sysroot ${WASI_SDK_PATH}/share/wasi-sysroot
-O3 -flto -fwhole-program-vtables -fvirtual-function-elimination
-matomics -mbulk-memory
```

Linker is `wasm-ld`, not `emcc`. Flags include `--shared-memory`,
`--initial-memory=196608`, `--max-memory=262144`, and
`--import-memory --import-undefined`.

The Phase-2 build recipe in the plan is therefore updated: we need
`nixpkgs#wasi-sdk` (or equivalent). Emscripten is not sufficient. The nix
package `nixpkgs#emscripten` is available in this sandbox and `emcc`
executes, but it is not the correct toolchain for this artifact and using
it would defeat the parity gate.

## 4. Scope reduction — RADARUPT is auto-generated inside yaAGC

Confirmed in `agc_engine.c`:

- Line 389 comment: *"Added simulation of RADARUPT. Unlike other interrupts,
  RADARUPT is automatically generated"*.
- Lines 2223–2234: when `RadarGateCounter == 9` and the SCALER1 phase
  matches, the emulator itself sets `State->InterruptRequests[9] = 1`
  and calls `RequestRadarData(State)`.

Implication: **the planned `agc_request_interrupt` export is not required
for `descent-monitor-v1`.** Luminary will see RADARUPT the moment we drive
the LR range/velocity counters through the native `UnprogrammedIncrement`
path with the correct cadence and the RADAREN / radar-enable discretes are
asserted through the existing `packet_write` path. The export can be
deferred (or dropped) until a signal that is NOT auto-fired needs it.

This trims Phase 1d entirely for the initial build and removes an entire
class of interrupt-priority questions from the gate. Amendment 8's
`accepted | already-pending | invalid-vector` return contract still applies
if we later add it for a different vector.

## 5. Native counter API is exactly what the batch export needs

`UnprogrammedIncrement(agc_t *State, int Counter, int IncType)` at
`agc_engine.c:1570` is the single authoritative entrypoint. Its `IncType`
values are the yaAGC unprogrammed-sequence identifiers:

| IncType | Meaning        |
|--------:|:---------------|
| 0       | PINC           |
| 1 / 021 | PCDU           |
| 2       | MINC           |
| 3 / 023 | MCDU           |
| 4       | DINC           |
| 5       | SHINC          |
| 6       | SHANC          |

We must preserve these values verbatim in the `HwInputRecord.sequenceType`
field and in the output trace's `operation` field (amendment 7), not
collapse to a synthetic WRITE/PINC/MINC trio. CDU counters have a FIFO
(`PushCduFifo`) — the batch API must apply CDU pulses one-at-a-time so the
FIFO ordering is faithful.

## 6. `wasm.c` extension surface is small

Current `virtualagc/yaAGC/wasm.c` = 187 lines; extends cleanly. The Phase-1
additions total roughly:

- Counter capability tables: ~80 lines (paralleled in TS).
- `agc_counter_increment(address, sequenceType)`: ~15 lines around
  `UnprogrammedIncrement`.
- `agc_hw_input_apply(records_ptr, record_count)`: ~40 lines including
  pre-validation and ordered dispatch.
- Output-counter trace ring (observable outputs: initially THRUST 055):
  ~100 lines. Ring lives in linear memory; drained by adapter.
- `agc_ext_version()`: ~5 lines.

RADARUPT export deferred per section 4.

## 7. Environment blocker for a full one-turn Phase 1–6 build

The sandbox constraints and remaining scope make a single-turn completion
of Phases 1–6 unwise:

- `git checkout` is blocked at the harness level, so pinning a local
  `virtualagc` tree to `ddc65e7b` requires either a tarball download from
  GitHub archives or per-commit fetch-and-reset. Tractable, but adds
  ceremony.
- WASI SDK must be resolved through `nix shell nixpkgs#wasi-sdk` and
  verified end-to-end against the frozen artifact before we can claim any
  parity result.
- The full parity harness (amendment 6: every ordered channel packet,
  DSKY transitions, mission-time progression, V35 peak checksum, V16 N65
  checkpoints, pause/step schedules, ready diagnostics) is a substantial
  Vitest suite in its own right, and it must be *green* against the
  extended artifact before we promote it to canonical.
- All frozen Vitest (199+) and Wrangler-served Playwright (7) suites must
  then run against the extended runtime, unchanged.

Estimated realistic sub-milestone split:

1. **A2-P1**: WASI SDK build recipe + reproduce `yaAGC.wasm` (or record the
   documented non-reproduction) → 1 turn.
2. **A2-P2**: `virtualagc-fork/` patch tree, counter capability tables,
   `agc_counter_increment`, `agc_hw_input_apply`, output-trace ring,
   `agc_ext_version` → 1 turn.
3. **A2-P3**: Adapter APIs + hwio.test.ts + parity harness (extended vs
   frozen) → 1 turn. **Gate.**
4. **A2-P4**: Frozen suite run against extended runtime; promote to
   canonical → 1 turn. **Gate.**
5. **A2-P5**: Monitor mode sensors + actuators + `descent-monitor-v1` +
   `/dev/mission-runtime` wiring + snapshot `agcMonitor` + protocol v2
   monitor commands → 1–2 turns.

Closed-loop remains prohibited across all sub-milestones.

## 8. Explicitly unchanged in Phase 0

No files under `src/`, `tests/`, `public/`, or `docs/M2_*`, `docs/M3_1_*`,
`docs/M3_2_*` were touched. The frozen runtime, all M2 behavior, and all
M3.1 / M3.2 acceptance remain byte-identical to the state at start of
turn. Only `src/third-party/webagc/UPSTREAM.md`,
`scripts/build-webagc-wasm.md`, and this new `docs/M3_3A2_PHASE0.md` are
being written.

## 9. Recommendation

Approve the A2-P1..P5 sub-milestone split. Start A2-P1 with the WASI SDK
recipe and reproducibility attempt. Do not attempt to compress the full
build + parity + monitor pipeline into a single agent turn — the amendments
demand behavioral parity across the full public surface, and that gate has
to be earned, not asserted.
