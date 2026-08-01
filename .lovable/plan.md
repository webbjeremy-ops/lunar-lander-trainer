# M4.10 — Crisp manual flight controls and a lag-free descent view

Two separate problems are producing the "delay" you feel: how attitude
responds to the arrow keys, and how often the descent view actually redraws.

## 1. Attitude control feels floaty (this is the horizontal-movement delay)

Today attitude is a pure double integrator. An arrow key adds angular
acceleration, and when you release the key the vehicle keeps rotating at
whatever rate it built up — it is only zeroed inside a rate deadband of
0.0001 rad/s, which is never reached in practice. So every input has to be
manually counter-steered, and because horizontal velocity comes from tilt,
the horizontal axis inherits that lag twice over.

Change the cockpit controller to a rate-command / attitude-hold law, which is
also how the real digital autopilot behaved in P66:

- Holding left/right commands a body rate directly; the controller drives the
  vehicle to that rate instead of adding acceleration forever.
- Releasing the key commands zero rate, so the RCS actively nulls rotation and
  the vehicle stops where you left it, within a realistic deadband.
- Raise the deadband from 0.0001 rad/s to a value the controller can actually
  settle into, and increase attitude authority so a tilt input bites within
  about a tenth of a second.
- Tapping a key gives a small immediate attitude nudge, matching the throttle
  nudge already added for the up/down keys.

Attitude constants stay in `LunarMissionConstants.ts` and remain labelled
`gameplay-tuned`; only their values and the controller law change. RCS
propellant still burns with command magnitude, so the budget stays meaningful.

## 2. The descent view lags behind the vehicle

`LunarScene` redraws from a React effect keyed on flight state, and every draw
reassigns `canvas.width`/`canvas.height`, which reallocates and clears the
whole backing store. Combined with a full React re-render of the HUD, panels
and memoised derived values on every published physics frame, the picture
trails the input.

- Draw the scene from the animation loop against a ref, not from a React
  effect on state, so the canvas paints once per frame in step with the physics
  publish.
- Only resize the backing store when the element's pixel size or DPR actually
  changes.
- Keep the numeric HUD on React state but publish it at a fixed readable rate
  (about 10 Hz) instead of every frame, so text updates stop competing with the
  scene for frame time.

## Technical notes

- `src/simulation/lunar2d/physics.ts`: attitude integration gains an explicit
  rate-null branch when the command is zero, using the deadband and a bounded
  RCS authority. Still pure, still fixed 20 ms substeps, no signature change.
- `src/simulation/lunar2d/LunarMissionConstants.ts`: retune
  `maxAngularAccelRadPerSec2`, `maxAngularRateRadPerSec`, and
  `rateDeadbandRadPerSec`, with updated rationale text.
- `src/ui/play/usePlaySession.ts`: arrow keys map to a commanded rate; the
  resolver converts rate error to an attitude command. Add an immediate nudge
  on keydown. Expose a `flightRef`-based subscription for the scene and a
  throttled state publish for the HUD.
- `src/ui/play/LunarScene.tsx`: accept the live ref plus a frame subscription,
  move drawing into `requestAnimationFrame`, cache canvas dimensions.
- The reference-guidance autopilot and the ascent/orbit sessions keep their
  existing behaviour; only manual descent control changes.

## Verification

- Vitest: attitude nulls to zero rate within the deadband after the command is
  released; rate limit is respected; RCS burn still scales with command; the
  golden touchdown scenario is re-baselined only if the retune moves it, and
  the new value is recorded with the change.
- Playwright: at P66, press and release the horizontal key and assert attitude
  stops changing within a few frames, and that the canvas keeps painting while
  keys are held.
- Manual check in the preview with a screenshot pass before and after.

Note: retuning attitude constants can shift the deterministic golden descent
result. If it does, the fixture is updated in the same change and the new
touchdown value is documented — the physics firewall and the AGC path are
untouched either way.
