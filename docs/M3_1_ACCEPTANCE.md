# M3.1 — Deterministic LM Descent Physics Kernel

Status: **complete**. Frozen M2 behavior untouched (no changes to `/learn`,
event-log schema, import validation, replay semantics, canonical AGC
initialization, or the single-Worker AGC lifecycle). M2 freeze point
recorded in `docs/M2_FREEZE.md` remains authoritative.

## Deliverables

- `src/simulation/lm/types.ts` — public state / input / touchdown types.
- `src/simulation/lm/parameters.ts` — sourced vehicle parameters (with
  `provisional: true` flags on placeholders), gameplay touchdown thresholds,
  integration settings. Sources cited inline.
- `src/simulation/lm/physics.ts` — pure `stepLmPhysics(state, input, dtUs, params)`.
- `src/simulation/lm/scenario.ts` — pure `runLmScenario(...)` with stable
  same-timestamp command ordering (`order` field, then insertion index).
- `src/simulation/lm/__tests__/goldenScenario.ts` — locked test vector.
- `src/simulation/lm/__tests__/physics.test.ts` — 16 tests covering purity,
  free fall, mass-dependent acceleration, fuel exhaustion, throttle clamp,
  surface non-penetration, terminal touchdown, determinism, and
  frame-rate independence.
- `src/routes/dev.lm-physics.tsx` — minimal dev-only harness at
  `/dev/lm-physics` (marked `noindex`, not linked from primary nav).

## Physics state schema

```
LmPhysicsState {
  simulationTimeUs: integer µs since scenario start
  altitudeM, verticalVelocityMps: SI, up-positive
  dryMassKg, propellantMassKg: kg (propellant clamped ≥ 0)
  throttle: [0, 1] (clamped)
  engineEnabled: boolean
  landed, crashed: terminal flags
  touchdown: TouchdownResult | null   // set once, never rewritten
}
```

## Units and sign convention

SI throughout the kernel. Altitude up-positive, velocity up-positive,
gravity acts downward, thrust acts upward. UI unit conversion (feet, ft/s)
lives outside the kernel.

## Integrator

Semi-implicit (symplectic) Euler at a fixed **10 ms** internal substep
(`integration.substepUs = 10_000`). Public `stepLmPhysics(dtUs)` breaks
its interval into whole substeps and drops any fractional µs — callers
schedule against the substep grid. `runLmScenario` further quantises
segments between command boundaries to whole substeps so that repeated
runs, and any subdivision of the same schedule, are bit-identical.

## Sourced vs. provisional parameters

| Field | Source | Provisional? |
| ----- | ------ | ------------ |
| `lunarGravityMps2 = 1.62` | NASA moon fact sheet | no |
| `maxThrustN = 45040` | Grumman LM Familiarization Manual (DPS FTP) | no |
| `specificImpulseS = 311` | Grumman LM Familiarization Manual (DPS vacuum Isp) | no |
| `dryMassKg = 7365` | Orloff, *Apollo by the Numbers* (SP-4029) | **yes** — placeholder, refine at M3.3 |
| `initialPropellantKg = 8200` | Orloff, *Apollo by the Numbers* (SP-4029) | **yes** — placeholder, refine at M3.3 |
| `minThrottleFraction = 0` | Kernel design | **yes** — DPS throttle-band deferred |

Touchdown thresholds (`safeVerticalSpeedMps = 3`, `hardVerticalSpeedMps = 6`)
are gameplay values, deliberately not presented as historical constants.

## Fuel-consumption model

`ṁ = F / (Isp · g₀)` with `g₀ = 9.80665 m/s²`. Effective thrust is scaled
down within a substep if the requested mass flow would exceed remaining
propellant, and propellant is then clamped to zero. Engine-off or empty
tank ⇒ zero thrust regardless of commanded throttle.

## Touchdown handling

When a substep would place `altitudeM ≤ 0`, the kernel solves the constant-
acceleration quadratic within the substep to find the exact touchdown
instant, records it (µs-precise), classifies by |v_z| against configured
thresholds, and marks the state terminal. Later ticks latch control input
but never advance altitude, velocity, or evidence.

## Golden scenario result (regression lock)

Initial: `altitude = 2000 m`, `v = −20 m/s`, `propellant = 1000 kg`.
Commands: engine on @60% at t=20s, throttle up to 80% at t=60s.
Terminal: `classification = crash`, `touchdownTimeUs = 368_279_425`,
`v = −228.3144 m/s`, `remainingPropellant = 0 kg`. Locked in tests.

## Determinism evidence

- Repeated `runLmScenario` calls produce structurally equal final states.
- Same schedule evaluated one-shot vs. one-substep-at-a-time produces the
  same terminal state (frame-rate / UI-speed independence).
- Same-timestamp commands honour `order` regardless of insertion order.
- `dtUs = 0` never advances physics; a pause loop is a no-op.

## Gates

- Vitest: **191 / 191 passed** (16 new).
- `tsgo --noEmit`: clean.
- Production build: covered by the harness CI check.

## Not in this milestone

Horizontal motion, attitude, terrain, landing-gear model, radar noise,
AGC guidance coupling, 3D rendering, polished game UI. Per the plan
these belong to M3.2 – M3.5.
