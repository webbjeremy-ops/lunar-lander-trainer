# M4.8 — Windows-up roll and live 1201/1202 alarms

Two additions to the powered-descent experience, both driven by the existing
"historically grounded bridge" pattern: the crew ritual is real and the player
must perform it, but the underlying rope is not flying the vehicle.

## 1. The windows-up roll (player-performed, no new physics)

Apollo 11 flew face-down through early braking, then rolled 180 degrees to
windows-up around PDI+4 min so the landing radar looked at the surface and the
crew could see landmarks. The flight kernel is planar and has only a pitch
angle, so roll is modelled as a **cockpit orientation state**, not a physics
degree of freedom — the golden touchdown fixture and the physics firewall are
untouched.

What the player does:

- A new `ROLL` control in the cockpit (hold-to-roll, hardware-styled like the
  ENG ARM switch). Holding it advances a roll angle from 180 deg (windows-down)
  toward 0 deg (windows-up) at a fixed authentic rate.
- Aldrin/Armstrong callouts cue the maneuver on the existing callout tape at
  PDI+~3 min, and a new procedure step marks it complete once the vehicle is
  within tolerance of windows-up.
- Consequence, not decoration: while still windows-down, the landing radar
  cannot acquire. The radar-acquisition event, `V57` acceptance step, and the
  Delta-H monitoring step stay locked until the roll is finished. Rolling late
  therefore delays the whole radar sequence, exactly as it would have.
- The out-the-window scene and the attitude readout flip to reflect the new
  orientation so the maneuver is visible.

```text
PDI ---- face-down (radar blind) ---- [ player rolls ] ---- windows-up
                                                     |
                                          radar acquire -> Delta-H -> V57
```

## 2. Live 1201 / 1202 alarms at historical GET

Alarms fire from a scripted timeline keyed to the reconstructed times already
recorded in the powered-descent reference content (first 1202 at PDI+101 s,
second at PDI+116 s, with the 1201s later in the approach).

- The DSKY shows PROG alarm lamp plus the alarm code, rendered through the same
  bridged-overlay channel used for the flashing V99, and clearly labelled as a
  bridged event so nothing pretends the rope raised it.
- Crew response is required: `V05 N09 E` to read the code, then `RSET` to clear
  the lamp. Mission Control's "Go" callout follows on the callout tape.
- Ignoring an alarm does not fail the mission (Houston's call was based on
  guidance health, not the alarm) but it is scored: prompt, correct handling
  counts toward the mission result, and an unread alarm is reported at debrief.
- Alarms are scenario-gated: only the full Apollo 11 powered-descent mission
  gets them; terminal-descent and free-flight scenarios stay clean.

## Technical notes

- New pure module `src/game/play/descentRoll.ts`: roll state, rate constant,
  reducer, and a `radarAvailable(rollState)` predicate. Unit-tested.
- New pure module `src/game/play/programAlarms.ts`: alarm timeline keyed off
  PDI-relative microseconds, reducer for raise/read/reset, and scoring. Times
  and citations sourced from `src/content/apollo11PoweredDescentReference.ts`
  rather than re-entered by hand.
- `src/ui/play/usePlaySession.ts` folds both reducers into the existing 20 ms
  loop alongside `reduceIgnition`, and exposes `roll` and `alarms` on the
  session API. No change to command application order.
- `src/game/play/procedures.ts` gains a `roll-windows-up` step and an
  `alarm-response` step; `procedureEngine.ts` gains gates mirroring the
  existing `requiresEngineArm` pattern (`requiresWindowsUp`, `requiresAlarmAck`).
- Cockpit: new `AttitudePanel.tsx` for the roll control and orientation
  readout; `Dsky.tsx` extends the existing `bridgedRequest` overlay with a
  PROG-alarm variant. `LunarScene` flips horizon orientation with roll.
- Physics firewall: `src/simulation/lunar2d/` and the M3.1 kernel are not
  modified. Golden touchdown value `368_279_425` re-verified in the suite.
- Coverage: unit tests for both reducers and the procedure gates, plus a
  Playwright spec that rolls windows-up, acquires radar, takes a 1202, and
  clears it.
