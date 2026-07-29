// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.a — mission-runtime structural boundary for LM physics control.
//
// The frozen M3.1 kernel API (`stepLmPhysics`) is UNCHANGED by this module.
// The boundary lives one layer up: this file exposes a wrapper
// `advanceMissionPhysics` that accepts a nominal, module-private-branded
// `ResolvedPhysicsControl` value. The only way to construct that value is
// via `resolveScenarioPhysicsControl` / `resolveManualPhysicsControl`,
// which are the sole legitimate control sources.
//
// The brand is a `unique symbol` declared privately in this module and
// exposed only through the `ResolvedPhysicsControl` type. External code
// cannot forge the brand, so the compiler rejects any attempt to hand an
// `AgcCommandedControl` (the diagnostic decode of Luminary's output) to
// `advanceMissionPhysics`. This is the P5 "AGC output MUST NEVER reach
// stepLmPhysics()" contract expressed structurally, not merely at runtime.

import {
  DEFAULT_LM_PHYSICS_PARAMETERS,
  stepLmPhysics,
  type LmPhysicsParameters,
  type LmPhysicsState,
} from "@/simulation/lm";

// The brand symbol is *not* exported. Any attempt to add `[physicsControlBrand]:
// true` to an object outside this module fails to typecheck because the
// symbol identity is unreachable.
declare const physicsControlBrand: unique symbol;

/** Physics-control source, tagged so diagnostics can attribute a physics
 *  step to the scenario stream vs. an operator-issued manual override. */
export type PhysicsControlSource = "scenario" | "manual";

/**
 * The ONLY value type `advanceMissionPhysics` accepts. Construction is
 * gated on `resolveScenarioPhysicsControl` / `resolveManualPhysicsControl`.
 * External modules cannot fabricate this value: the brand symbol is
 * module-private.
 */
export interface ResolvedPhysicsControl {
  readonly throttle: number;
  readonly engineEnabled: boolean;
  readonly source: PhysicsControlSource;
  readonly [physicsControlBrand]: true;
}

/** The legitimate scenario-derived control input. Shape mirrors
 *  `LmControlInput` but is deliberately distinct so the resolver retains
 *  the single construction site. */
export interface ScenarioControl {
  readonly throttle: number;
  readonly engineEnabled: boolean;
}

/** Optional operator override (dev harness, /dev/mission-runtime nudges).
 *  `null` = no override active. */
export interface ManualControl {
  readonly throttle: number;
  readonly engineEnabled: boolean;
}

function clampThrottle(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Resolve a scenario-provided control input into a branded, physics-eligible
 *  value. Pure. */
export function resolveScenarioPhysicsControl(
  scenario: ScenarioControl,
): ResolvedPhysicsControl {
  return {
    throttle: clampThrottle(scenario.throttle),
    engineEnabled: scenario.engineEnabled === true,
    source: "scenario",
    [physicsControlBrand]: true,
  };
}

/** Resolve a manual-override control input into a branded, physics-eligible
 *  value. Pure. */
export function resolveManualPhysicsControl(
  manual: ManualControl,
): ResolvedPhysicsControl {
  return {
    throttle: clampThrottle(manual.throttle),
    engineEnabled: manual.engineEnabled === true,
    source: "manual",
    [physicsControlBrand]: true,
  };
}

/** Combine scenario + optional manual override into a single branded value.
 *  Manual, when present, wins — mirroring the P5 spec convention that the
 *  operator has priority over the timed scenario stream. */
export function resolvePhysicsControl(
  scenario: ScenarioControl,
  manual: ManualControl | null,
): ResolvedPhysicsControl {
  return manual === null
    ? resolveScenarioPhysicsControl(scenario)
    : resolveManualPhysicsControl(manual);
}

/**
 * Mission-runtime wrapper for one 20 000 µs physics step. Accepts only the
 * branded `ResolvedPhysicsControl`. `AgcCommandedControl` (Luminary's
 * diagnostic output decode) has NO brand and therefore cannot be passed
 * here — verified by the compile-time negative test in `__tests__/
 * physicsControl.negative.test-d.ts`.
 *
 * This wrapper is deliberately a thin passthrough to `stepLmPhysics` so the
 * frozen M3.1 kernel API remains untouched.
 */
export function advanceMissionPhysics(
  state: LmPhysicsState,
  control: ResolvedPhysicsControl,
  dtUs: number,
  parameters: LmPhysicsParameters = DEFAULT_LM_PHYSICS_PARAMETERS,
): LmPhysicsState {
  return stepLmPhysics(
    state,
    { throttle: control.throttle, engineEnabled: control.engineEnabled },
    dtUs,
    parameters,
  );
}
