# M4.0 — Deterministic Planar Lunar-Flight Kernel

Status: **complete**. Additive only. Nothing frozen by M3.3E was modified: the
1D kernel (`src/simulation/lm/`), HW-I/O v4, the pad-load path, the PIPA scale,
the CHAN13 request decoder, and the golden touchdown
(`touchdownTimeUs = 368_279_425`) are untouched, and the pre-existing 539
Vitest cases still pass.

Total suite after M4.0: **576 / 576 passed** (37 new). `tsgo --noEmit`: clean.

## Deliverables

| File | Purpose |
| ---- | ------- |
| `src/simulation/lunar2d/LunarMissionConstants.ts` | Typed constant registry with per-value provenance |
| `src/simulation/lunar2d/types.ts` | `LunarFlightState`, `LunarControlInput`, orbital/touchdown types |
| `src/simulation/lunar2d/physics.ts` | Pure planar integrator, engine models, staging, contact |
| `src/simulation/lunar2d/scenarioRunner.ts` | Deterministic scenario/replay runner, canonical serialization, checksum |
| `src/simulation/lunar2d/scenarios.ts` | Versioned scenario registry |
| `src/simulation/lunar2d/guidance.ts` | Pure advisory reference-guidance profile |
| `src/simulation/lunar2d/__tests__/lunar2d.test.ts` | 37 acceptance tests |
| `src/routes/dev.lm-physics.tsx` | Extended with an M4.0 planar section (dev-only, `noindex`) |

## Frame and conventions

Moon-centered, non-rotating, planar inertial frame, SI units.

- Origin: center of the Moon. Position/velocity are 2-vectors in meters.
- Local vertical `û` = outward radial unit vector; local horizontal `ĥ` = `û`
  rotated +90° (direction of increasing central angle).
- `attitudeRad` is the body/thrust axis measured from local vertical, positive
  toward local horizontal. `0` = thrust straight up.
- Altitude is measured against the terrain radius directly beneath the vehicle,
  not against a fixed sphere.

## Integrator

Semi-implicit (symplectic) Euler at a fixed **10 ms** substep
(`integration.substepUs = 10_000`), matching the frozen 1D kernel. A public
`stepLunarFlight(dtUs)` breaks its interval into whole substeps and drops the
fractional remainder, so display cadence cannot affect the trajectory.

## Physical model

- **Gravity**: inverse-square, `a = -µ/r² · û`, `µ = 4.9028e12 m³/s²`. At the
  mean radius this yields 1.6229 m/s², consistent with the 1.62 m/s² surface
  constant of the frozen 1D kernel.
- **Mass**: dry mass by configuration plus DPS, APS and RCS propellant, all
  tracked separately. Thrust is divided by the live total mass every substep.
- **DPS**: 45,040 N at FTP, Isp 311 s. Commanded throttle is snapped onto the
  historical band — 0, floor at 10%, continuous to 65%, then either back down
  to 65% or up to FTP above the engage threshold. Within a substep the thrust
  is scaled down if the demanded mass flow exceeds remaining propellant.
- **APS**: 15,569 N fixed, Isp 311 s, **not throttleable** — commanded throttle
  is ignored entirely (proved by test: 5% and 100% commands give bit-identical
  states).
- **RCS attitude**: single-axis bounded model. Angular acceleration is
  `command × 0.12 rad/s²`, rate clamped to 0.35 rad/s, RCS propellant consumed
  at `|command| × 0.4 kg/s`. With the RCS tank empty the vehicle cannot rotate.
  Zero-command rates below the deadband collapse to exactly zero so serialized
  states stay bit-reproducible.
- **Staging**: level-triggered, applied before dynamics. The jettisoned descent
  stage is retained as an inert snapshot that never integrates again.
- **Surface contact**: after each substep the kernel compares the radial height
  against the terrain radius, linearly interpolates the crossing fraction,
  places the vehicle exactly on the surface at the contact angle, zeroes
  velocity and rate, and records a µs-precise touchdown report.
- **Terrain**: serializable mean radius plus optional sinusoid
  (`amplitudeM`, `angularWavelengthRad`, `phaseRad`). Default is flat.

## Terminal states

`landed`, `hard-landing`, `crashed`, `orbit-achieved`, `propellant-depleted`.
A terminal state latches: later steps neither move the vehicle nor rewrite the
touchdown evidence. `orbit-achieved` fires only for an engine-off ascent stage
above the surface whose periapsis altitude reaches 15 km.

Touchdown classification evaluates vertical speed, horizontal speed and tilt
independently and reports every violated category:

| Category | Safe | Hard ceiling |
| -------- | ---- | ------------ |
| Vertical speed | 3.05 m/s (10 ft/s design limit) | 4.6 m/s |
| Horizontal speed | 1.2 m/s (4 ft/s) | 2.4 m/s |
| Tilt | 6° | 12° |

## Derived orbital values

`computeOrbitalValues` is a pure projection — nothing orbital is ever stored in
state. It returns radius, altitude, radial/tangential speed, specific energy,
semi-major axis, eccentricity, and apoapsis/periapsis (apoapsis is `null` on a
parabolic or hyperbolic trajectory).

## Constant provenance

Every constant carries a classification:

- `source-derived` — µ, mean radius, DPS thrust/Isp/throttle band, APS thrust
  and Isp, the 10 ft/s and 4 ft/s gear limits, the 6° tilt limit.
- `historically-grounded-estimate` — stage inert masses and propellant loads
  (published breakdowns differ; the chosen set closes the ~15,103 kg LM-5 PDI
  total), and the "hard" ceilings beyond each design limit.
- `gameplay-tuned` — FTP engage threshold, RCS angular acceleration, rate limit,
  RCS mass flow, rate deadband. These are explicitly **not** historical claims.

Cited sources: NASA SP-4029, Apollo 11 Mission Report (MSC-00171),
NASA TN D-6846, TN D-7143, TN D-7082, the Grumman LM Familiarization Manual,
and the published JPL lunar GM.

## Scenario registry

Versioned, pure data (`id`, `version`, initial condition, parameters):

- `terminal-descent` (v1) — 150 m, near-vertical, low residual lateral rate.
- `high-gate-descent` (v1) — 2,300 m with 155 m/s downrange velocity.
- `liftoff-training` (v1) — ascent stage on the surface, APS loaded.
- `orbital-mechanics-sandbox` (v1) — circular 100 km orbit, no terminal check.

Editing a scenario requires bumping its `version` so recorded replays remain
detectable.

## Determinism evidence

- Repeated runs of the same schedule produce bit-identical canonical states and
  identical FNV-1a checksums.
- A one-shot run and a run subdivided to one substep per boundary produce
  identical terminal states (frame-rate independence).
- Same-timestamp commands honour `order` regardless of insertion order.
- `dtUs = 0` never advances physics.
- Circular-orbit energy drift over 30 minutes of simulated time is below 1e-4
  relative, and eccentricity stays below 1e-3.

## Reference guidance — advisory only

`computeReferenceGuidance` returns a target sink rate, an advisory throttle and
an advisory attitude, plus a short textual cue. It is a teaching aid. It is not
Luminary's P63/P64, it reads no AGC state, and no part of the kernel, the
Worker, or the harness ever applies its output automatically. **Closed-loop AGC
control remains prohibited.**

## Firewall

The `lunar2d` module imports nothing from `src/agc/`, `src/sim/agc/`, or
`src/simulation/agcio/`. It takes no hardware input and produces no channel
output. The M3.3E hardware-interface lab and the frozen 1D golden touchdown are
unaffected, as the unchanged 539 pre-existing tests confirm.

## Not in this milestone

Three-dimensional motion, rendering (React Three Fiber), landing-gear stroke
dynamics, radar noise, AGC guidance coupling, the mission director, and the
player-facing game UI.
