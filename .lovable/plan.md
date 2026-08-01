# M4.13B — Make the historical descent sequence fire in every path

Goal: the roll cue, crew/CAPCOM callouts and the 1201/1202 alarms must appear during the powered-descent run no matter how the player enters the burn (full PDI ritual, skipped ritual, aborted countdown, or auto-guidance).

## What's wrong today

The descent clock that drives roll, callouts and alarms only advances under a
compound condition in the real-time loop (engine burning, or countdown aborted,
or no TIG offset, or already running). When the player arms the countdown and
then never answers the flashing V99 — or when the loop is entered with the
engine still off — the clock can sit at zero, so the whole historical script
stays silent. Browser checks in the last pass showed exactly that.

## Changes

1. **Single, explicit descent-clock state machine** (`src/ui/play/usePlaySession.ts`)
   - Replace the compound `if/else if` with a small helper that returns one of
     three states: `held` (countdown armed, pre-TIG), `running` (ignition
     reached, engine lit, ritual skipped, or ritual aborted), `idle`.
   - Once `running`, it never returns to `held` — the clock is monotonic.
   - When the ritual is used, the clock mirrors `sinceIgnitionUs`; otherwise it
     integrates `STEP_US` from the first running step so both paths share one
     timebase.

2. **Start condition for the no-ritual path**
   - Treat "flight lock released and simulation running" as ignition when no
     countdown was ever armed, so free-flight/auto modes begin the script at
     T+0 of their own descent instead of waiting for a burning engine.

3. **Callouts driven by the same clock**
   - `activeCallout(...)` already reads `descentClockUs`; make sure that value
     is committed every frame the loop advances (not only when other state
     changes) so the overlay updates promptly.

4. **Visible sequence status**
   - Small caption in the cockpit header showing the descent clock (T+MM:SS) and
     whether the historical script is holding or running, so the player can see
     the sequence is live.

## Verification

- Unit tests for the clock helper: ritual path, skipped ritual, aborted
  countdown, and pre-TIG hold (no advance).
- Existing callout/alarm reducer tests stay green.
- Playwright pass on `/play`: start descent without touching the PDI button and
  confirm the roll cue overlay, the 1202 alarm ring on the DSKY, and at least
  two transcript callouts appear; repeat with the full countdown ritual.

## Technical notes

Touched files: `src/ui/play/usePlaySession.ts` (clock logic, exported helper),
new `src/game/play/descentClock.ts` for the pure state machine plus tests,
`src/routes/play.tsx` for the status caption. No physics, AGC or protocol
changes — the flight kernel and worker stay frozen.
