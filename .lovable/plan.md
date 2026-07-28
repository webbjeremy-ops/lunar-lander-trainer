# Milestone 1 (revised) — Worker isolation + deterministic mission clock

M0 already ships a working `AgcCoreAdapter` (WASM load, rope load, DSKY lamps/keys, erasable memory, diagnostics). M1 moves all emulator execution into a dedicated ES-module Web Worker behind a typed protocol and a deterministic fixed-step mission clock, while preserving every M0 behavior and adding proper licensing, provenance, and diagnostics.

Every one of your 11 revisions is folded in below and marked **[Rev N]** where it lands.

---

## Files added

### Licensing, provenance, project docs
- `LICENSE` — GPL-3.0-or-later (full text)
- `LICENSES/GPL-2.0-or-later.txt` — upstream text for webAGC/yaAGC, including yaAGC's WASI/linking exception if present in upstream
- `THIRD_PARTY_NOTICES.md` — webAGC, yaAGC, `chrislgarry/Apollo-11` rope source, `virtualagc/virtualagc` toolchain, npm dependency summary
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `docs/licensing.md` — classification table + independence disclaimer (not sponsored/approved/endorsed by NASA, MIT, Virtual AGC, or original contributors)

### Rope artifact + reproducible build **[Rev 2, Rev 5]**
- `public/ropes/Luminary099.bin` — the exact byte-identical M0 binary, moved here (M0 file also kept in place for one release to avoid breaking anything; see "Files changed")
- `public/ropes/Luminary099.manifest.json` — schema below; distinguishes source / artifact / build-tool provenance and reports reproduction status honestly
- `scripts/build-luminary099.sh` — reproducible rope build using pinned commits:
  - `chrislgarry/Apollo-11@911e5c0283c629c50cb97666f34065e8c07d71a5`
  - `virtualagc/virtualagc@b6d27dc645fdc1ac75a3f825fea1d81e06729cc3`
  Script clones both at those commits, builds `yaYUL`, assembles Luminary099, emits the binary + SHA-256, and prints a diff vs. `public/ropes/Luminary099.bin`
- `.github/workflows/reproduce-rope.yml` — CI job that runs the script and uploads the generated binary + a comparison report as an artifact. Failure on unexpected mismatch is gated by a manifest field so first-run reproduction is a manual review, not a merge blocker
- `docs/rope-reproduction.md` — how to run the script locally, how to interpret the report, and what to update in the manifest when reproduction succeeds

**Manifest schema** (values that are unknown until reproduction runs are literally `null`, never fabricated **[Rev 2]**):
```json
{
  "displayName": "Luminary 099",
  "agcProgram": "Luminary099",
  "sourceProvenance": {
    "repository": "https://github.com/chrislgarry/Apollo-11",
    "commit": "911e5c0283c629c50cb97666f34065e8c07d71a5",
    "path": "Luminary099"
  },
  "buildToolProvenance": {
    "repository": "https://github.com/virtualagc/virtualagc",
    "commit": "b6d27dc645fdc1ac75a3f825fea1d81e06729cc3",
    "tool": "yaYUL"
  },
  "artifactProvenance": {
    "file": "public/ropes/Luminary099.bin",
    "byteLength": <measured>,
    "sha256": "<measured from the committed file>",
    "origin": "inherited-from-milestone-0",
    "buildCommand": null,
    "generatedAt": null
  },
  "reproduction": {
    "status": "not-yet-reproduced",
    "reproducedSha256": null,
    "reproducedByteLength": null,
    "byteIdentical": null,
    "reportUrl": null,
    "notes": "M1 starts with the M0 binary; reproduction from pinned source + toolchain is tracked in reproduce-rope.yml. Manifest will be updated in-place once CI reports a byte-identical build."
  },
  "publicDomain": true
}
```

### webAGC pin — actual code vendored, not just documented **[Rev 3]**
- `src/third-party/webagc/` — the exact upstream source files the runtime touches at `michaelfranzl/webAGC@0575ea7a1231e3948bae7d2c22a6ac146da0c38d` (upstream package version 1.1.0):
  - the upstream WASI glue + `yaAGC.wasm` loader logic our adapter is derived from
  - unmodified `LICENSE` and any upstream `NOTICE` / special-exception text
- `src/third-party/webagc/yaAGC.wasm` — **the exact WASM the runtime uses**, moved from `public/agc/yaAGC.wasm`. Copied to `public/agc/yaAGC.wasm` by a `vite` `publicDir` alias / pre-build step so it is served same-origin at a stable URL. Runtime and vendored copy are byte-identical by construction.
- `src/third-party/webagc/UPSTREAM.md` — records:
  - upstream repo + commit + package version
  - **measured** SHA-256 of every vendored file including `yaAGC.wasm`
  - `origin: "inherited-from-milestone-0"` for the WASM until the WASM build script reproduces it
- `scripts/build-webagc-wasm.md` — sufficiently exact upstream build instructions (Emscripten SDK version, `make` targets, artifact path). Marked as a follow-up task; runtime does not silently claim a build it hasn't performed.

### AGC layer (Worker + protocol) — new project code, GPL-3.0-or-later **[Rev 4]**
Every file below carries `// SPDX-License-Identifier: GPL-3.0-or-later` and no webAGC attribution (they contain no upstream code).

- `src/agc/protocol.ts` — `PROTOCOL_VERSION` constant; discriminated `AgcCommand` (initialize, loadRope, start, pause, resume, reset, setTimeScale, dskyKeyDown, dskyKeyUp, proceedKey, stepSimulation, stepAgcDebug, requestSnapshot, requestDiagnostics, dispose) and `AgcEvent` (ready, stateSnapshot, dskyUpdate, channelUpdate, alarm, paused, diagnostics, fatalError, performanceWarning). Envelope: `{ protocol, dir: "c2w"|"w2c", seq, missionTimeUs?, requestId?, type, payload }` where `seq` is **monotonic per direction** — the client keeps its own counter, the worker keeps its own **[Rev 9]**
- `src/agc/AgcWorkerClient.ts` — sole UI-facing facade. Instantiates the worker via `new Worker(new URL("./AgcWorker.ts", import.meta.url), { type: "module" })`. Owns a per-instance `requestId` counter (uuid-prefixed) and a pending-request map that is rejected on `fatalError`, `dispose`, or worker `error` **[Rev 9]**. Registers a `visibilitychange` listener only when an explicit `pauseOnHidden: boolean` option is set; the listener is removed in `dispose()` and never auto-resumes **[Rev 10]**. Feature-detects `crossOriginIsolated` (informational only)
- `src/agc/AgcWorker.ts` — dedicated Worker entry. Owns `AgcCoreAdapter`, `MissionClock`, `EventLog`, snapshot coalescer. Its own monotonic `seq` counter for outbound envelopes. Rope-load path (see below)
- `src/agc/MissionClock.ts` — integer microseconds mission time (`bigint` accumulator, exposed as number µs where safe). Fixed 20 ms tick (50 Hz). 11 720 ns/AGC-step integer accumulator retained across ticks. Time scales {0,1,2,4,10} with **`setTimeScale(0)` = pause** while preserving the last nonzero scale; `resume()` restores it unless a new nonzero scale is supplied **[Rev 10]**. Bounded catch-up per scheduler iteration, `performanceWarning` on overrun. `stepSimulation()` = exactly one tick while paused. `performance.now()` used only to decide how many ticks are due
- `src/agc/SnapshotCoalescer.ts` — **wall-clock-throttled** snapshot publisher. Coalesces intermediate snapshots and emits at most ~25 real-time Hz (default 40 ms real-time interval), always publishing the newest available snapshot. Independent of mission time, so at time scale 10 traffic stays ~25 Hz, not 250 Hz **[Rev 1]**. Critical events (`dskyUpdate`, `alarm`, `fatalError`, `paused`) bypass the coalescer and emit immediately
- `src/agc/EventLog.ts` — versioned mission event log (`{ logVersion, seed, entries: [{ missionTimeUs, kind, payload }] }`)
- `src/agc/checksum.ts` — `stateChecksum(state)`: **observable-state regression checksum**, not a full emulator dump **[Rev 6]**. Canonical serialization:
  1. `missionTimeUs` as 8-byte big-endian
  2. `timingRemainderNs` as 4-byte big-endian
  3. `totalAgcSteps` as 8-byte big-endian
  4. Erasable memory: 2048 × 2-byte big-endian words
  5. Channels: entries sorted by numeric channel, each as `[2-byte channel BE, 2-byte value BE]`
  6. Lamp bits: 4-byte big-endian
  7. Mission-system state: canonical JSON with sorted keys → UTF-8 bytes
  8. PRNG state: 4-byte big-endian
  9. `eventLog.logVersion` (4-byte BE) and `eventLog.cursor` (4-byte BE)
  FNV-1a 32-bit uses `Math.imul` for deterministic 32-bit multiplication
- `src/agc/seededRandom.ts` — mulberry32; unseeded `Math.random` banned in `src/agc/**` and `src/sim/**` by an ESLint `no-restricted-syntax` rule

### UI
- `src/ui/diagnostics/DiagnosticsPanel.tsx` — app version, git commit (`import.meta.env.VITE_GIT_COMMIT` fallback `"dev"`), protocol version, emulator repo+commit, emulator-reported version string, rope name, rope source commit, rope SHA-256, mission time, time scale, total AGC steps, timing remainder ns, worker state, avg tick ms, scheduler overruns, `crossOriginIsolated`, audio status, last error
- `src/ui/AudioAdapter.ts` — typed no-op interface; disabled by default; gesture-gated init stub; no `AudioContext` created in M1
- `src/routes/about.tsx` — About / Credits with the three-tier classification (authentic / historically grounded / educational approximation), public GitHub source-repo link, independence disclaimer
- `src/routes/sources.tsx` (extended) — renders the rope manifest live (source / artifact / build-tool / reproduction / comparison fields) so the site never overstates provenance

### Tests
- `src/agc/__tests__/MissionClock.test.ts` — tick advances by exactly 20 000 µs; `setTimeScale(0)` pauses and preserves prior scale; `resume()` restores it; pause freezes mission time; resume does not catch up wall-clock; `stepSimulation` advances one tick; time scales {0,1,2,4,10}; bounded catch-up + `performanceWarning`
- `src/agc/__tests__/SnapshotCoalescer.test.ts` — at simulated time scale 10, snapshot emission stays ≤ ~25 Hz real-time; critical events bypass; latest snapshot wins
- `src/agc/__tests__/protocol.test.ts` — envelope shape, per-direction monotonic `seq`, `requestId` uniqueness, `PROTOCOL_VERSION` present
- `src/agc/__tests__/AgcWorkerClient.test.ts` — client ↔ mocked worker via `MessageChannel`: `initialize` → `ready`, `dskyKeyDown` propagates, snapshot delivery, pending requests reject on `fatalError` and `dispose` **[Rev 9]**
- `src/agc/__tests__/checksum.test.ts` — canonical serialization is stable across key insertion order; identical states → identical checksum; single-field change → different checksum
- `src/agc/__tests__/determinism.test.ts` **[Rev 7]** — parameterized: same rope + seed + event log + target mission time produces the same checksum across combinations of:
  - snapshot cadence (10 Hz, 25 Hz, 60 Hz)
  - scheduler batch size (1 tick, 5 ticks, 50 ticks per iteration)
  - injected wall-clock delays between iterations
  - simulated "render frame rate" via variable scheduler wake intervals
- `src/agc/__tests__/no-shared-memory.source.test.ts` **[Rev 11]** — greps `src/agc/**` and `src/sim/**` source for `SharedArrayBuffer` / `Atomics` and asserts no references. Also asserts `AgcWorkerClient` initializes and functions under a mocked `crossOriginIsolated === false` global. **Does not** grep dependency bundles
- `e2e/m1-smoke.spec.ts` **[Rev 8]** — Playwright test against the local production preview (`bun run build && bun run preview`):
  1. Load `/sim`, wait for `ready`
  2. Assert the real module Worker is running (`window`-side probe on the diagnostics panel state, not on the emulator)
  3. Assert `yaAGC.wasm` and `Luminary099.bin` were fetched from same-origin
  4. Press V, 3, 5, ENTR → observe historically expected lamps light from real channel output
  5. Press V, 1, 6, N, 6, 5, ENTR → observe DSKY MET update
  6. Press pause → capture mission time twice ≥ 500 ms apart → assert equal
  7. Existing M0 lamp-test and time-display expectations still pass
- `scripts/e2e.sh` — helper that builds, boots `vite preview` on a free port, runs Playwright, then tears the preview down. `playwright` added as devDependency

---

## Files changed

- `src/routes/sim.tsx` — uses `AgcWorkerClient` instead of the direct adapter; mounts `<DiagnosticsPanel>`; keeps existing header + explainer
- `src/routes/__root.tsx` — footer link to `/about` + independence disclaimer
- `src/routes/sources.tsx` — renders live manifest fields
- `src/sim/agc/roms.ts` — rope URL becomes `${import.meta.env.BASE_URL}ropes/Luminary099.bin` and manifest URL is `${BASE_URL}ropes/Luminary099.manifest.json`; wasm URL becomes `${BASE_URL}agc/yaAGC.wasm` **[Rev 5]**. Same-origin only; runtime never fetches from GitHub. Verified to work under Lovable hosting and a GitHub Pages-style subpath deployment
- `src/sim/agc/AgcCoreAdapter.ts` — keeps `SPDX: GPL-2.0-or-later` + webAGC attribution (it *is* derived from webAGC) **[Rev 4]**. Removes `oscillate`/`stopOscillator`/`setInterval` scheduler (moved into `MissionClock`, called only inside the Worker). Public API otherwise unchanged; still importable by `AgcWorker.ts` only
- `src/ui/dsky/Dsky.tsx` — consumes `AgcWorkerClient`; visual behavior preserved
- `package.json` — no version drift on `@wasmer/wasi` / `@wasmer/wasmfs` (already exact `0.12.0`); add `@playwright/test` devDependency
- `vite.config.ts` — set `base` from env for subpath deploys; add a small plugin that copies `src/third-party/webagc/yaAGC.wasm` into `public/agc/` at dev + build so the runtime WASM and the vendored WASM are guaranteed identical **[Rev 3]**
- `eslint.config.js` — `no-restricted-syntax` rule banning `Math.random()` inside `src/agc/**` and `src/sim/**`

---

## Rope-load flow **[Rev 5]**

1. UI calls `client.loadRope({ id: "Luminary099" })`
2. Worker fetches `${BASE_URL}ropes/Luminary099.manifest.json` (same-origin)
3. Worker fetches `${BASE_URL}ropes/Luminary099.bin` (same-origin)
4. Worker validates `byteLength === manifest.artifactProvenance.byteLength` and computes SHA-256, comparing against `manifest.artifactProvenance.sha256`. On mismatch: `fatalError` with a specific `code: "rope-integrity"` and the mismatched digests. **[Rev 5]**
5. Worker transfers the validated `ArrayBuffer` into the emulator via `AgcCoreAdapter.loadRom`
6. Worker emits `ready` with `{ emulatorVersion, ropeName, ropeSha256, sourceCommit, byteLength }`

The manifest is fetched at runtime, never imported into the bundle. No "consumed at build time" claim.

---

## Snapshot cadence contract **[Rev 1]**

- Simulation ticks are strictly mission-time based (20 ms fixed) and remain deterministic
- `SnapshotCoalescer` publishes at most one `stateSnapshot` per ~40 ms of **real wall-clock time** (~25 Hz), always the newest coalesced snapshot
- At time scale 10 the mission-time delta between snapshots is ~400 ms, but the wall-clock rate stays ~25 Hz
- `dskyUpdate`, `alarm`, `paused`, `fatalError` bypass the coalescer

---

## Determinism contract **[Rev 6, Rev 7]**

- `stateChecksum()` is the observable-state regression checksum defined above, not an opaque full-emulator dump
- Given identical `{ rope, seed, initial state, event log, target missionTimeUs }` the resulting checksum is invariant across:
  - rendering frame rate,
  - snapshot cadence,
  - scheduler batch size,
  - injected wall-clock delays

---

## SharedArrayBuffer / cross-origin isolation policy **[Rev 11]**

- No M1 application code (`src/agc/**`, `src/sim/**`, `src/ui/**`, `src/routes/**`) references `SharedArrayBuffer`, `Atomics`, or `crossOriginIsolated`-gated behavior
- The `no-shared-memory.source.test.ts` test asserts this at the source level (not against generated dependency bundles)
- `AgcWorkerClient` is exercised in tests with a stubbed `crossOriginIsolated === false` global; app initializes and runs fully
- Diagnostics panel reports `crossOriginIsolated` informationally only

---

## Acceptance verification order

1. `bunx vitest run` — all M0 tests + new M1 unit tests pass (MissionClock, SnapshotCoalescer, protocol, WorkerClient, checksum, determinism-across-conditions, no-shared-memory source scan)
2. `bun run build` — clean build from a fresh clone using the committed lockfile
3. `bash scripts/e2e.sh` — Playwright smoke test against the production preview: real Worker, real WASM, real rope, V35E lamps, V16 N65 E MET, pause-freezes-time
4. Manual `/about` review: authentic / modeled / approximate classification is correct and links to public source repo
5. Optional: run `scripts/build-luminary099.sh` locally (or via `reproduce-rope.yml`) and, on success, update `reproduction` fields in the manifest — until then, the site truthfully reports `status: "not-yet-reproduced"`

M2 features (7-segment decoding, 3D viewport, physics, mission director, mission timeline, guidance loop) remain out of scope.
