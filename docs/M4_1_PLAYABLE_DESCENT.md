<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# M4.1 — Playable Descent

## Status

**M4.1 — PLAYABLE DESCENT: FROZEN**

Frozen after full Vitest, typecheck, production build, and the complete
Wrangler-served Playwright suite passed against the production Cloudflare
Workers bundle. Exact results are in *Tests and acceptance*.

## Player experience

```text
/play
  -> mission selection (5 missions)
  -> control-mode selection (quick-manual | agc-assisted | training)
  -> assistance selection (instructor | pilot | commander)
  -> cockpit (out-the-window scene, instruments, live DSKY, controls)
  -> DSKY procedure on the real Luminary 099 keypad   [AGC-assisted / training]
  -> flight lock released -> guided P63/P64-style descent
  -> P66-style takeover (procedure completion or explicit manual takeover)
  -> manual terminal descent (throttle, attitude, ROD)
  -> touchdown or crash evaluated against the assistance gear limits
  -> score + debrief
```

The mission can be paused, time-scaled, restarted, or abandoned back to the
mission list at any point. Restart returns flight state, mission clock, and
procedure state to their initial values.

## Mission modes

Scenario IDs and labels are taken verbatim from `src/game/play/missions.ts`.

| Mission ID | Title | Subtitle | Default mode |
| --- | --- | --- | --- |
| `landing-fundamentals` | Landing Fundamentals | 120 m · generous propellant | `quick-manual` |
| `terminal-descent` | Terminal Descent | ~500 ft · low-gate region | `quick-manual` |
| `high-gate-challenge` | High-Gate Challenge | ~7,600 ft · approach phase | `agc-assisted` |
| `apollo11-powered-descent` | Apollo 11 Powered-Descent Challenge | ~8.5 nmi · powered-descent initiation | `agc-assisted` |
| `free-flight` | Free Flight | Sandbox | `quick-manual` |

Control modes (`ControlModeId`), available on every mission:

- `quick-manual` — no DSKY procedure; the player has the vehicle immediately.
- `agc-assisted` — the full DSKY procedure gates flight and manual control.
- `training` — the same procedure with instructor cueing.

Assistance levels (`AssistanceLevel`) set the touchdown gear limits in
`LANDING_LIMITS`: `instructor` (most forgiving) → `pilot` → `commander`
(tightest vertical speed, horizontal speed, tilt, and landing-zone radius).

## DSKY procedure

The cockpit DSKY is the same `src/ui/dsky/Dsky.tsx` component used by `/learn`
and `/explore`, bound to the single persistent `AgcSession` worker. Keypresses
are delivered to Luminary 099 through the authentic Channel 015 key path; the
game observes those keystrokes via an `onKeyPress` observer and feeds them to
the pure procedure reducer in `src/game/play/procedureEngine.ts`.

Behaviour:

- Steps advance only on the exact expected keystroke sequence.
- A wrong key latches `entryError`, increments `incorrectEntries`, and refuses
  further keys until `CLR` re-arms the step. It never auto-corrects.
- Before the ignition step, flight is locked (`flight-lock` overlay); guidance,
  not the player, holds control authority.
- `PRO` at the ignition step releases the flight lock.
- `V37E 66E` completes the script and unlocks manual control.
- `Take manual control now` is always available and immediately grants control,
  recording an (optionally early) takeover for scoring.

Tested sequence (Apollo 11 powered-descent script, 5 steps):

```text
V37 E 6 3 E     -> P63 select            AUTHENTIC AGC INPUT
V16 N62 E       -> PDI monitor           AUTHENTIC AGC INPUT
PRO             -> ignition / lock release   HISTORICALLY GROUNDED PROCEDURE BRIDGE
V06 N64 E       -> landing-point display AUTHENTIC AGC INPUT
V37 E 6 6 E     -> P66 takeover          HISTORICALLY GROUNDED PROCEDURE BRIDGE
```

Fidelity of each part:

- **AUTHENTIC AGC INPUT** — every keystroke goes to the real Luminary 099 rope
  running in the emulator, through the real key channel.
- **HISTORICALLY GROUNDED PROCEDURE BRIDGE** — steps flagged `bridged` in the
  script. The rope runs authentically but is not flying the vehicle, so the
  display state the crew would have seen cannot be produced by the rope. These
  steps are labelled in the UI with a `bridged` badge and an explanation.
- **GAME REFERENCE GUIDANCE** — the descent guidance cues and the pre-takeover
  trajectory come from the M4.0 reference guidance function, not from the AGC.

Luminary 099 is **not** flying the browser vehicle.

## Descent guidance and control

- Pre-takeover flight is flown by the M4.0 advisory reference guidance
  (`src/simulation/lunar2d/guidance.ts`), presented as a P63/P64-style phase
  progression for teaching purposes.
- Takeover produces a P66-style semi-manual mode with a rate-of-descent servo:
  the player commands sink rate in discrete increments; attitude and throttle
  are otherwise hand-flown.
- Instructor cues surface target pitch/throttle and the current gate.
- Early takeover (high altitude / high rates) and low propellant margin are
  recorded and reported in the debrief notes.
- Inputs implemented: keyboard, pointer/touch on-screen controls, and gamepad
  axes/buttons.
- Controls are inert until the procedure releases them or the player takes
  manual control explicitly.
- After takeover, attitude response is a simplified first-order RCS model.

**AGC OUTPUT DOES NOT CONTROL PHYSICS.** No AGC channel, counter, or display
value is read by the flight model, and the flight model never writes to the AGC.

## Physics

The flight model is the M4.0 deterministic planar lunar kernel
(`src/simulation/lunar2d/`): Moon-centred inverse-square gravity, variable mass,
DPS/APS engine models, simplified RCS attitude response, surface contact, and
orbit-derived values. Constants and their provenance are documented in
[`docs/M4_0_LUNAR_FLIGHT_KERNEL.md`](./M4_0_LUNAR_FLIGHT_KERNEL.md).

- Fixed 10 ms substeps, driven from a 20 ms game loop; integration is
  semi-implicit Euler and bit-reproducible.
- Propellant burn follows the engine mass-flow model; vehicle mass tracks it.
- Landing evaluation compares vertical speed, horizontal speed, tilt, and
  landing-zone error against `LANDING_LIMITS[assistance]`.
- Restart re-seeds from the mission's initial state, so a replayed input stream
  yields an identical trajectory (FNV-1a state checksums in the kernel tests).
- Mission initial conditions use historical landmark altitudes where they exist
  (high gate 2,316 m, low gate 152 m, PDI 15,742 m); propellant loads and
  sandbox values are gameplay tuned.

## Instruments and cockpit

`src/ui/play/`:

- `LunarScene.tsx` — out-the-window view with horizon, landing zone, and terrain
  features (craters, boulder fields) from the mission definition.
- `FlightInstruments.tsx` — Altitude, Sink rate, Lateral velocity, Attitude,
  Range to LZ, Vehicle mass, Descent propellant, and a Throttle bar.
- `FlightControls.tsx` — throttle, attitude, ROD, and takeover controls.
- `ProcedurePanel.tsx` — current step, keystroke prompt, progress, bridge badge,
  citation, hint, and manual takeover.
- `DebriefPanel.tsx` — outcome, grade, component breakdown, and notes.
- Header strip — MET, Run/Pause, time scale, restart, back to missions.

Compact DSKY layout change: in `compact` mode the DSKY registers are **stacked
vertically** rather than laid out side-by-side, so the cockpit's narrow column
does not horizontally compress the seven-segment registers. Playwright asserts
the rendered register block stays readable in the cockpit.

## Scoring and debrief

`src/game/play/scoring.ts`, deterministic for identical summaries:

| Component | Max | Inputs |
| --- | --- | --- |
| `touchdown` | 40 | vertical speed, horizontal speed, tilt, violations |
| `accuracy` | 20 | landing-zone error vs. the assistance radius |
| `propellant` | 20 | descent propellant remaining vs. initial |
| `procedure` | 15 | steps completed, incorrect entries, hints used, mean response time (Quick Manual receives half credit) |
| `smoothness` | 5 | control roughness |

The debrief reports outcome (`landed` / `crashed`), a letter grade A–F, the
component breakdown, a headline, and notes covering early takeover and low
propellant margin.

## Fidelity policy

Legend used throughout the project:

- **Authentic AGC** — real Luminary 099 executing in the yaAGC WASM core.
- **Source-derived** — values traced to a primary Apollo document.
- **Historically grounded estimate** — reasoned from period sources, not exact.
- **Educational procedure bridge** — a crew-procedure step the rope cannot
  produce in this configuration, presented for teaching and labelled as such.
- **Gameplay tuned** — chosen for playability.

The AGC emulator and every DSKY keystroke are authentic. The complete historical
Apollo 11 powered-descent AGC state is unavailable (see
`docs/M3_3C_PAD_LOAD_AND_ACCEPTANCE.md` and `docs/M3_3D_POWERED_DESCENT_CHECKPOINT.md`),
so P63/P64-style guided flight uses the game reference model and P66-style player
control is an educational approximation. This game does not claim to reproduce
the exact Apollo 11 trajectory.

## Architecture and isolation

- `/play` is the player-facing mission experience; `/sim` remains the AGC/DSKY
  laboratory; `/learn` and `/explore` are unchanged.
- Exactly one persistent AGC Worker, owned by `src/agc/AgcSession.tsx`, shared by
  `/play`, `/learn`, and `/explore`. Navigating `/play` → `/learn` → `/play`
  does not boot a second worker (asserted in Playwright).
- The game procedure engine is a pure reducer, fully separate from emulator
  output; it consumes keystrokes only.
- Reference guidance is separate from player control inputs.
- AGC data cannot mutate any physical control input — the physics firewall is
  asserted in the browser suite (DSKY input while locked leaves altitude and MET
  untouched).
- Frozen M3.3E (HW-I/O v4 hardware-interface lab) is unchanged by M4.1.

## Tests and acceptance

| Gate | Result |
| --- | --- |
| Vitest | 598/598 passed, 0 skipped |
| Typecheck | clean |
| Production build (`bun run build`) | success |
| Playwright (full suite, Wrangler-served production bundle) | 30/30 passed, 0 skipped |
| Browser console errors during `/play` specs | 0 |
| Uncaught browser exceptions | 0 |

The `/play` journey proven by Playwright:

1. `/play` renders mission select with all five missions; briefing and default
   mode reflect the mission definition.
2. Quick Manual grants immediate control, renders the cockpit, and shows no
   flight lock.
3. AGC-assisted starts locked: `flight-lock` visible, control authority reads
   *guidance has control*, and the real DSKY reaches an authentic phase.
4. `V37E 63E` advances the procedure; a wrong key (`9`) does not advance and
   prompts `CLR`; `CLR` recovers; `V16 N62 E` advances.
5. `PRO` releases the flight lock and the descent begins (MET advances,
   altitude decreases).
6. `V06 N64 E` then `V37E 66E` completes the script and hands the vehicle to the
   pilot; player control input changes the trajectory.
7. There is no hidden one-click bypass in AGC-assisted mode — control is
   released only by the procedure or by the explicit takeover button.
8. Restart returns MET, altitude, and procedure progress to their initial values
   and re-arms the flight lock.
9. Navigating `/play` → `/learn` → `/play` keeps `workerBoots` at 1.
10. Keying the DSKY while locked does not change altitude or MET.

Regression gates re-run green: canonical HW-I/O v4 runtime, M3.3E lab, `/sim`,
`/learn`, `/explore` replay/import/export, the M4.0 planar kernel, and the legacy
1D golden touchdown `touchdownTimeUs = 368,279,425`.

Two legacy specs (`tests/canonical-runtime.spec.ts`,
`tests/radar-observer.spec.ts`) still asserted HW-I/O **v3** after the M3.3E v4
freeze; their expectations were corrected to v4 to match the frozen runtime
manifest. No runtime behaviour was changed. The Playwright web server command now
clamps the generated `compatibility_date` to the date supported by the installed
workerd binary; this is test-harness only.

## Known limitations

- No exact historical P63 mission-state reconstruction.
- No direct Luminary closed-loop vehicle control.
- No landing-radar velocity-beam simulation (altitude beam only).
- No full Apollo guidance trajectory reproduction.
- No rendezvous or docking.

## Freeze statement

**M4.1 is frozen.**
