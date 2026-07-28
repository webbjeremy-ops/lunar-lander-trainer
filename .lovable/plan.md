# AGC — Tranquility: Plan for Review

An authentic, education-first Apollo 11 lunar descent simulator running the real Luminary099 AGC flight software in the browser via a WebAssembly build of yaAGC. This plan covers only what is needed before implementation begins; no code will be written until you approve.

---

## 1. Technical feasibility assessment

**Feasible with caveats.**

- **Real AGC in browser: viable.** `michaelfranzl/webAGC` demonstrates yaAGC compiled to WebAssembly running Luminary/Colossus rope images in a browser. The AGC runs at ~40 kHz effective instruction rate; well within a Web Worker budget on desktop.
- **Rope images: available.** Luminary099 and Comanche055 assemble from `chrislgarry/Apollo-11` (or Virtual AGC) into binary core-rope images (`.bin` / `.rope`) consumable by yaAGC. Assembly must happen at build time (or images checked in with provenance) — the browser will not assemble sources.
- **DSKY authenticity: viable.** yaAGC exposes output channels 010/011/013/163 (DSKY relays, lamps) and accepts input channel 015 (keycodes). Driving a React DSKY from these is well-understood territory.
- **Spacecraft I/O for descent: partially reconstructed.** Luminary reads IMU PIPA/CDU counters and landing-radar data via specific input channels and erasable locations; drives descent-engine throttle via channel 014 / DAC path and RCS via channel 05/06 jets. Full authentic wiring for PGNCS↔LM is a research task (see §6), not a solved problem — this is where "historically reconstructed" labeling matters most.
- **Physics for PDI→touchdown: tractable.** 3-DOF translational + simplified attitude + variable mass + throttleable DPS is sufficient for an honest first slice. Full 6-DOF and landing-radar terrain correlation are later phases.
- **Determinism: achievable** if AGC + physics share one fixed-step mission clock and all RNG is seeded.
- **Risks:**
  - webAGC build/API drift — we will pin a commit and wrap it behind an adapter.
  - Timing coupling: AGC expects ~10 ms and ~100 ms interrupts (T3RUPT, DSRUPT) driven by our clock, not wall time.
  - WASM MIME/COOP-COEP on the Lovable deployment target — must be verified early (part of Milestone 0).
  - Threads/SharedArrayBuffer are **not** required for yaAGC; a plain Worker + `postMessage` is enough. Good, because cross-origin isolation is fragile on shared hosting.

---

## 2. Proposed system architecture

Five strictly separated layers behind a single deterministic mission clock:

```text
+-------------------------------------------------------------+
|                          UI (React)                         |
|  DSKY  |  3D Viewport (R3F)  |  Telemetry  |  Flight Dir.   |
+------------------------^------------------------------------+
                         |  typed events / selectors only
+------------------------+------------------------------------+
|                    Mission Director (FSM)                   |
|   scenarios, objectives, failure conditions, debrief        |
+------------------------^------------------------------------+
                         |
+---------+--------------+----------------+-------------------+
| AGC     |  Spacecraft Systems           |  Physics Engine   |
| (Worker)|  LM/CSM/IMU/Radar/RCS/DPS     |  SI, fixed dt     |
| yaAGC   |  <-- typed I/O bridge -->     |  RK4 integrator   |
+---------+-------------------------------+-------------------+
                         ^
                         |
                +--------+--------+
                | Mission Clock   |
                | fixed dt accum. |
                +-----------------+
```

Rules:
- UI never calls the emulator or physics directly; it subscribes to selectors.
- Physics never imports React; AGC adapter never imports Three.
- All cross-layer traffic is typed messages, not shared mutable objects.

---

## 3. Dependency and licensing assessment

**Runtime / build**
- React 19, TypeScript strict, Vite 7, TanStack Start (already in template).
- `three` + `@react-three/fiber` + `@react-three/drei` — MIT.
- `zustand` for selector-friendly UI state — MIT.
- `zod` for scenario/IO validation — MIT.
- `comlink` (optional) to type the Worker bridge — Apache-2.0.
- Vitest + Playwright — MIT / Apache-2.0.

**Historical / emulator**
- `chrislgarry/Apollo-11` — NASA-authored public-domain code, with contributor edits under permissive terms. Attribution required; no endorsement claim.
- `rburkey2005/virtualagc` (upstream Virtual AGC) — mixed: NASA public-domain source + Ron Burkey's GPL-licensed tooling and yaAGC emulator core. **This is the critical constraint.**
- `michaelfranzl/webAGC` — WASM build of yaAGC; inherits **GPL** from yaAGC.

**License implication (must be acknowledged before we ship):**
yaAGC is GPL. Statically linking its WASM into our app makes the **combined distribution** subject to GPL's corresponding-source obligation. Practical consequences:
- Our AGC adapter, worker glue, and anything that forms a "work based on" yaAGC must be offered under GPL-compatible terms, with source available.
- Loading yaAGC WASM from a same-origin static asset alongside our proprietary bundle is still combined distribution in most readings.
- Options: (a) accept GPL for the whole app; (b) publish just the AGC subsystem under GPL and keep it as an isolated module with clear source availability; (c) use LGPL only if upstream relicenses (they haven't). **We recommend (b): dedicated `agc/` package, GPL-licensed, source published, with a NOTICE in-app.**

Rope images from Apollo-11 are NASA public domain — no license issue, attribution only.

---

## 4. Phased implementation plan

**Milestone 0 — Technical spike (gate before anything else).**
1. Serve `yaagc.wasm` from `public/agc/` with correct `application/wasm` MIME on both preview and published Lovable environments.
2. Load Luminary099 rope image, reset CPU, run.
3. Drive DSKY lamp test (V35E) end-to-end, rendered from real channel 010/011/013 output.
4. Read a known erasable location; write channel 015 (keycode) from UI; observe response.
5. Confirm same works in a published build.
   *Exit criteria: screenshots + a Vitest integration test hitting the adapter.*

**Milestone 1 — Deterministic core.**
Mission clock, fixed-step accumulator, seeded RNG, Worker adapter with typed messages, pause/step/run, replay recorder skeleton. No UI beyond a diagnostics panel.

**Milestone 2 — DSKY + AGC UX.**
Authentic DSKY component (mouse + keyboard), lamps and 7-segment registers bound to emulator output, VERB/NOUN/PROG display, PRO/KEY REL/ENTR/CLR/RSET, focus states, a11y.

**Milestone 3 — Physics + LM systems (descent-scoped).**
Moon-centered 3-DOF + simplified pitch/yaw, RK4 fixed-step, DPS throttle model, variable mass, propellant depletion, ground collision + touchdown criteria. Unit-tested against analytic cases.

**Milestone 4 — AGC↔LM I/O bridge for PDI.**
IMU PIPA increments into AGC, throttle command out of AGC to DPS, RCS jet channel to attitude, minimal landing-radar model gated behind a documented reconstruction flag.

**Milestone 5 — First vertical slice: PDI → touchdown.**
Scenario loader with validated initial state near PDI, Mission Director FSM (P63→P64→P66 conceptually), Flight Director guidance in Guided mode, debrief screen, three difficulty modes sharing one simulation.

**Milestone 6 — Education, accessibility, polish.**
Contextual explanations, glossary, Sources & Methodology page, WCAG AA pass, reduced-motion, non-3D telemetry view, restrained audio.

**Milestone 7+ (later phases, not in scope now).**
Comanche055 + CSM ops, rendezvous, TEI, entry, Apollo 11 alarm reconstruction (1201/1202), Saturn V + LVDC as a separate module.

---

## 5. File and module structure (initial)

```text
src/
  routes/
    index.tsx                       // landing + mission select
    sim.tsx                         // main simulator shell
    sources.tsx                     // Sources & Methodology
    about.tsx                       // attribution, licenses
  sim/
    clock/MissionClock.ts
    agc/
      AgcCoreAdapter.ts             // typed facade
      AgcWorker.ts                  // Worker entry
      AgcMessages.ts                // wire types
      AgcChannelRegistry.ts         // documented channel map
      AgcMemoryInspector.ts
      roms.ts                       // Luminary099/Comanche055 pointers
    physics/
      types.ts                      // SI-typed vectors, frames
      integrator.ts                 // RK4 fixed-step
      moon.ts                       // gravity, radius, constants
      collision.ts
    spacecraft/
      LunarModule.ts
      PropulsionSystem.ts
      RcsSystem.ts
      ImuModel.ts
      LandingRadarModel.ts
      ControlElectronics.ts
      SensorNoise.ts
    mission/
      MissionDirector.ts
      ScenarioDefinition.ts
      scenarios/pdi-to-touchdown.ts
      Objectives.ts
      FailureConditions.ts
      Debrief.ts
    replay/Recorder.ts
  ui/
    dsky/{Dsky.tsx, LampMatrix.tsx, KeyPad.tsx, Register.tsx}
    viewport/{FlightViewport.tsx, LmModel.tsx, TerrainPatch.tsx}
    telemetry/{AltitudeTape.tsx, VelocityTape.tsx, FuelGauge.tsx}
    director/{FlightDirectorPanel.tsx, ChecklistPanel.tsx}
    diagnostics/{AgcDiagnostics.tsx, PhysicsDiagnostics.tsx}
  state/
    selectors.ts                    // zustand + selectors, no logic
public/
  agc/yaagc.wasm
  agc/rope/Luminary099.bin
  agc/rope/Comanche055.bin
docs/
  adr/0001-agc-in-worker.md
  adr/0002-fixed-step-clock.md
  adr/0003-gpl-boundary.md
  channels/agc-io-mapping.md
```

---

## 6. Unresolved AGC↔spacecraft I/O mappings (research required)

Each of these must be nailed down with a cited source before the corresponding subsystem stops being labeled "reconstructed":

1. Exact PIPA counter injection cadence and encoding for the LM IMU into Luminary's erasable (`PIPAX/Y/Z`) — currently understood as ~10 ms cadence, needs primary-source confirmation.
2. CDU angle write path for gimbal angle updates driving `CDUX/Y/Z`.
3. Descent Engine throttle command: channel 014 DAC bit layout and mapping to commanded thrust fraction (min ~10%, max ~92% throttleable region + fixed-thrust region).
4. RCS jet select bits on channels 05 and 06 (LM) — full 16-jet mapping and polarity.
5. Landing radar: altitude and velocity words, `RADARUPT` handling, and the "PERMIT LANDING RADAR UPDATES" V57 gating.
6. `MARKRUPT`, `T3RUPT`, `T4RUPT`, `DSRUPT`, `KEYRUPT1/2`, `UPRUPT` cadence and priority — needed for correct executive scheduling.
7. Restart pin (channel 033 bit 15) and hardware alarm channel semantics — needed before we can honestly reconstruct 1201/1202.
8. FDAI drive from AGC autopilot outputs vs. from LM electronics — determines what our 3D attitude indicator is actually showing.

Sources of record: *AGC4 Memo #9*, *Luminary Memo #129*, *Delco Apollo LM G&N Dictionary*, Virtual AGC channel documentation, and Luminary099 source comments themselves.

---

## 7. Acceptance tests — first vertical slice

Automated (Vitest + Playwright):
- `agc.init`: WASM loads, version + rope checksum reported.
- `agc.reset`: post-reset PC and registers match a known-good snapshot.
- `agc.lampTest`: entering V35E lights all lamps/segments driven by channels 010/011/013.
- `agc.verbNoun`: V16 N65 shows MET counting; values change on step.
- `agc.channels`: writing channel 015 keycode produces expected DSKY state change.
- `clock.determinism`: same seed + inputs → byte-identical state hash after N steps.
- `physics.coast`: free-fall energy conservation within tolerance over 60 s.
- `physics.burn`: 1000 N constant thrust on 1000 kg produces expected Δv within 0.1%.
- `lm.propellantDepletion`: mass decreases at ṁ = F/(Isp·g₀); engine cuts at 0.
- `lm.touchdown`: vertical < 3 m/s AND horizontal < 1 m/s AND tilt < 12° → safe; otherwise categorized failure.
- `replay.determinism`: recorded input tape reproduces identical debrief.
- `errors.missingWasm` and `errors.missingRom`: user-visible error, no white screen.
- `a11y.keyboard`: full DSKY operable via keyboard; focus visible.
- `deploy.published`: Playwright hits the published URL, loads WASM, runs lamp test.

Manual gate:
- A player in Guided mode can achieve a safe touchdown; a player in Expert mode using only DSKY can too, given the checklist.

---

## 8. Questions that would materially change the architecture

These change the shape of the code, not just its content — please answer before Milestone 0:

1. **License posture.** Are you willing to ship the full app under GPL, or should the AGC subsystem be an isolated GPL module with its source published separately, and the rest of the app under a permissive license? (Recommendation: isolated GPL module.)
2. **Rope image provenance.** Do you want rope images assembled from `chrislgarry/Apollo-11` sources as part of our build (reproducible, slow, needs the yaYUL toolchain), or checked in as prebuilt binaries with a documented SHA-256 and build log? (Recommendation: prebuilt + documented.)
3. **Emulator source.** Pin `michaelfranzl/webAGC` at a specific commit, or fork it into our repo so we control the WASM build? (Recommendation: fork + pin — upstream is a personal project.)
4. **Deployment isolation.** Are cross-origin isolation headers (COOP/COEP) available on the Lovable published environment? If yes, we get `SharedArrayBuffer` and can consider a tighter worker↔main coupling later; if no, we design strictly around `postMessage` from day one. (Assumed: no.)
5. **Scope of "authentic" for the first slice.** Do you want the descent to use the *real* Luminary P63/P64/P66 guidance driving our physics (harder, requires the I/O bridge in §6 to be correct), or a physically honest simulation with Luminary running alongside driving only the DSKY (easier, still authentic AGC but the guidance loop is reconstructed)? This is the single biggest scope decision.
6. **Audio.** May we ship historical Apollo air-to-ground audio (NASA public domain but large), or start silent + synthetic and add historical audio in a later phase?

---

## What happens after you approve

On approval I will execute Milestone 0 only: WASM+rope loading, DSKY lamp test on real emulator output, published-build verification. I will return with evidence (tests + screenshots) before starting Milestone 1. No UI polish, no scenario code, no physics until the emulator is proven in this project's deployment.
