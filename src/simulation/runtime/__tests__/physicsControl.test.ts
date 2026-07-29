// SPDX-License-Identifier: GPL-3.0-or-later
//
// P5.a — mission-runtime physics-control boundary tests.
//
// The runtime behaviour test proves the wrapper is a thin passthrough to
// the frozen M3.1 kernel. The compile-time negative assertions live inline
// as `@ts-expect-error` lines so tsc/tsgo enforces the "AGC output MUST
// NEVER reach stepLmPhysics()" contract structurally, not just at runtime.

import { describe, expect, it } from "vitest";
import {
  advanceMissionPhysics,
  resolveManualPhysicsControl,
  resolvePhysicsControl,
  resolveScenarioPhysicsControl,
  type ResolvedPhysicsControl,
} from "@/simulation/runtime/physicsControl";
import { stepLmPhysics } from "@/simulation/lm";
import { GOLDEN_INITIAL_STATE } from "@/simulation/lm/__tests__/goldenScenario";
import type { AgcCommandedControl } from "@/simulation/agcio/types";

describe("resolvePhysicsControl", () => {
  it("scenario resolver clamps throttle to [0,1]", () => {
    expect(resolveScenarioPhysicsControl({ throttle: 1.5, engineEnabled: true }).throttle).toBe(1);
    expect(resolveScenarioPhysicsControl({ throttle: -0.5, engineEnabled: false }).throttle).toBe(0);
    expect(resolveScenarioPhysicsControl({ throttle: NaN, engineEnabled: false }).throttle).toBe(0);
  });

  it("manual override wins over scenario when both are present", () => {
    const r = resolvePhysicsControl(
      { throttle: 0.3, engineEnabled: false },
      { throttle: 0.7, engineEnabled: true },
    );
    expect(r.throttle).toBe(0.7);
    expect(r.engineEnabled).toBe(true);
    expect(r.source).toBe("manual");
  });

  it("scenario source is tagged when no manual override is supplied", () => {
    const r = resolvePhysicsControl({ throttle: 0.4, engineEnabled: true }, null);
    expect(r.source).toBe("scenario");
  });
});

describe("advanceMissionPhysics", () => {
  it("is bit-identical to a direct stepLmPhysics call for the same control", () => {
    const control = resolveScenarioPhysicsControl({ throttle: 0.6, engineEnabled: true });
    const viaWrapper = advanceMissionPhysics(GOLDEN_INITIAL_STATE, control, 20_000);
    const viaKernel = stepLmPhysics(
      GOLDEN_INITIAL_STATE,
      { throttle: 0.6, engineEnabled: true },
      20_000,
    );
    expect(viaWrapper).toEqual(viaKernel);
  });
});

// -------------------------------------------------------------------------
// COMPILE-TIME NEGATIVE ASSERTIONS
//
// The two @ts-expect-error blocks below prove the structural boundary. If a
// future change makes `AgcCommandedControl` or a hand-forged branded object
// assignable to `ResolvedPhysicsControl`, tsc/tsgo will fail because the
// expected error disappears — which is exactly the failure mode we want.
// -------------------------------------------------------------------------

describe("compile-time structural boundary", () => {
  it("AgcCommandedControl cannot be passed to advanceMissionPhysics", () => {
    const agcCommanded: AgcCommandedControl = {
      engineEnabled: true,
      throttleFraction: 0.8,
      valid: true,
      invalidReasons: [],
      sampledAtMissionTick: 0,
      raw: { thrustCounterEvents: [], channel11: null, channel14: null },
    };

    // @ts-expect-error P5 CONTRACT: AgcCommandedControl (Luminary output decode)
    // MUST NOT be assignable to ResolvedPhysicsControl. If this line stops
    // erroring, the structural boundary has regressed.
    advanceMissionPhysics(GOLDEN_INITIAL_STATE, agcCommanded, 20_000);

    // Runtime assertion so this it() has a passing expectation.
    expect(agcCommanded.valid).toBe(true);
  });

  it("a hand-forged object cannot masquerade as ResolvedPhysicsControl", () => {
    // The brand symbol is module-private; naming it externally is impossible.
    // Even a plain object with the same shape is rejected.
    const forged = { throttle: 0.5, engineEnabled: true, source: "scenario" as const };

    // @ts-expect-error P5 CONTRACT: only resolveScenario/ManualPhysicsControl
    // can mint a ResolvedPhysicsControl. Plain objects lack the private brand.
    const _bad: ResolvedPhysicsControl = forged;

    expect(forged.throttle).toBe(0.5);
  });
});
