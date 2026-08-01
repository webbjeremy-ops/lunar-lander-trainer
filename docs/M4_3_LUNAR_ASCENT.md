# M4.3 — Lunar liftoff and orbital insertion

Second playable mission, at `/play/ascent`. Built on the frozen M4.0 planar
kernel and the M4.2 campaign. Nothing in M4.1, M3.3E or the AGC bootstrap work
was reopened.

## What the player does

Surface preparation → liftoff (staging + APS ignition) → vertical rise →
pitch-over → orbital acceleration → engine cutoff → coast and orbit
evaluation → debrief. The optional Orbit Sandbox starts already inserted and
allows a second (phasing) burn.

Controls: liftoff, pitch (`←`/`→`, `Shift` for fine authority, or the on-screen
buttons), engine cutoff, sandbox relight, and "End flight · debrief". The
instructor pitch cue is drawn and described but never applied. The only thing
that can fly for the player is the explicitly labelled demonstration autopilot,
which is recorded in the summary as `demonstrationUsed` and zeroes the
assistance score.

## Missions and targets

| Mission | Target orbit | Assistance default |
| --- | --- | --- |
| Liftoff Fundamentals | 15 × 70 km (gameplay-tuned) | Instructor |
| Orbital Insertion Trainer | 9 × 45 nmi (16.7 × 83.3 km) | Pilot |
| Apollo 11 Ascent Challenge | 9 × 45 nmi, 16 km periapsis floor | Commander |
| Orbit Sandbox | 49 × 45 nmi phasing target | Pilot |

Targets live in `src/game/ascent/targets.ts`, each carrying a `classification`
(`source-derived`, `historically-grounded-estimate`, `gameplay-tuned`), a
source id and a rationale. The 9 × 45 and 49 × 45 nmi values are the published
Apollo 11 orbits. **No claim is made that the browser trajectory reproduces
Eagle's ascent** — only that it targets the same orbits with the same
propulsion constants.

## Vehicle

- The descent stage is spent (`descentPropellantKg = 0`) and acts as the launch
  platform; after separation it stays exactly where it was on the surface and
  is drawn in the orbit view.
- The ascent stage uses the M4.0 constant registry: APS 15,569 N (fixed,
  non-throttleable), Isp 311 s, ascent inert mass ≈ 2,229 kg, usable APS
  propellant ≈ 2,353 kg, plus RCS attitude authority.
- Reference profile: cutoff at ≈ 440 s into a 16.3 × 83.8 km orbit with ≈ 106 kg
  APS propellant left — consistent with the historical ~7-minute main burn.

## HUD and orbit view

Altitude, inertial/radial/tangential speed, pitch, flight-path angle, apoapsis,
periapsis, time to apoapsis, propellant, remaining Δv (Tsiolkovsky), target
orbit error, vehicle mass. The Moon-centred SVG shows the surface, the target
orbit, the predicted coast conic, apsis markers, the thrust axis, the advisory
cue and the jettisoned descent stage.

## Teaching and scoring

`src/game/ascent/teaching.ts` answers the six required questions (why pitch
over, why a high apoapsis can still impact, cutoff timing, mass loss, Δv versus
fuel, phasing); they are surfaced in the debrief. Scoring (100 points): orbit
achieved 25, periapsis safety 20, target apoapsis 20, propellant 15, cutoff
timing 10, smoothness 5, assistance 5.

## AGC and the physics firewall

The authentic shared Luminary 099 session is displayed beside the cockpit and
is fully keypad-interactive, labelled *Authentic AGC emulator · historically
grounded ascent physics · the AGC is not controlling this vehicle*. P12 is not
started in the rope, so the ascent cues are labelled educational rather than
rope-driven. `src/game/ascent/**` imports nothing from `src/agc/**` — enforced
by a test — and the ascent route never feeds DSKY input to the vehicle.

## Acceptance

- Vitest: **649/649 passing** (27 new in `src/game/ascent/__tests__/ascent.test.ts`),
  including independent orbital math, staging, determinism (bit-identical
  replay), insertion accuracy, insufficient-periapsis, surface-impact and
  propellant-depletion failures, guidance purity and the firewall check.
- `tsgo --noEmit`: clean. Production build: clean.
- Playwright `tests/ascent.spec.ts`: **4/4 passing** (briefing, liftoff →
  insertion, early-cutoff impact warning, AGC labelling).
- M4.1 descent, M3.3E hardware-interface lab and the 1D golden touchdown
  (368,279,425 µs) are untouched and still green.
