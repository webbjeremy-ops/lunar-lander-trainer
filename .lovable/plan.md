
# M2 Plan — Final Amendments (Delta to Approved Revised Plan)

The revised M2 plan stands. The following amendments override the corresponding sections and are binding on implementation, tests, fixtures, and `docs/M2_ACCEPTANCE.md`.

## A1. Channel 010 selector table (replaces §3 selector list)

`WWWW` selector semantics (AGC1 bit numbering `WWWWSAAAAABBBBB`, JS0 extraction `w=value&0x7FFF`; `WWWW=(w>>11)&0xF`, `S=(w>>10)&1`, `AAAAA=(w>>5)&0x1F` "left", `BBBBB=w&0x1F` "right"):

| Selector | S | Left (AAAAA) | Right (BBBBB) |
| --- | --- | --- | --- |
| 12 | annunciator | annunciator | annunciator (relay row — see A3) |
| 11 | — | MD1 (Program d1) | MD2 (Program d2) |
| 10 | — | VD1 | VD2 |
| 9  | — | ND1 | ND2 |
| 8  | — | *not a display digit* | R1 d1 |
| 7  | R1 plus relay | R1 d2 | R1 d3 |
| 6  | R1 minus relay | R1 d4 | R1 d5 |
| 5  | R2 plus relay | R2 d1 | R2 d2 |
| 4  | R2 minus relay | R2 d3 | R2 d4 |
| 3  | — | R2 d5 | R3 d1 |
| 2  | R3 plus relay | R3 d2 | R3 d3 |
| 1  | R3 minus relay | R3 d4 | R3 d5 |
| 0, 13, 14, 15 | unsupported unless the pinned yaAGC/yaDSKY reference documents a meaning; decoded as `{selector, raw, unsupported:true}` and never mutate display fields |

- User-facing name is **Program** (source label "MD" retained in code comments as the historical mode/program display; never described as MPAC).
- Selector 8 left field is explicitly ignored for display state; the raw value is retained in `raw.ch010Last` and in the timeline for inspection only.
- New unit test `DskyChannelMap.selectors.spec.ts` asserts, for each selector, that applying it mutates **only** the fields listed above and leaves every other decoded field byte-identical (property test over random `S/AAAAA/BBBBB`).

## A2. Sign relays are latched independently (replaces §3 sign handling and §5 checksum layout)

Per register, `DecodedDsky` stores:

```ts
interface RegisterState {
  plusRelay: boolean;
  minusRelay: boolean;
  displayedSign: '+' | '-' | null; // derived
  digits: [DigitCell, DigitCell, DigitCell, DigitCell, DigitCell];
}
```

Derivation: `plusRelay ? '+' : minusRelay ? '-' : null` (plus wins on tie).

Rules:
- Selector 7 updates **only** `R1.plusRelay` from `S`; must not touch `R1.minusRelay` or R2/R3. Same rule for selectors 6, 5, 4, 2, 1 against their respective register + polarity.
- `reset` and `loadRope` clear both relays on all three registers.

Checksum layout (§5) is amended: each register contributes `plusRelay:1B, minusRelay:1B, displayedSign:1B` followed by 5 × `{relayCode:1B, glyph:1B}`. Both raw relay states are checksummed so a subsequent partial write behaves deterministically across replay.

Tests added to `DskyDecoder.signs.spec.ts`:
1. Plus only → `+`.
2. Minus only → `-`.
3. Both set → `+`, both relays true in state.
4. Plus cleared while minus latched → `-`.
5. Minus cleared while plus latched → `+`.
6. `reset` clears both on all registers.
7. Selector 7 write does not affect R2/R3 or R1 minus.

## A3. Selector 12 annunciators are in scope for M2 (replaces §4 lamp map)

Selector 12 is **not omitted**. During Step 1 of implementation the pinned `src/third-party/webagc/` (michaelfranzl/webAGC @ `0575ea7`) and the referenced yaDSKY tables are audited; every verified selector-12 annunciator bit is added to `DskyChannelMap` with the following per-lamp documentation, committed inline as code comments and mirrored in `docs/M2_ACCEPTANCE.md` §Annunciators:

- Selector (=12)
- Field (`S`, `AAAAA[bitN]`, or `BBBBB[bitN]`) with **AGC1 and JS0** bit numbers
- Active polarity
- LM applicability (LM-only lamps are excluded from CM output but the CM configuration is out of scope for M2)
- Panel label as printed on the LM DSKY
- Pinned source file + line reference (e.g. `src/third-party/webagc/.../yaDSKY*.c:LNN`)
- Classification: `physical-panel` or `emulator-assist`

Candidate LM annunciators to verify and expose if confirmed by the pinned source: `NO ATT`, `GIMBAL LOCK`, `TRACKER`, `PROG`, `ALT`, `VEL`. LM-inapplicable indicators (`PRIO DISP`, `NO DAP` or CM analogues) are omitted from surface UI but their decode paths are still implemented so that unexpected activation appears in the Word Inspector rather than being silently swallowed.

Naming corrections:
- Channel 0163 bit 1 is renamed internally to `agcWarningSynthetic`. It maps to a **visible** panel label only through the LM configuration table; if the pinned LM mapping puts a panel-`PROG` indicator on selector 12, the on-screen `PROG` glyph comes from selector 12, not from ch 0163 bit 1.
- Accessible description text for the `agcWarningSynthetic` indicator says "AGC warning (yaAGC-synthetic)" with a source citation link into `/sources`.
- The M1 test id `lamp-AGC_WARN` remains a stable DOM alias for backward compatibility but points at the correctly-sourced element.

The V35 golden trace (§9 / A7) records the selector-12 annunciators exactly as the pinned emulator produces them.

## A4. Replay tick semantics (replaces §6 procedure)

`tickIndex` = number of completed fixed 20 ms simulation ticks at the moment a command is accepted.

Replay loop per tick boundary `t`:
1. Drain, in `orderWithinTick`, all commands with `tickIndex == t` and `phase == 'beforeTick'`. Apply each to the Worker in order.
2. A `stepSimulation` command processed while paused advances **exactly one fixed tick as part of that command** (identical to the runtime handler). Do **not** automatically add another tick after it.
3. After all boundary commands are processed:
   - If the Worker is **paused**, do not advance.
   - If the Worker is **running**, advance normal fixed ticks by wall-clock-independent tick delta until the next recorded boundary, or until `targetTickIndex`.
4. Command ordering at the same boundary is preserved for `pause`, `stepSimulation`, `setTimeScale`, `resume`.

Reset contract for M2 (simpler than the prior draft):
- `reset` **ends** the current replayable session.
- The client clears the current command log and begins a new segment with a new `sessionId` (UUID) and epoch `missionTimeUs = 0`.
- `reset` is **never serialized as an interior command** inside an exported segment. An export contains exactly one session.

Tests added to `Replay.spec.ts`:
- Pause at t=N ⇒ no tick advance until next boundary command.
- Multiple `stepSimulation` while paused ⇒ mission time and `totalAgcSteps` advance by exactly one tick per step; no automatic ticks.
- Resume after N steps ⇒ running tick advance resumes; checksum equals runtime run of same command sequence.
- Pause + resume at same boundary (order preserved) ⇒ Worker ends running.
- `setTimeScale` while paused ⇒ paused state retained; new scale takes effect only after resume.
- Export after `reset` contains only the new session, with `sessionId` differing from the prior segment.
- Replay reaches the same final `stateChecksum` **and** the same final `running`/`paused` state as the original run.

## A5. DSKY key-release semantics (replaces §6 key-log rules)

- **Ordinary keys** (numerics, `V`, `N`, `ENTR`, `CLR`, `RSET`, `+`, `-`, `KEY REL`) are one-shot: `dskyKeyDown` sends the authentic keycode once via `adapter.keyPress`. `dskyKeyUp` **does not** call the emulator; it only clears the client's `activeKeys` bookkeeping.
- **PROCEED** is stateful: `proceedKey({pressed:true})` and `proceedKey({pressed:false})` are both forwarded to the emulator.

Serialization:
- Ordinary key-up entries are retained in the exported log with `commandType: 'dskyKeyUp'` and a flag `emulatorMutating: false`. Replay processes them as UI-only events (advances `orderWithinTick` but does not call the adapter).
- PROCEED serializes both edges as `emulatorMutating: true`.

No held-key timing is implied for any ordinary key. `AgcCommand` types are updated to document this.

## A6. Batched arrays retain per-item metadata (replaces §8 payload dedup rule)

Rules:
- **One-event Worker messages** (`channelUpdate`, `alarm`, `paused`, `resumed`, `dskyDecoded`, etc.) rely on the envelope's `seq` and `missionTimeUs`; those fields are removed from the direct message payload.
- **Batched historical arrays** (`stateSnapshot.recentEvents`, timeline arrays, event-log exports) **retain per-item metadata**:
  - `eventId: number` — Worker-side monotonic id, separate from any protocol `seq`. Not reused across sessions.
  - `missionTimeUs: number`
  - `tickIndex: number`
  - `orderWithinTick: number`
- Protocol envelope `seq` numbers are wire-transport identifiers only and must never be used as simulation-event ids. This is documented in `src/agc/protocol.ts` with a comment above `Envelope`.
- `ChannelEventLite` gains `eventId` and `tickIndex`; the existing `seq` field is repurposed to `eventId` with a JSDoc rename note, or renamed outright — chosen at implementation time based on impact on M1 UI; whichever path is chosen, the intent (Worker-monotonic simulation id, distinct from envelope `seq`) is documented.

## A7. V35 fixture captured from a real initialized state (replaces §9 fixture spec)

`scripts/capture-v35.ts` (committed) performs:
1. Boot real Worker + real yaAGC WASM + verified Luminary099 rope (identical to app path).
2. Wait for the same readiness condition the app uses (`ready` event + first `dskyDecoded` frame following rope load).
3. Record `preTest: DecodedDsky` from that first stable frame — **not** a hard-coded blank.
4. Inject V, 3, 5, ENTR through the authentic `dskyKeyDown` path with real tick boundaries.
5. Record every ordered ch 010 / ch 011 / ch 013 (raw only, no DSKY meaning) / ch 0163 event in `orderedOutputs` with `eventId`, `tickIndex`, `orderWithinTick`.
6. Detect the **peak** lamp-test frame (defined as the frame with the maximum number of lit displayed digits within the recorded window) and record it as `peakDecoded`.
7. Record `postDecoded` (the first stable frame after the test exits, if the pinned trace exits automatically within the window; otherwise `postDecoded: null`).

Fixture shape:
```ts
{
  emulatorCommit, ropeSha256,
  preTest: DecodedDsky,
  inputSequence: CommandLogEntry[],
  orderedOutputs: TimelineEvent[],
  peakDecoded: DecodedDsky,
  postDecoded: DecodedDsky | null,
  window: { ticks: number }
}
```

Lesson 3 completes when the observed decoded DSKY matches `peakDecoded` within `window.ticks` after the ENTR command. The browser test compares the **rendered** decoded DSKY against `peakDecoded` (and, when present, transitions through `postDecoded`).

## A8. Complete input-release cleanup (replaces §10 keypad handler)

The DSKY keypad's `activeKeys` set is cleared on **every** end-of-input signal:
- `keyup` (window listener while any key is held).
- `pointerup` on the button.
- `pointercancel` on the button.
- `lostpointercapture` on the button.
- `window.blur`.
- `document.visibilitychange` when hidden.
- Component unmount (`useEffect` cleanup).
- Worker `reset` and any `fatalError` event.

Pointer capture is set via `setPointerCapture` on `pointerdown` so `pointercancel` / `lostpointercapture` reliably fire when the pointer leaves the element or is interrupted by the OS.

Test added to the committed Playwright suite (`tests/e2e/m2-authentic-dsky.spec.ts` §"keypad-cancel"):
1. `pointerdown` on `V`.
2. Move pointer off the button.
3. Dispatch `pointercancel`.
4. `pointerdown` on `V` again.
5. Assert exactly two `dskyKeyDown{keyCode:VERB}` entries in the exported log — one per press — and no extra entries from the cancelled interaction.

Additional unit test asserts `activeKeys` is empty after `window.blur` and after the component unmounts mid-press.

## Scope reaffirmation

No physics, IMU, radar, terrain, 3D rendering, audio, or mission gameplay in M2. All other §1–§12 items of the approved revised plan remain in force.

## Acceptance sequencing (unchanged, with amendments folded in)

1. Unit + framework-independent tests including A1–A2, A4, A5, A8.
2. Lint, typecheck, production build (Workerd bundle).
3. Wrangler-served prod bundle end-to-end via the **committed** Playwright suite, exercising A6 (batched metadata visible in export), A7 (rendered DSKY equals `peakDecoded`), A8 (keypad-cancel).
4. Deterministic replay per A4, including pause/step/resume, time-scale-while-paused, and reset-ends-session.
5. Full M1 regression from `docs/M1_ACCEPTANCE.md`.
6. `docs/M2_ACCEPTANCE.md` written with per-check evidence and the selector-12 annunciator source-citation table from A3.
