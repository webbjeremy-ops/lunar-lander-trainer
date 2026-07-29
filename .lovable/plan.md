# M3.3A2 — Minimal yaAGC WASM hardware-interface extension (revised)

Freeze respected: M2, M3.1 kernel, M3.2 MissionRuntime untouched. Closed-loop AGC control remains prohibited. `discrete-observer-v0` is optional diagnostic only.

## Scope in one line
Extend the currently vendored Virtual AGC (base `ddc65e7bed41f1301921b934fcbaaee93db99dda`) with the smallest hardware-faithful exports required by `docs/M3_3_IO_MAP.md`, prove behavioral parity against the frozen binary, then make the extended binary the single canonical runtime artifact and wire descent monitor mode.

## Single-artifact rule (amendment 1)
No mid-session WASM swaps. AGC erasable, registers, interrupt latches, timers, and packet queues live inside the WASM instance; swapping would require a reboot or unsafe state transfer.

- Phase order: build extended → prove legacy parity → make `yaAGC-ext.wasm` the canonical runtime for `/learn`, `/explore`, `/sim`, `/dev/*`, all M2 tests, and monitor mode.
- The frozen `yaAGC.wasm` is retained only for parity comparison and historical provenance; it is not shipped as an active runtime after the gate.
- New exports do nothing unless explicitly invoked. With monitor mode off, observable behavior must be identical to the frozen binary.

## Phase 0 — Provenance baseline
- Record current WASM SHA-256, byte size, `version()` string; capture the vendored `virtualagc` commit metadata that the frozen artifact claims (`ddc65e7b`).
- Create `third-party/virtualagc-fork/` pinned to `ddc65e7b` with a `PATCHES/lovable-hwio/` directory: one patch per change, each header citing upstream files/lines. Any narrow backport from `b6d27dc` is one reviewable patch.

## Phase 1 — Minimal exports (additive C shims into existing yaAGC internals)

### 1a. Counter capability tables (amendment 2)
Define four tables in `third-party/virtualagc-fork/PATCHES/lovable-hwio/counter_caps.c`, mirrored in TS as `src/sim/agc/counterCapabilities.ts`. Every entry:

```c
{ address, permittedSequences[], direction, sourceMappingId }
```

- `hostInputCounters` — the only counters host code may increment in production. Initially PIPAX/Y/Z (PINC/MINC), CDUX/Y/Z (PCDU/MCDU if the mapping proves it), plus the exact LR altitude / altitude-rate counters named in `docs/M3_3_IO_MAP.md` with their exact permitted sequence type.
- `observableOutputCounters` — read-only, appear in the output trace only. THRUST (055) lives here; **never host-incrementable**.
- `internallyTimedCounters` — TIME1..TIME6. Not exposed to production host injection at all; verified in Phase 4 that emulator timing already drives them.
- `testOnlyCounters` — anything a low-level test may poke via a separately gated API; never callable from adapter production paths.

Any `(address, sequence)` combination outside its explicit table is rejected with `invalid-address` and AGC state is unchanged. THRUST + PINC returns `invalid-address`, not silently succeeding.

### 1b. `agc_counter_increment(address, sequenceType)`
- `sequenceType` is the exact yaAGC unprogrammed-sequence identifier (`PINC | MINC | PCDU | MCDU | DINC | …`) — not a synthetic `direction` enum. Routes through the native `UnprogrammedIncrement` / `ServiceCounters` path.
- Test-only single-shot API. Production code uses 1c.

### 1c. `agc_hw_input_apply(records_ptr, record_count)` (amendment 3)
Ordered batch. Each record:
```c
struct HwInputRecord {
  uint16_t counterAddress;
  uint16_t sequenceType;     // yaAGC UP-sequence id
  uint16_t count;            // number of pulses
  uint16_t suborder;         // stable tiebreaker within one call
};
```
- WASM applies records deterministically through the native counter mechanism, preserving order by `(suborder, arrival)`.
- Opposing pulses are NOT algebraically collapsed. +5 then -5 executes as ten unprogrammed sequences because overflow / interrupt scheduling between them may differ from a no-op.
- Every address/sequence pair is checked against `hostInputCounters`; any violation aborts the batch before any record is applied and returns `invalid-address` with the offending index.
- Adapter provides a typed-array view over a preallocated linear-memory scratch region so the Worker never allocates per pulse.

### 1d. `agc_request_interrupt(vector)` (amendment 8)
- Sets pending-interrupt bit through yaAGC's native request path so priority/inhibit rules apply.
- Allow-list initially: RADARUPT only. T3RUPT/T4RUPT explicitly NOT exposed — Phase 4 verifies they fire from internal timing.
- Return code enum: `accepted | already-pending | invalid-vector`. `already-pending` is idempotent hardware-latch behavior, not data loss.

### 1e. Lossless output-counter trace (amendment on entry format)
- Bounded ring in WASM linear memory (default 4096 entries) capturing every mutation of whitelisted `observableOutputCounters`.
- Entry:
```ts
interface OutputTraceEntry {
  sequence: string;    // decimal string, 64-bit-safe across JS boundary
  agcCycle: string;    // decimal string, 64-bit-safe
  address: number;
  operation: number;   // native yaAGC op / UP-sequence id, NOT collapsed to WRITE/PINC/MINC
  delta: number;       // signed; 0 if operation has no meaningful delta
  valueBefore: number;
  valueAfter: number;
}
```
- Adapter converts the two 64-bit fields either as `bigint` or as `{hi,lo}` before crossing to JS; never truncated to `number` silently.
- Exports: `agc_out_trace_drain(dst_ptr, max_entries) -> count`, `agc_out_trace_dropped() -> u32` (honest overflow counter), `agc_out_trace_reset()`. Drain never mutates AGC state.

### 1f. `agc_ext_version()`
Returns `"ddc65e7b+lovable-hwio-v1"` plus a hardware-interface version integer, distinct from the frozen `version()` string.

`get_erasable_ptr` remains for diagnostics/tests only; no production sensor path reads through it.

## Phase 2 — Build + provenance
- `scripts/build-webagc-wasm.md` becomes executable via a `nix-shell` recipe with a pinned Emscripten. Applies `PATCHES/lovable-hwio/*.patch` in order, emits `yaAGC-ext.wasm`.
- Ship both binaries under `src/third-party/webagc/`: `yaAGC.wasm` (frozen, comparison-only), `yaAGC-ext.wasm` (extended, canonical after the gate). Vite copies both to `public/agc/` for the parity harness; runtime loads only the extended one after the gate.
- `UPSTREAM.md` gains: base commit, fork commit, per-patch upstream provenance + rationale, HW-IO interface version, both SHA-256s, exact toolchain versions, GPL notice, source-availability pointer to `third-party/virtualagc-fork/`.
- CI: `.github/workflows/reproduce-wasm.yml` rebuilds `yaAGC-ext.wasm` and asserts its pinned SHA.

## Phase 3 — Parity gate (blocking, amendment 5 + amendment 6)

### Reproduction stance (amendment 5)
Attempt to reproduce the frozen `yaAGC.wasm` SHA. If a documented Emscripten configuration produces byte-identical output, record `origin: reproduced-locally`. If not, record verbatim:

> Frozen artifact provenance supported, but byte-identical rebuild unavailable because the original toolchain configuration is incomplete.

We stop only if the frozen artifact's claimed source ancestry to `ddc65e7b` cannot be reasonably established. Byte-identity is not itself a gate.

### Behavioral parity (amendment 6)
Before invoking any new export in production paths, run both binaries through identical inputs and require identical publicly observable behavior. Coverage:

- Every ordered output-channel packet emitted (not just 010/011/0163) — full packet stream captured via `packet_read` drain per tick.
- Input acceptance behavior (writes to input channels produce identical subsequent output streams).
- Canonical startup + RSET sequence.
- Full decoded DSKY transition stream.
- Mission-time progression, `cpu_step` counts per tick, tick-boundary alignment.
- Event ordering across the public event ring.
- V35 authoritative peak checksum.
- V16 N65 fixture checkpoint checksums.
- Pause / step / deterministic tick schedules from M3.2.
- Ready + provenance diagnostics compared semantically.
- Permitted intentional diffs: WASM SHA, `version()`/`agc_ext_version()` strings, hardware-interface version. Everything else must match.

Then, before making extended canonical, run the complete frozen suites against `yaAGC-ext.wasm` at rest (no new APIs invoked):
- All Vitest (199+) via test-only adapter switch.
- All Wrangler-served Playwright specs (7) via a build-time env flag routing the Worker to the extended artifact.

If any legacy behavior differs before a new export is called: STOP, report divergence + failing patch. Do not promote extended to canonical.

## Phase 4 — Low-level export tests (extended only)
`src/sim/agc/__tests__/hwio.test.ts`:

Counters:
- PINC into an allowed input counter (e.g. PIPAX) advances through the unprogrammed sequence with authentic overflow behavior; not a raw store.
- MINC symmetric.
- Ordered batch: +5 then -5 executes 10 sequences, not 0; any resulting interrupt / overflow observable is preserved.
- Invalid `(address, sequence)` rejected (`invalid-address`), AGC state unchanged. Explicit case: THRUST + PINC rejected.
- Batch containing one invalid record applies zero records and returns the offending index.

Timing semantics (amendment 4):
- Determine empirically whether yaAGC's `UnprogrammedIncrement` executes immediately or queues for the next counter-service cycle. Document the answer in `docs/M3_3_IO_MAP.md`.
- If immediate: label the timing as an approximation and add a test measuring whether Luminary observes any difference vs. spaced-out single-pulse injection over the same tick.
- We do NOT claim cycle-accurate pulse timing unless it is actually modeled.

Interrupts:
- `agc_request_interrupt(RADARUPT)` → `accepted`, Luminary's RADARUPT handler entry is observable via a documented handler-prologue side effect.
- Immediate re-request while pending → `already-pending`, no additional entry.
- Unmapped vector → `invalid-vector`.
- T3/T4 internally-driven housekeeping fires over a 2 s tick sequence with no host injection.

Output trace:
- THRUST mutations captured in order with correct `operation`, `delta`, `valueBefore`, `valueAfter`.
- Drain returns each entry exactly once; second drain is empty.
- Overflow increments `dropped` honestly; AGC state uncorrupted.
- Deterministic: identical input schedules → identical drained traces.
- 64-bit `sequence`/`agcCycle` round-trip across JS boundary without precision loss (test with values > 2^53).

## Phase 5 — Adapter + Worker plumbing (additive, canonical extended runtime)
- `AgcCoreAdapter` gains typed methods: `applyHardwareInputs(records)`, `requestInterrupt(vector) → HwInterruptResult`, `drainOutputTrace() → OutputTraceEntry[]`, `extVersion()`, plus the test-only `counterIncrement`.
- `AgcWorker` loads `yaAGC-ext.wasm` unconditionally. No branch on monitor mode. New APIs remain dormant when monitor mode is off.
- Ordered-write drain integrated into the M3.3 tick order: after `cpu_step`, before physics.
- Any adapter production code path that previously read sensor cells through `get_erasable_ptr` is refactored to use the new APIs; `get_erasable_ptr` remains for diagnostics/tests.

## Phase 6 — Monitor mode wiring (`descent-monitor-v1`)
Only after Phases 3–5 pass:
- `src/simulation/agcio/sensors/`: pure encoders (LR altitude, LR altitude-rate, PIPA X/Y/Z) → `HwInputRecord[]` batches + RADARUPT requests, cadence-gated per IO map.
- `src/simulation/agcio/actuators/`: pure decoders for THRUST + CHAN11/CHAN14 discretes → `AgcCommandedControl`, folded by ordered reducer over the trace stream.
- `monitorProfile.ts`: `descent-monitor-v1` lists required sensors + prerequisites; unmet prereq → `monitorBlocked` with enumerated reasons + source citations.
- Physics stays driven by M3.2 scenario/manual control. Static test asserts `stepLmPhysics` never sees an AGC-sourced control value.
- Snapshot `agcMonitor` compact; full trace pulled via `sim:requestMonitorTrace` (protocol v2, additive).
- `/dev/mission-runtime` gets: mode toggle, sensor-in panel, actuator-out panel, trace viewer, verbatim `monitorBlocked` reasons.

## Phase 7 — Optional `discrete-observer-v0`
Interim diagnostic only. UI + code label: "Discrete interface diagnostic only — not a powered-descent monitor." Does not satisfy M3.3.

## Determinism / parity acceptance
- Monitor OFF on extended runtime: existing golden `touchdownTimeUs = 368_279_425` and all M3.2 checkpoints unchanged.
- Monitor ON, same scenario: every LM physics checkpoint, cumulative fuel, terminal touchdown bit-identical to monitor-off. Worker-level Vitest diffs full physics traces.
- Static assertion test: `stepLmPhysics` never called with AGC-sourced control.

## Report-back gate (end of A2)
Post:
- Extended base + fork commits, ordered patch list with upstream provenance.
- Exact new exports and the native yaAGC paths each routes through.
- Counter capability tables (rendered).
- Timing-semantics finding (queued vs immediate) + test result.
- Original-vs-extended parity result across every observable listed in Phase 3.
- Frozen regression totals (Vitest + Playwright) run against extended runtime.
- Counter / interrupt / output-observer test results.
- Rebuilt WASM SHA-256 + `agc_ext_version()`.
- Whether `descent-monitor-v1` can be entered; if blocked, enumerated missing prerequisites with source citations.
- First authentic sensor-in / THRUST-out trace.
- Explicit statement that closed-loop control remains prohibited.

## Out of scope
- Wholesale upgrade to `b6d27dc`.
- Any closed-loop AGC → physics coupling.
- IMU/RCS/abort channels beyond `docs/M3_3_IO_MAP.md`.
- Rewriting `cpu_step` or the packet queue.
