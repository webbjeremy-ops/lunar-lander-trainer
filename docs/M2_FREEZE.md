# Milestone 2 — Freeze Report

_Status: FROZEN_ — all required audit gates green.

This document is the single-page overview produced during the M2 freeze audit.
For historical detail see `M1_ACCEPTANCE.md`, `M2_ACCEPTANCE.md`,
`M2_1_AUDIT.md`, `M2_2_LESSONENGINE_REPORT.md`.

## Quality gates

| Gate | Result |
| --- | --- |
| Vitest suite | **175 / 175** passing (25 files) |
| TypeScript (tsgo --noEmit) | Clean |
| Production build (Vite + Nitro / Cloudflare Workers) | Clean |
| Playwright (Wrangler-served dist/) | **4 / 4** passing (`learn`, `explore-export`, `explore-import`, `explore-replay`) |

## Defects fixed during the audit

1. `window.__agcTest.workerBoots` was only incremented by the standalone
   `Dsky` bootstrap. After the M2.2 refactor `/learn` and `/explore` route
   through the shared `AgcSessionProvider`, so the counter never advanced and
   the `/learn` acceptance test's single-Worker invariant failed at
   `expect(workerBoots).toBe(1)`. Fixed by bumping the counter (and publishing
   the client handle) inside `AgcSessionProvider`'s boot effect
   (`src/agc/AgcSession.tsx`), which is now the single source of truth for
   AGC client construction.

No other defects were found by the audit; the frozen subsystems
(`/learn`, export, import, replay) required no behavior changes.

## Architecture recap

| Layer | Module | Notes |
| --- | --- | --- |
| Emulator | `src/third-party/webagc/` | Pinned to `michaelfranzl/webAGC@0575ea7`, GPL-2.0-or-later. |
| Rope | `public/ropes/Luminary099.*` | Built from `chrislgarry/Apollo-11@911e5c0`. SHA-256 pinned in manifest. |
| Worker | `src/agc/AgcWorker.ts` | Owns the mission clock (µs), 20 ms tick, canonical cold-boot (`cpu_reset` + RSET + 20-tick quiet window). |
| Protocol | `src/agc/protocol.ts` | Typed postMessage. `protocolVersion = 2`. |
| Client facade | `src/agc/AgcWorkerClient.ts` | Main-thread only. |
| Session provider | `src/agc/AgcSession.tsx` | Owns THE single client for the app; routes attach via `useAgcSession()` + `client.addListener()`. |
| DSKY decoder | `src/agc/dsky/DskyDecoder.ts` | Pure. 5-bit relay codes; latched state contributes to snapshot checksum. |
| Event log | `src/agc/eventLog/*` | Schema v1, canonical serialization, FNV-1a checksum in-worker, SHA-256 in export payloads. Ring size cap = 200 000 events. |
| Import validator | `src/agc/eventLog/{validateImport,importCompatibility}.ts` | 64 MiB / 200 k event cap. Classifies `valid-compatible` / `valid-incompatible` / `invalid`. |
| Replay | `src/agc/replay/{ReplayReducer,ReplayClock}.ts` | Pure reducer + single-rAF playback loop with per-frame event batching. No live-AGC coupling. |
| Lessons | `src/lessons/*` | LessonEngine is a pure reducer; `LessonHost` uses a lossless shadow decoder. |
| UI routes | `src/routes/{learn,explore,capture,sim,index,about,sources}.tsx` | One `AgcSessionProvider` wraps the app in `__root.tsx`. |

## Frozen invariants (do not regress)

- **One Worker per browser session.** `AgcSessionProvider` is the only
  constructor call site for `AgcWorkerClient` outside of the standalone Dsky
  fallback used on `/sim`. Route navigation between `/learn` and `/explore`
  does NOT recreate the Worker: MET, epoch, event IDs, DSKY latched state,
  and event history persist across route changes (`explore-export.spec.ts`
  covers this).
- **Canonical cold boot.** `cpu_reset` → RSET keycode `0o22` → 20-tick quiet
  window. Fixture checksums assume this path.
- **Replay is pure.** `ReplayClock` and `ReplayReducer` share no state with
  the live worker. Replay controls MUST NOT call any `AgcWorkerClient` method.
- **Event-log semantics.** Logs contain only AGC input events and output
  channel writes. They do NOT contain spacecraft physics; there is no
  spacecraft physics in M2.
- **Compatibility labelling.**
  - `valid-compatible` → timed deterministic playback certified.
  - `valid-incompatible` → manual stepping/seeking only, timed playback
    disabled ("deterministic timing not certified for this build").
  - `invalid` → no replay panel.
- **Scrubber mapping.** Slider 0 = baseline (index −1); slider N = event N−1.
  Helpers in `ReplayReducer.ts`.
- **Test-only globals.** `window.__agcTest`, `window.__agcSession`,
  `window.__learnDiag`, `window.__agcReplayTest`, `window.__learnTest` exist
  only to serve the committed Playwright specs. They must remain bounded
  (no unbounded arrays) and free of side effects on the live AGC.

## Capture mode

`/capture` routes are gated by an explicit capture flag and are not part of
the shipped user surface. They exist to regenerate the golden fixtures in
`tests/fixtures/` via `scripts/capture-*.ts`. Fixture metadata now reflects
the canonical cold-boot path.

## Licensing

- Original source: **GPL-3.0-or-later** (see `LICENSE`).
- Vendored webAGC: **GPL-2.0-or-later** (see `LICENSES/GPL-2.0-or-later.txt`
  and `THIRD_PARTY_NOTICES.md`).
- Luminary099 assembly: NASA public domain (transcribed by
  `chrislgarry/Apollo-11`).

## Known limitations carried into M3

- No spacecraft physics, guidance target, or 3D visualisation yet — the
  event log is intentionally I/O-only.
- Timed replay of `valid-incompatible` recordings is disabled by design;
  a build with matching provenance is required to certify playback timing.
- The AGC runs at wall-clock 1× only; the worker exposes `timeScale` but the
  UI slider is retained for M3 (LM descent) use.

## Next milestone

M3 — Lunar Module physics: altitude, velocity, attitude, thrust, fuel and
landing dynamics; couples AGC output channels to a spacecraft state model
driven by the same mission clock.
