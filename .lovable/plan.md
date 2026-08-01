# Make the end of the braking burn land on the historical high-gate point

## Where the vehicle *should* be

Apollo 11's braking phase (P63) ends at **high gate**, and the flight record fixes that point four ways at once:

| Quantity at high gate (T+506 s from PDI) | Historical value |
| --- | --- |
| Altitude | 7,600 ft (2,316 m) |
| Range still to run to the aim point | 4.1 nmi (7,600 m) |
| Forward (downrange) speed | ~500 ft/s (~152 m/s) |
| Sink rate | ~145 ft/s (~44 m/s) |

Then P64 (approach) flies 7.6 km down to **low gate** at T+642 s — 500 ft, ~0.3 nmi out, ~50 ft/s forward — and P66 hands the vehicle to the commander for the last ~110 s to touchdown at T+755.

## What the current sim actually does

A full guided run of the "Full Descent" mission was measured end to end:

- High gate altitude (2,316 m) is reached at **T+564 s**, 58 s late.
- At that moment the vehicle is only **5.6 km** from the site, not 7.6 km.
- Forward speed there is **60 m/s**, not ~152 m/s — the vehicle arrives slow and low rather than on the pitch-over point.
- The approach leg then drags: it holds a flat 60 m/s cap, crosses the aim point at T+690 with 309 m still to lose, and touches down at T+766.
- Between T+380 and T+400 (throttle recovery) the commanded pitch snaps from ~-72° to ~-4° for one cycle and back — a visible attitude twitch.
- Early in the burn the vehicle *gains* ~700 m of altitude (15.7 → 16.4 km) before the profile takes hold.

So: the burn no longer overshoots the landing zone, but it does not arrive at the historical high-gate point either. It arrives late, short, and too slow, which means P64's pitch-over and the manual takeover happen on the wrong geometry.

## What to change

### 1. One high-gate aim point, stated once
Add explicit high-gate arrival targets to the timeline module (altitude 2,316 m, range 7,600 m, forward speed 152 m/s, sink 44 m/s, T+506) and have guidance, the P64 gate, Houston, and the tests all read them from there instead of each deriving their own.

### 2. Braking law that hits altitude *and* range *and* speed together
Replace the independent altitude loop + speed loop with a terminal-targeting law: from current range-to-go, compute the deceleration and the pitch that arrive at the high-gate aim point at the scheduled time. Keep the fixed-throttle-point steering (thrust magnitude pinned, pitch as the only vertical control) since that is how the phase was flown.

Also stop the early altitude bloom: at ignition the profile must not command a vertical component larger than the one that holds 50,000 ft while the downrange velocity is being killed.

### 3. Approach phase (P64) on the historical schedule
Drop the flat 60 m/s closing cap. Between high gate and low gate, fly the timeline's own range/altitude/speed schedule so the vehicle reaches 500 ft at ~0.3 nmi out at T+642 with forward speed already down near 15 m/s.

### 4. Smooth the throttle-recovery hand-off
Blend the transition out of fixed-throttle steering over a few seconds so the commanded pitch does not jump at T+386.

### 5. Manual takeover at the right place
Confirm the crew gets the vehicle at low gate with the historical picture: ~150 m altitude, near-nulled forward velocity, site in the window, and enough descent propellant for the ~110 s to touchdown (the real margin was under 60 s at contact).

### 6. Regression tests that pin the geometry
Add an end-to-end guided-descent test asserting, with tolerances:

- high gate reached at T+506 ±20 s, altitude 2,316 m ±300 m, range 7,600 m ±1,500 m, forward speed 152 m/s ±30 m/s;
- low gate at T+642 ±25 s, 152 m ±40 m, range ≤600 m;
- touchdown at T+755 ±30 s, inside the landing-zone radius, within gear limits;
- no commanded-pitch step larger than ~10° between consecutive cycles.

## Technical notes

- Files touched: `src/game/play/descentTimeline.ts` (aim point + schedule helpers), `src/simulation/lunar2d/guidance.ts` (braking/approach laws, hand-off blend), `src/ui/play/usePlaySession.ts` (pass the new targets), plus tests under `src/game/play/__tests__/` and `src/simulation/lunar2d/__tests__/`.
- Guidance stays advisory-only and outside the AGC: no closed-loop rope control is introduced, and the pinned Luminary 099 rope is untouched.
- The physics kernel itself is not modified, so existing golden touchdown determinism results stay valid.
- The scratch harness `src/__sim.test.ts` will be turned into a proper, quiet regression test rather than a console dump.
