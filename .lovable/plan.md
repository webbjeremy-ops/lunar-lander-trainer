# Hover mark on the throttle gauge

Add a small tick on the Throttle bar in the instrument cluster showing the throttle setting that exactly balances weight at the vehicle's *current* mass. Above the tick the LM climbs, below it the LM sinks. The mark appears only once the crew has the vehicle (manual takeover), so it does not clutter the panel while the computer is flying.

## Why it is useful

Hover throttle is not a fixed number: it falls continuously as propellant burns off. At PDI (~15,100 kg) hover is about 54 %; with the tanks nearly dry (~6,980 kg) it is about 25 %. That is why 26 % made the vehicle climb. The tick turns that invisible moving target into something the player can fly against.

## What the player sees

- The Throttle bar gains a thin vertical tick at the hover fraction, with a small `HOV` label and the percentage.
- Tick only renders when manual control is active and the value is inside the engine's usable band (10 %–100 %); otherwise it is hidden.
- The current-throttle percentage readout picks up a subtle cue for whether the commanded throttle is above (climbing) or below (descending) hover.
- Nothing changes about how the vehicle flies — this is a display only.

## Technical notes

- New pure helper (with unit tests) computing `hoverThrottleFraction(massKg, gravity, maxThrustN)` = `massKg * g / maxThrustN`, sourced from `LunarMissionConstants` (`DESCENT_ENGINE.maxThrustN` = 45,040 N, lunar `g` = 1.62 m/s²). Uses total vehicle mass, which `FlightInstruments` already receives as `massKg`.
- `Bar` in `src/ui/play/FlightInstruments.tsx` gets an optional `markerFraction` / `markerLabel` prop; rendered as an absolutely positioned 1px divider inside the existing track.
- `FlightInstruments` gets a `manualControl: boolean` prop, passed from the play view using the existing `manualUnlocked` / crew-has-vehicle state already exposed by `usePlaySession`.
- No changes to guidance, physics, or the flight loop.
