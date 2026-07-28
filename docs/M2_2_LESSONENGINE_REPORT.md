# M2.2 — LessonEngine (Step 3) report

Status: **Lessons 1–4 complete.** Stopping before Lessons 5–6 and `/learn` polish per the scope directive.

## Files added

- `src/lessons/types.ts` — full LessonEngine contract (types only).
- `src/lessons/keyCodes.ts` — authentic AGC key-code table (VERB=0o21=17, NOUN=0o37=31, ENTR=0o34=28, digits 1..9 = 0o01..0o11, 0 = 0o20=16).
- `src/lessons/SourceRegistry.ts` — Luminary099, pinned yaDSKY2 @ ddc65e7b, pinned webAGC @ 0575ea7, R-393, Apollo 15 Delco Manual, COLOSSUS/LUMINARY Users Guide, Saturn V LVDC reference.
- `src/lessons/fixtureExpectations.ts` — single source of authentic expectations: reads the committed golden fixtures and re-exports `V35_PEAK_CHECKSUM`, `V35_PEAK_LIT_ANNUNCIATORS`, `V35_EXPECTED_KEY_SEQUENCE`, `V16_EXPECTED_KEY_SEQUENCE`, `V16_STABLE_VERB_DIGITS`, `V16_STABLE_NOUN_DIGITS`, and the shared `FIXTURE_PROVENANCE` (rope SHA, source commit, emulator commit, decoder schema).
- `src/lessons/predicates/inputSequence.ts` — attempt-scoped key matcher. Ignores key-ups; ignores events before attempt cursor/tick; tolerates extra key-downs in between (monotone matcher).
- `src/lessons/predicates/normalizeNoun65.ts` — fixture-derived normalization for R1/R2/R3. Preserves blanks; rejects any digit position with `segments!==0` but `value===null` (unsupported relay glyph); exposes `partialValue` (leading-blanks-allowed integer) and a `noun65Advanced` monotone-progress helper.
- `src/lessons/predicates/v35LampTest.ts` — Lesson 3 predicate.
- `src/lessons/predicates/v16N65MissionTime.ts` — Lesson 4 predicate.
- `src/lessons/LessonEngine.ts` — pure reducer `stepLesson(def, prev, action)`.
- `src/lessons/content/lesson01.ts` … `lesson04.ts`, `content/index.ts`.
- `src/lessons/__tests__/testHelpers.ts` + `engine.test.ts` + `lesson3V35.test.ts` + `lesson4V16.test.ts`.

## Files changed

- None outside the new `src/lessons/` tree. No changes to the Worker, decoder, protocol, replay engine, fixtures, or UI.

## Lesson state model

`LessonState` is a plain record: `{ lessonId, status, attempt, currentStepIndex, completedStepIds, evidence[], internal, lastObservationTick }`. `internal` is an opaque per-step scratchpad the engine never inspects.

Attempts carry `{ attemptId, startedAtTick, startedAtCursor, startedAtMissionTimeUs, startDecodedChecksum }`. Only events with `tickIndex >= startedAtTick` and (for inputs) `eventId >= startedAtCursor` are eligible as evidence for the current attempt. `beginAttempt` opens a fresh attempt scoped to the CURRENT interactive step (preserving reading progress); `restart` clears all evidence and reopens at step 0 (no Worker reset).

Evidence records: `{ lessonId, stepId, attemptId, satisfiedAtTick, satisfiedAtMissionTimeUs, inputEventIds[], channelEventIds[], decodedStateChecksum, fixtureId, ropeSha256, emulatorCommit, decoderSchemaVersion, classification, educationalInteractionOnly }`. Reading-step evidence always has empty `inputEventIds`/`channelEventIds` and `educationalInteractionOnly=true`.

The engine never sends key presses, never touches DSKY values, annunciators, or memory, never advances mission time, and never reads wall-clock time.

## V35 completion evidence (Lesson 3)

Completion conjunction (all must hold):
1. Provenance match: `ropeSha256`, `decoderSchemaVersion`, `emulatorCommit` all equal to `FIXTURE_PROVENANCE`.
2. Attempt-scoped key sequence `[VERB, 3, 5, ENTR]` accepted (matcher records the four `inputEventIds`).
3. At least one DSKY-relevant channel event (010/011/0163) observed with `eventId > enterEventId`.
4. Decoded DSKY canonical checksum equals the committed `V35_PEAK_CHECKSUM` at some observation after ENTR. First matching tick is latched into `internal.peakSeen` / `internal.peakAtTick`.
5. `peakAtTick - enterTick ∈ [0, V35_MAX_TICKS_TO_PEAK]` (`400` ticks = 8 s at 50 Hz, ~4× the fixture's 40-tick reference gap).

The peak checksum encodes both digits (all `88`, both `+` sign relays) and every annunciator bit (14 lit in the fixture: `agcWarning, alt, compActy, gimbalLock, keyRelease, noAtt, operError, prog, restart, standby, temp, tracker, uplinkActy, vel`), so the checksum comparison already covers the fixture-lit annunciator set. `V35_PEAK_LIT_ANNUNCIATORS` remains exported for developer diagnostics and UI hint rendering.

Evidence written on completion cites the actual `inputEventIds` for V/3/5/ENTR, the collected post-ENTR `channelEventIds`, the current-observation checksum (== peak checksum), `fixtureId="v35-lamp-test"`, and `classification="authentic-emulator"`.

## V16 N65 completion evidence (Lesson 4)

Completion conjunction (all must hold):
1. Provenance match with `FIXTURE_PROVENANCE`.
2. Attempt-scoped key sequence `[VERB, 1, 6, NOUN, 6, 5, ENTR]` accepted.
3. At least one channel 010/011/0163 event observed with `eventId > enterEventId`.
4. Decoded VERB digits `[1, 6]` AND decoded NOUN digits `[6, 5]` — the `.value` fields, not `.segments` — in each observation the engine records.
5. All of R1/R2/R3 pass the fixture-derived normalizer (`readNoun65().allValid`) — an unsupported relay glyph on any position rejects that observation.
6. At least `V16_MIN_POST_ENTER_OBSERVATIONS = 2` such observations recorded in order.
7. Across every consecutive pair of recorded observations: `tickIndex`, `missionTimeUs`, `snapshot.totalAgcSteps`, AND the composite Noun-65 anchor (`h*1e7 + m*1e5 + s`, with per-register `partialValue` fallback) strictly increase.

Explicitly NOT completion-relevant: OPR ERR being latched (fixture doesn't require it), any literal R3 string like `__9_5` (the two illustrative fixture samples are not treated as universal targets).

Evidence on completion cites all 7 input event ids, the collected post-ENTR channel event ids, the current-observation checksum, `fixtureId="v16-n65-met"`, `classification="authentic-emulator"`.

## False-positive tests (Lesson 3)

- `correct keys with NO channel output do not complete` — feeds all four keys but truncates the channel-event stream. Result: `in-progress`.
- `authentic V35 peak reached BEFORE the current attempt does not complete` — replays the full fixture into the decoder, then opens a fresh attempt with cursor past every historical event and observes the same decoder state. Result: `in-progress`.
- `partial lamp pattern does not complete` — turns on just `uplinkActy`, presses only V/3/5 (no ENTR). Result: `in-progress`.
- `fabricated decoded object with no supporting channel events does not complete` — hand-builds the full peak (all 8s, every annunciator on), presses all four keys, but supplies `recentChannelEvents: []`. Result: `in-progress`. This proves the UI cannot spoof completion.
- `wrong rope hash does not complete` — overrides `provenance.ropeSha256` with zeros. Result: `in-progress`.
- `wrong decoder schema version does not complete` — overrides `decoderSchemaVersion=99`. Result: `in-progress`.

## False-positive tests (Lesson 4)

- `VERB/NOUN stable but display NOT advancing does not complete` — feeds two identical observations.
- `register change BEFORE Enter does not complete` — only VERB pressed; advancing R3 shown but attempt sequence unfulfilled.
- `unsupported relay glyph in a register prevents completion` — sets a digit with `segments=42, value=null`.
- `restart clears prior attempt evidence and requires new inputs` — after restart, stale pre-restart input eventIds do not complete.
- `identical action streams yield byte-identical evidence` — determinism guarantee.

Plus Lessons 1–2 guarantees: `Lessons 1 and 2 never mutate their observation input`, and `replaying the same action sequence yields byte-identical state`.

## Test counts / build

- **Vitest:** 13 files, **73/73 passing** (was 40; +33 new lesson tests + fixture-derived helpers).
- **Typecheck (`tsgo --noEmit`):** clean.
- **Production build:** clean; no changes to the Worker or SSR bundles.

## Remaining ambiguity in Noun 65 display interpretation

The committed `tests/fixtures/v16-n65-met.json` currently records only two decoded samples (`preTestChecksum`, samples A/B). Both samples show `verb.digits[1].value === 5` and `noun.digits[1].value === 4` — i.e. the captured frames do NOT show a settled `VERB 16 / NOUN 65`. Per the audit note the samples are "captured during display updates", and per the reasoning in the task ("individual captured frames may occur during display updates") this is expected but leaves us unable to run the pure decoder end-to-end against a raw event stream that reaches the stable V16 N65 monitor state.

Consequence: the Lesson 4 "fixture completes lesson" acceptance is proved with a hand-constructed observation stream that mirrors what the authentic V16 N65 monitor cadence looks like at the decoder level (VERB=[1,6], NOUN=[6,5], advancing R3, monotone `totalAgcSteps` / `missionTimeUs` / `tickIndex`). The predicate itself only accepts data that carries channel-event ids and passes the fixture-derived normalizer — it cannot be spoofed by a UI-only mock (see the fabricated-decoded false-positive test on Lesson 3, which applies identically here).

To fully close this ambiguity in a follow-up, `scripts/capture-v16-n65.ts` needs to:
1. Emit the full raw `dskyEvents` array (as V35 does today), not just decoded samples.
2. Sample at ≥ 250 ms after ENTR to let the AGC finish the first monitor write cycle.
3. Include ≥ 3 samples spaced ≥ 1 s apart so the fixture directly demonstrates forward advance.

Additionally, the second sample in the committed fixture has `r3.sign = { plus: true, minus: true }` — both latches asserted. This is legal per yaDSKY2 (independent latches) and Lesson 2's reading material calls it out as a diagnostic state, but it means the fixture as-is includes a `signsClean: false` register. `readNoun65` currently returns `signsClean` as informational only; the Lesson 4 predicate does not gate on it, matching the "OPR ERR / both-on sign relays neither complete nor fail unless fixture requires it" rule.

## Next up (awaiting approval)

Lessons 5–6, `/learn` route integration, and committed browser tests remain. Nothing beyond the pure engine and fixtures has been touched yet.
