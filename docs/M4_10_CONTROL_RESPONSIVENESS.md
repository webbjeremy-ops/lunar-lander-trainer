# M4.10 — Manual control responsiveness and render path

SPDX-License-Identifier: GPL-3.0-or-later

## Problem

Manual descent felt laggy, worst on the horizontal axis, and the descent view
appeared to trail the vehicle.

Two independent causes:

1. **Attitude was a pure double integrator.** An arrow key added angular
   acceleration; releasing it left the vehicle rotating at whatever rate had
   accumulated. The zero-command deadband was `1e-4 rad/s`, effectively never
   reached, so every input had to be hand counter-steered. Horizontal velocity
   is produced by tilt, so it inherited that lag twice.
2. **The scene redrew from a React effect keyed on flight state** and
   reassigned `canvas.width` / `canvas.height` on every draw, reallocating and
   clearing the backing store while competing with the HUD re-render.

## Changes

### Kernel (`src/simulation/lunar2d/physics.ts`)

Rate-command / attitude-hold, matching the intent of the digital autopilot:
a zero attitude command is now an *active* command to null the rate. The
kernel brakes toward zero with bounded RCS authority, without overshooting
inside a substep, and collapses to exactly zero inside the deadband. RCS
propellant is still consumed for braking. The function stays pure, fixed at
20 ms substeps, with an unchanged signature.

### Constants (`LunarMissionConstants.ts`, all `gameplay-tuned`)

| Constant | Before | After |
| --- | --- | --- |
| `maxAngularAccelRadPerSec2` | 0.12 | 0.60 |
| `maxAngularRateRadPerSec` | 0.35 | 0.35 (unchanged) |
| `rateDeadbandRadPerSec` | 1e-4 | 2e-3 |

### Cockpit (`src/ui/play/usePlaySession.ts`)

Arrow keys command a body rate (`0.16 rad/s`, ~9 deg/s) instead of raw
acceleration; the resolver converts rate error to an attitude command with a
proportional gain. Key press applies a one-shot rate kick so the first frame
already moves. When the stick is centred and the rate is settled, an exact
zero command is issued so the kernel deadband keeps states reproducible.

### Scene (`src/ui/play/LunarScene.tsx`)

Props are mirrored into a ref and the canvas paints from
`requestAnimationFrame`. The backing store is only resized when the element
size or DPR actually changes.

## Verification

- 797 Vitest tests pass, including two new attitude-hold tests: the rate nulls
  to exactly zero after release (consuming RCS), and attitude stays fixed
  afterwards. The golden touchdown fixture is unchanged — the autopilot path
  and the AGC path were not touched.
- Playwright, Landing Fundamentals in Quick Manual: a 0.5 s right input builds
  ~2.8 deg of tilt, the vehicle stops rotating within roughly a quarter second
  of release, and attitude then holds. Before this change it kept rotating.
