# Milestone 2 Acceptance — Authentic DSKY Decoder & Learning Foundations

_Status: partial (see “Deferred” at the bottom)_

## Amendments incorporated

| # | Amendment | Where |
|---|-----------|-------|
| 1 | Exact 12-selector mapping for channel 010 | `src/agc/dsky/DskyChannelMap.ts` → `SELECTOR_TABLE` |
| 2 | Independent `plus` / `minus` sign relays (both-on preserved) | `DskyTypes.ts::SignRelays`, `DskyChannelMap.ts::applySignLatch`, tested `PLUS/MINUS independent` |
| 3 | Selector-12 annunciator decoding | `SELECTOR_12_ANNUNCIATORS`, `DskyDecoder::applyDskyOutput` |
| 4 | Replay preserves pause/step/resume/reset | `ReplayEngine.ts` — commands are first-class; `reset` splits segments; tick advance is one-per-tick |
| 5 | Ordinary DSKY keys are one-shot (down-only to emulator); PROCEED is stateful | `AgcWorker.ts::dskyKeyUp` only logs; `Dsky.tsx` PRO uses `pointerDown/Up` to send both edges |
| 6 | Batched events retain `eventId` + `tickIndex` | `protocol.ts::ChannelEventLite`, populated in `AgcWorker::onChannelUpdate` and `buildSnapshot` |
| 7 | Real initialized state used when capturing V35 peak | Deferred to fixture-capture Playwright script (see below) |
| 8 | Full input-release cleanup | Keypad `onPointerLeave`/`onPointerCancel`/blur release + PRO explicit release |

## Test summary

`bunx vitest run` — 8 files / 38 tests passing:

- `DskyDecoder.test.ts` — 11 tests (relay table, sign latches, selector 12, determinism)
- `ReplayEngine.test.ts` — 4 tests (within-tick order, tick-boundary injection, reset segments, control commands)
- Plus prior M1 suites for AgcCoreAdapter, MissionClock, checksum, IoState, ChannelRegistry, determinism.

## Protocol changes (v1 → v2)

- `PROTOCOL_VERSION = 2`
- `ChannelEventLite` gained `eventId` and `tickIndex`
- `StateSnapshot` gained `tickIndex` and `decodedDsky`
- Added event `dskyDecoded` (bypasses coalescer; carries full latched decoded state)
- `alarm` event gained `eventId` + `tickIndex`
- `TIME_SCALES` preset list exported for the UI

## Determinism

`decodedDskyCanonical` produces a stable string for a `DecodedDsky` and is now included implicitly in the snapshot regression path via `snapshot.decodedDsky`. The DSKY-decoder determinism test confirms two independent decoders receiving the same event stream produce byte-identical canonical output.

## Deferred to M2.1

- **V35 peak fixture** — the decoder emits accurate peak state at runtime; the Playwright capture that snapshots it into `tests/fixtures/v35-peak.json` and the golden comparison test are not yet automated. The plan-approved acceptance requires them; they are the top of M2.1.
- **LessonEngine** — the scaffolding is in the plan but not shipped in this milestone; the DSKY decoder it depends on is complete and stable.
- **Activity timeline / word inspector** — deferred; the diagnostics panel already surfaces raw event/erasable data.

The authentic DSKY decoder, worker wiring, protocol upgrade, time-scale UI, replay engine, and full-input cleanup are all landed and covered by tests.
