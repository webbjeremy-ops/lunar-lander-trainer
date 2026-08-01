# Correct the live powered-descent trajectory and roll completion

## Goal

Make the Full Descent start from the intended PDI state, keep the live vehicle on the same validated range/timeline profile as the deterministic test, and make windows-up read as a completed 180° roll rather than stopping visibly at 5°.

## Confirmed diagnosis

- The Full Descent initial state is documented and configured as the state **at PDI/ignition**: about 50,000 ft, 480 km to the landing zone, and 1,698 m/s downrange.
- In the live session, physics currently advances that state during the entire 60-second pre-ignition countdown while the engine is off. This gives the vehicle roughly 100 km of extra downrange travel before the tested braking profile begins.
- The braking regression starts thrust immediately from the configured PDI state, so it does not reproduce this live countdown path and therefore passes despite the in-game overshoot.
- The P64 prompt is clock-gated to T+506. Once the trajectory has received that extra pre-ignition travel, the prompt still waits for the clock even if the vehicle has already crossed the landing zone.
- The roll reducer declares windows-up at 5° and immediately releases the command. That 5° value is an engineering latch band with no cited Apollo source; it is not a historically accurate final roll angle.

## Implementation

1. **Make TIG the physical start of the PDI state**
   - Keep the configured Full Descent state fixed during the pre-ignition ritual instead of integrating it as though it were already 60 seconds upstream.
   - Continue advancing the ignition/countdown UI and procedure state while pre-TIG; begin the flight kernel only when ignition occurs.
   - Preserve immediate flight behavior for missions and entry paths that do not use the PDI ritual.

2. **Use one phase-transition gate for P64**
   - Treat high gate as a synchronized time-and-geometry event rather than a clock-only popup detached from the vehicle.
   - Keep transcript, coach, DSKY recommendation, and visual pitch-over together, but do not let the scripted event claim an on-profile P64 transition after the vehicle has already passed the LZ.
   - Surface an off-profile correction/abort path instead of continuing the historical script when high-gate geometry is missed.

3. **Snap a completed roll to true windows-up**
   - Retain a small internal completion tolerance so fixed-step integration does not require an exact floating-point hit.
   - On entering that tolerance, store `rollDeg = 0`, release the roll command, and report `0° · WINDOWS UP`.
   - Clarify in source documentation that the tolerance is a simulation implementation detail, not a sourced Apollo attitude tolerance.

4. **Close the regression gap**
   - Add a live-sequence regression that includes the full 60-second countdown, ignition envelope, session control handoff, high-gate/P64 timing, and signed range to LZ.
   - Assert no pre-TIG position drift from the PDI state, arrival near the high-gate range at the P64 cue, and no LZ crossing before P64.
   - Extend roll tests to verify the maneuver latches at exactly 0° while radar availability and one-way completion behavior remain unchanged.

## Acceptance checks

- During the PDI countdown, the displayed range and altitude remain at the configured PDI state.
- Ignition begins at that state; the live Full Descent reaches P64 near T+8:26, about 7,600 ft high and 4.1 nmi short of the LZ.
- The vehicle does not pass the LZ during P63 in the standard guided mission.
- P64 transcript, coach popup, DSKY recommendation, and pitch-over occur as one phase event.
- Completing the windows-up maneuver displays 0°, not 5°, and landing radar becomes available.
- Existing physics isolation remains intact: game reference guidance, not AGC output, controls the vehicle.

## Technical details

- Primary files: `src/ui/play/usePlaySession.ts`, the shared high-gate/callout gating modules under `src/game/play/`, `src/game/play/descentRoll.ts`, and their Vitest suites.
- The deterministic 20 ms kernel step and the existing DPS throttle envelope remain unchanged.
- No historical claim will be attached to the roll latch tolerance.