# M5.0 — Lunar Orbital Operations and Phasing

Status: complete. Builds on the frozen M4.5 product layer and the M4.6A shadow
findings; neither is modified. Terminal rendezvous, braking and docking are
deliberately **out of scope** — M5.0 ends at a safe, well-planned intercept
setup.

## 1. What was built

A playable and educational orbital-operations experience at **`/play/orbit`**,
plus the pure simulation layer beneath it and four new lessons.

### Player flow

1. Pick one of six exercises (Orbit Fundamentals → Sandbox).
2. Read the orbit on the Moon-centred display and the instrument HUD.
3. Plan a manoeuvre node: ignition lead time, direction, delta-v.
4. Inspect the **IMPULSIVE MANEUVER PREVIEW** (labelled an
   `EDUCATIONAL PLANNING APPROXIMATION`).
5. Press **Ignite**. The burn is finite and flown through the M4.0 kernel.
6. Coast, trim, and finish with a scored debrief and a trace checksum.

Nothing fires the engine except an explicit player press of **Ignite**. The
planner, the guided solutions and the phasing planner are advisory only.

## 2. Exercises

| id | Title | Teaches |
| --- | --- | --- |
| `orbit-fundamentals` | Orbit Fundamentals | Reading apsides, period, radial vs tangential speed. Sandbox — no terminal latch. |
| `save-the-periapsis` | Save the Periapsis | Prograde burn at apoapsis rescues a sub-surface periapsis. |
| `circularization-trainer` | Circularization Trainer | Circular speed, one burn at an apsis, judging the apsis gap. |
| `phasing-burn-trainer` | Phasing Burn Trainer | Period change → phase change → intercept geometry. |
| `apollo11-orbital-operations` | Apollo 11 Orbital Operations Challenge | The 9×45 → 49×45 nmi sequence, end to end. |
| `orbit-sandbox` | Orbit Sandbox | Free practice, no failure latch. |

## 3. Simulation layer — `src/simulation/orbitOps/`

Pure, deterministic, framework-free. The only propagator is
`stepLunarFlight` from the M4.0 planar kernel.

| Module | Responsibility |
| --- | --- |
| `types.ts` | Elements, nodes, previews, relative state, scenario shapes. |
| `OrbitConstants.ts` | Provenance-tracked values (Apollo 11 targets, safety and tolerance bands) and the mandated UI labels. |
| `OrbitalElements.ts` | Pure derivation: apsides, period, flight-path angle, conic class. |
| `OrbitVehicles.ts` | Propulsion profiles, initial states, `PASSIVE_TARGET_PARAMETERS`. |
| `OrbitPrediction.ts` | Coast sampling, conic points, impact prediction, impulsive delta-v application. |
| `FiniteBurnModel.ts` | Rocket-equation budgeting and burn integration through the kernel. |
| `ManeuverPlanner.ts` | Impulsive preview + guided solvers (raise periapsis, circularise, lower apoapsis, period change, return to target). |
| `RelativeMotion.ts` | Range, range rate, phase angle, local-frame separation, closest approach. |
| `PhasingPlanner.ts` | Deterministic bounded grid search over delta-v × revolutions. |
| `OrbitObjectives.ts` | Success/failure evaluation, scoring, debrief narrative. |
| `OrbitOpsRuntime.ts` | Pure dual-vehicle reducer, burn state machine, time-acceleration guard. |
| `OrbitTrace.ts` | Versioned input log with FNV-1a checksum and a defensive importer. |
| `OrbitScenarioRegistry.ts` | The six scenarios. |

### Two-vehicle model

The Command Module is a **passive** second vehicle: same kernel, same
integrator, zero propellant, and `PASSIVE_TARGET_PARAMETERS` so the kernel's
`orbit-achieved` latch never fires for it. Both vehicles advance on the same
20 ms step grid, so relative motion is exact rather than interpolated.

### Impulsive planning vs finite execution

The preview applies the whole delta-v instantaneously. The flown burn does
not: it runs for tens of seconds while the vehicle moves and the thrust
direction rotates with it. The UI states this explicitly, and Lesson 18 makes
the gap a teaching point rather than a defect.

### Time-acceleration guard

`timeScaleGuard` caps acceleration so it can never skip a required action:
1× during a burn, 1×/5× approaching a node, 2× near predicted impact or near
the intercept threshold. The cap and its reason are shown to the player.

## 4. UI layer — `src/ui/orbit/`

- `useOrbitSession.ts` — the 20 ms real-time loop, trace recording and derived
  views. Instructor mode auto-pauses five seconds before a node; it never
  applies a control.
- `OrbitMap.tsx` — Moon-centred SVG: surface, current conic, Command Module
  conic, planned post-burn conic, apsis markers, line of sight.
- `OrbitHud.tsx` — altitude, speeds, flight-path angle, apsides, period, times
  to apsides, propellant, delta-v, relative range/rate/phase.
- `ManeuverPlannerPanel.tsx` — node draft, preview, guided solutions, phasing.
- `OrbitControls.tsx`, `OrbitScenarioSelect.tsx`, `OrbitDebrief.tsx`.

## 5. AGC relationship — unchanged

The shared authentic AGC session is a **diagnostic companion only**. No AGC
value reaches `stepOrbitOps` or `stepLunarFlight`, and the cockpit states in
plain text that the AGC is not controlling this vehicle. The M4.6A `FAIL`
verdict on rope-driven guidance stands untouched.

## 6. Learning campaign

Track 4 (Orbital Mechanics) gains four lessons:

- **17 — Reading an orbit** (radial vs tangential, apsides, flight-path angle, period)
- **18 — Periapsis is the number that kills you** → challenge `save-the-periapsis`
- **19 — Circularising an orbit**
- **20 — Catching the Command Module** → challenge `phasing-burn-trainer`

`LessonChallengeSpec` gained an optional `route` field so a lesson can hand off
to `/play/orbit`; omitting it keeps the M4.1 default of `/play`. Results return
through the existing versioned `sessionStorage` handoff.

## 7. Acceptance

- Typecheck: clean.
- Vitest: full suite green, including 49 orbital-operations tests.
- Playwright `tests/orbit.spec.ts`: 5/5 — cockpit readout, impact-trajectory
  flag, labelled preview + guard, guided solution flown to a real orbit change,
  scored debrief with trace checksum.
- Production build: clean.

## 8. Known limits

- Planar two-body only; no third-body, no oblateness, no plane changes.
- The phasing planner is a bounded grid search over an educational model, not
  Apollo rendezvous targeting.
- Terminal rendezvous, braking and docking are not implemented, by design.
