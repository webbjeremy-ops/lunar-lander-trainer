# M4.9 — Live descent monitor displays on the DSKY

Give the DSKY real R1/R2/R3 values during powered descent, in authentic Apollo
units, for every noun the descent procedure already asks the player to key.

## What the player will see

When the player keys a monitor display, the register area shows live numbers
driven from the flight state instead of staying blank:

| Display | R1 | R2 | R3 |
| --- | --- | --- | --- |
| V06 N61 (P63 selected) | Braking-phase time-to-go, min:sec | Time from ignition, min:sec | Crossrange, nm |
| V06 N62 (pre-ignition) | Absolute velocity, ft/s | Time to/from ignition, min:sec | Accumulated dV, ft/s |
| V16 N63 (braking monitor) | Total velocity, ft/s | Altitude rate, ft/s | Altitude, ft |
| V16 N68 (Delta-H check) | Braking time-to-go, min:sec | Delta-H (radar minus computed), ft | Velocity, ft/s |
| V06 N64 (P64 approach) | Time-to-go, min:sec | LPD angle, degrees | Altitude rate, ft/s |
| V16 N60 (P66 manual) | Forward velocity, ft/s | Altitude rate, ft/s | Altitude, ft |
| V05 N09 (alarm) | Alarm code, octal | blank | blank |

V16 displays update continuously; V06 displays freeze the values captured at
the moment ENTR was pressed, exactly as the real monitor verbs behaved.
Registers keep Apollo units and Apollo formatting (5 digits plus sign,
min:sec as `bXXbXX`), independent of the app's metric/imperial setting.

## Authenticity labelling

These values come from the simulation, not from Luminary erasable memory, so
they are drawn in the existing bridged-overlay treatment with a
`PROCEDURE BRIDGE` caption and classified `historically-grounded` (noun/register
assignments and scaling from the GSOP and the Apollo 11 timeline) rather than
`authentic-emulator`. Nothing is written into the AGC; the authentic decoded
registers stay untouched underneath.

Two values have no exact counterpart in the planar flight kernel and will be
labelled `approximation` in the docs: crossrange (identically zero in an
in-plane kernel, displayed as `00000`) and Delta-H (built from a deterministic
seeded radar bias against the kernel altitude, since /play has no radar model).

## Technical approach

New pure module `src/game/play/dskyMonitor.ts`:

- `MonitorNoun` union (`61 | 62 | 63 | 64 | 68 | 60 | 9`) and
  `DescentMonitorInputs` (flight state, guidance cue, `sinceIgnitionUs`,
  `timeToIgnitionUs`, accumulated dV, landing-site range, radar bias, alarm code).
- `computeMonitorRegisters(noun, inputs): MonitorDisplay` returning
  `{ verb, noun, r1, r2, r3 }` where each register is
  `{ sign: "+" | "-" | null; digits: string }` — pure, total, no formatting in
  the component.
- `monitorReducer(state, key)` — a small pure reducer fed the same accepted-key
  stream `procedureEngine` already receives, recognising `V06 Nnn E` /
  `V16 Nnn E` / `V05 N09 E` and setting the active display (with a frozen
  snapshot for V06). Unknown nouns leave the previous display up.

Wiring in `src/ui/play/usePlaySession.ts`:

- Accumulate delta-V in a ref inside the existing 20 ms step (thrust
  acceleration integral) — the only new state the loop needs.
- Feed accepted keys to `monitorReducer` next to the existing
  `procedureEngine` dispatch, and publish `session.dskyMonitor`.
- Derive the deterministic radar bias from the existing `seededRandom` helper
  keyed on the mission seed, so replays stay bit-identical.

Rendering in `src/ui/dsky/Dsky.tsx`:

- Extend the existing `bridgedRequest` prop with an optional `registers` field
  (three register objects) so the overlay can draw values in the R1/R2/R3
  positions using the current seven-segment styling.
- Precedence in `src/routes/play.tsx`: program alarm > flashing V99 ignition
  request > monitor display.

Physics firewall unchanged: the monitor is read-only over flight state, no AGC
writes, no change to `stepLunarFlight`, and the golden touchdown stays
`368,279,425 us`.

## Verification

- Vitest: register scaling and formatting per noun (including sign handling,
  min:sec rollover, and clamping past 5 digits), reducer transitions for
  V06/V16/V05 entries, frozen-vs-live behaviour, and a determinism check that
  the same run yields identical register strings.
- Playwright: fly to ignition, key `V16 N62 E`, assert the register overlay
  renders and its values change on a later frame; key `V06 N62 E` and assert
  the values hold steady.
- Existing suites (procedure engine, ignition, roll, alarms, golden touchdown)
  must stay green.

## Documentation

`docs/M4_9_DESCENT_MONITOR_DISPLAYS.md`: the noun/register table above, the
source citation for each assignment, unit scaling, and the explicit
`approximation` labelling for crossrange and Delta-H.
