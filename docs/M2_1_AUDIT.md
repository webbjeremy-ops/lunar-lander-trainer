# Milestone 2.1 — Step 1 Audit

Audit of the landed M2 Core against the 13 acceptance criteria, and the
defects fixed before extending it with lessons.

## Method

Read each file that participates in the DSKY / channel-010 / snapshot /
replay path (`src/agc/protocol.ts`, `AgcWorker.ts`, `AgcWorkerClient.ts`,
`SnapshotCoalescer.ts`, `MissionClock.ts`, `dsky/*.ts`, `replay/*.ts`,
`src/sim/agc/AgcIoState.ts`, `src/sim/agc/AgcCoreAdapter.ts`,
`src/ui/dsky/Dsky.tsx`) and traced each criterion to the responsible
code path.

## Findings

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Decoder processes every Ch 010 event in arrival order | PASS | `AgcCoreAdapter.drainIo()` invokes `onChannelUpdate` in emission order; the callback calls `applyDskyOutput(state.decodedDsky, val)` synchronously for every ch=010 event. No coalescing on the decoder path. |
| 2 | Selector map exactly matches the pinned reference implementation | PROVISIONAL — needs golden-trace verification | `SELECTOR_TABLE` matches the yaDSKY convention as commented, but no automated proof compares it against the pinned webAGC vendored source. Step 2 (V35 golden trace captured through the real WASM) is the definitive check. Any divergence discovered there is a decoder defect, not a fixture defect. |
| 3 | Selector-12 annunciators vehicle-appropriate for the LM | MOSTLY — `tracker` declared but not wired | LM Block-II annunciators wired: `compActy`, `uplinkActy`, `temp`, `noAtt`, `gimbalLock`, `standby`, `progAlarm`, `keyRelease`, `restart`, `operError`, `verbNounFlash`. `tracker` is declared in `DskyAnnunciators` but has no `fromA`/`fromB` mapping in `SELECTOR_12_ANNUNCIATORS`. Confirming its correct bit assignment also depends on the golden trace (Step 2). |
| 4 | Plus and minus relays remain independently latched | PROVISIONAL | `SignRelays` is `{plus, minus}` and both are stored independently in `DskyRegister.sign`. `applySignLatch` currently derives BOTH from the incoming word (`plus = signBit===1`, `minus = (codeA & 1)===1`) which behaves as an independent-latch overwrite per write, but the exact set/reset semantics vs. authentic block-II wiring must be validated with the V35 + V16 N65 golden traces. |
| 5 | Plus has priority when both sign relays are active | PASS (by convention) | The `SignRelays` type preserves both states; the DSKY UI in `Dsky.tsx` displays PLUS with priority when both are latched, so both-on remains observable in diagnostics rather than silently masked. |
| 6 | Ordinary DSKY keys send one authentic keycode and DO NOT send an AGC release packet | PASS | `AgcWorker.handle("dskyKeyDown")` calls `adapter.keyPress(keyCode)`. `AgcWorker.handle("dskyKeyUp")` only appends an `EventLog` entry; it never touches the adapter. Verified by direct read of `AgcWorker.ts` cases. |
| 7 | PROCEED preserves press-and-release semantics | PASS | `AgcWorker.handle("proceedKey")` calls `adapter.proceedKey(cmd.pressed)` for both edges; `Dsky.tsx` PRO key emits pointerDown/pointerUp as separate messages. |
| 8 | Reset clears the decoded DSKY and begins a new replay session | PASS for decoder; DEFERRED for replay recorder | `reset` clears `decodedDsky`, `recentEventsRing`, `lastLamps`, `lastChannelEventCount`, and reinitializes the `EventLog`. The `ReplayRecorder` class exists but is not yet wired into the Worker command path; the Worker-side recorder + export/import UI lands in Step 6 (`/explore`). |
| 9 | Protocol v1 messages rejected without side effects | PASS | Worker: `if (!env \|\| env.protocol !== PROTOCOL_VERSION \|\| env.dir !== "c2w") return;`. Client mirrors this in `onMessage`. Neither logs nor mutates state on a version mismatch. |
| 10 | Batched channel events retain their own event ID, mission time, tick index, and order | **DEFECT — FIXED** | `buildSnapshot` was reading `adapter.recentEvents()` and re-deriving `tickIndex`/`missionTimeUs` from the CURRENT clock, discarding each event's real context. Fix: added a Worker-owned bounded ring `recentEventsRing` populated inside `onChannelUpdate` with the event's original `{eventId, tickIndex, missionTimeUs}`. `buildSnapshot` now reads that ring. Pinned by `snapshotEventContext.test.ts`. |
| 11 | Snapshot coalescing cannot drop alarm transitions or request responses | PASS (structural) | `alarm`, `dskyUpdate`, `dskyDecoded`, `paused`, `resumed`, `fatalError`, `performanceWarning`, and all `requestId`-tagged replies (`diagnostics`) route through `send()` directly, never through `SnapshotCoalescer.offer()`. Only `stateSnapshot` is coalesced. Alarm emission is not yet wired to a source (AGC-derived alarms are Step 5); the message path is verified. |
| 12 | Time-scale controls display only Worker-confirmed state | PASS | `Dsky.tsx` displays `snapshot?.timeScale` (from the last worker snapshot) in the header; the `<select>` value binds to `timeScale` state that is written from `snap.timeScale` in `onSnapshot`, not from a local optimistic update. |
| 13 | M1 production behavior remains intact | PASS | `bun run build` succeeds; existing MissionClock / checksum / determinism / AgcCoreAdapter / AgcIoState / AgcChannelRegistry / DskyDecoder / ReplayEngine test suites all green (see below). |

## Defects fixed in Step 1

### D1 — Snapshot event context re-derivation (audit #10)

- **File:** `src/agc/AgcWorker.ts`
- **Change:** Added `WorkerState.recentEventsRing: ChannelEventLite[]`
  populated inside the `onChannelUpdate` callback at the moment of AGC
  OUTPUT, with each event's real `eventId`, `tickIndex`, `missionTimeUs`.
  `buildSnapshot()` now returns `state.recentEventsRing.slice(-24)`
  instead of re-deriving those fields from the current clock. Reset
  clears the ring.
- **Test:** `src/agc/__tests__/snapshotEventContext.test.ts` (2 cases)
  pins both the context-preservation semantics and the bounded ring.

## Items intentionally deferred (not defects)

- **V35/V16 golden traces** — Step 2 & 4. Selector table (#2), annunciator
  bit map (#3), and sign-latch semantics (#4) are validated by the real
  traces, not by hand-authored expected values. If those traces contradict
  the current decoder tables, the tables are corrected before Step 5.
- **Replay recorder wiring** — Step 6 (`/explore`). The `ReplayRecorder`
  and `replayLog` engine exist and are unit-tested; the Worker-side
  recorder + import/import validation UI ships as part of Free
  Exploration.
- **Tracker annunciator bit** — depends on the Step 2 trace to pick the
  correct bit assignment.
- **AGC-derived alarms** — Step 5 (Lesson 6). No deliberate corruption
  in M2.1 per spec.

## Test + build status at end of Step 1

- `bunx vitest run` — **40 tests / 9 files passing** (was 38; +2 for the
  new snapshot-context regression).
- `bun run build` — succeeds; nitro bundle emitted.

## Sign-off

M2 Core, with the audit fix landed, satisfies every criterion that can
be verified in isolation from the emulator. The remaining PROVISIONAL
items (#2, #3, #4) are resolved by the reproducible golden traces
produced in Step 2 and Step 4; the audit is complete and Step 2 may
proceed.

## Step 2/4 Capture Report (2026 rerun)

### Fixtures committed

* `tests/fixtures/v35-lamp-test.json` — 56 channel-010 events, 156
  decoded frames. Captured on `/capture` (gated by
  `VITE_AGC_CAPTURE_MODE=true`) via `bunx wrangler dev` serving the
  production build. Emulator `webAGC@0575ea7`, WASM sha256 pinned in
  metadata, rope `Luminary099` sha256 pinned in metadata.
* `tests/fixtures/v16-n65-met.json` — 2 samples 3 s apart. Mission-time
  delta A→B = 3,220,000 µs (strictly monotonic).

### Test posture

`src/agc/dsky/__tests__/goldenTraceReplay.test.ts` now HARD-FAILS if
either fixture is absent (no soft skip). Adds fixture-shape invariants
(metadata completeness, no machine-specific paths, monotonic MET
advance for V16 N65). All 45 vitest tests pass.

### Provisional audit findings — resolution status

Findings #2 (selector table), #3 (annunciator map), #4 (sign latch)
were marked PROVISIONAL pending real-emulator traces. **The captured
traces show they are NOT resolved — the current mappings are almost
certainly wrong.** The pure-decoder replay is deterministic and the
fixture invariants pass, but the *values* the decoder produces from
real yaAGC/Luminary099 output do not match what a Block-II DSKY would
authentically display.

#### Evidence — V35 lamp test peak

Expected (real Block-II): every digit segment lit, every annunciator
latched ON, PROG/VERB/NOUN all showing `88`, R1/R2/R3 all `+88888` or
`-88888`, verbNounFlash off.

Captured peak checksum:

```
PROG:__|VERB:__|NOUN:__|R1:.._____|R2:.._____|R3:.._____
ANN:compActy=0,gimbalLock=1,keyRelease=1,noAtt=1,operError=0,
    progAlarm=0,restart=1,standby=1,temp=0,tracker=0,
    uplinkActy=0,verbNounFlash=1|EC:29
```

Every digit is blank. Selector-12 annunciators show an implausible
subset ON *before the test even runs* (see V16 N65 pre-test with the
same annunciators lit at MET 5.4 s). This is characteristic of a
selector or bit-mask off-by-one, not of the AGC.

#### Evidence — V16 N65 (MET monitor)

At `sample-A` (MET 5.4 s) and `sample-B` (MET 8.6 s) the only lit
digit in either sample is `R2.digits[2] = "2"` (segments 91). R1 and
R3 are entirely blank. A real MET monitor would populate R1 (hours),
R2 (minutes), R3 (seconds/hundredths) and advance R3 every ~10 ms.

The program register reads `01` at `sample-A` and `00` at `sample-B`.
Luminary099 boot-idle is P00, so the transient `01` and lone `2` in
R2 are more consistent with selector-12/10/11 A vs B fields being
swapped or the register→selector routing being off by one selector
index than with the AGC actually driving those values.

#### Concrete suspected defects to investigate in M2.1 next step

1. **`SELECTOR_TABLE` A/B → digit index mapping.** Current table pairs
   digits (3,4), (1,2), (0,-) for R1/R2/R3 and (0,1) for
   PROG/VERB/NOUN. The lone lit digit at R2[2] under V16 N65 is
   inconsistent with any Luminary MET layout under this mapping and
   suggests either (a) A/B are swapped within a selector, or (b) the
   register→selector routing is shifted (e.g. our "selector 4" should
   drive R2 D4/D5 in a different order, or should drive R1).
2. **`SELECTOR_12_ANNUNCIATORS` bit plan.** The mapping of the five A
   bits and five B bits to specific annunciators is *not* cited from
   yaDSKY source — it was heuristic. The pre-test "half the panel is
   on" pattern is the classic symptom of a wrong mask/bit-order. The
   authoritative reference is virtualagc yaDSKY
   `ParseIoPacket`/`UpdateDsky` selector-12 handling; this needs to
   be transcribed exactly from the pinned yaAGC commit
   (`0575ea7`) rather than reconstructed.
3. **`applySignLatch` polarity.** With so few sign writes in the
   traces we cannot yet disprove the current "plus = S bit, minus =
   codeA bit 0" split, but the V16 N65 R2 has `..` (both off) and R1
   has `+-` (both on) with no numeric digits between them — a
   both-on with all digits blank is diagnostic noise, not a real AGC
   pattern. Independent-latch semantics may still be correct; the
   polarity assignment likely is not.

The correct next action is to transcribe the selector table and
annunciator plan from yaDSKY at `webAGC@0575ea7` (or its virtualagc
upstream at the same source commit), then rerun the capture to
confirm the traces produce authentic lamp-test and MET displays.
**Not** to invent new mappings and hope the tests still pass.

### Not started yet

Per instruction "Complete the capture phase before starting the
LessonEngine", the LessonEngine, Learn route, Free Exploration
completion, and production browser tests remain unstarted. Awaiting
direction on how to source the authoritative selector/annunciator
mapping (fetch virtualagc yaDSKY at the pinned commit vs. another
approach) before proceeding.
