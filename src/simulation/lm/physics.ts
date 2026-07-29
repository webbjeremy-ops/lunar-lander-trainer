// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pure deterministic LM vertical-descent physics kernel (M3.1).
//
// Integrator: semi-implicit (symplectic) Euler at a fixed internal substep.
// The public `stepLmPhysics` advances by any `dtUs >= 0`, internally breaking
// it into whole substeps of `parameters.integration.substepUs`. Any fractional
// microseconds are dropped from that call (the caller is responsible for
// carrying fractional time by choosing `dtUs` as a multiple of the substep).
//
// The kernel is:
//   - pure (no I/O, no clocks, no randomness)
//   - non-mutating (inputs are Readonly<>; a fresh state object is returned)
//   - frame-rate independent (integration is on simulation time only)
//   - terminal on touchdown (post-touchdown ticks are no-ops)

import type {
  LmControlInput,
  LmPhysicsState,
  TouchdownResult,
} from "./types";
import type { LmPhysicsParameters } from "./parameters";
import { DEFAULT_LM_PHYSICS_PARAMETERS } from "./parameters";

export function createInitialLmState(
  parameters: LmPhysicsParameters = DEFAULT_LM_PHYSICS_PARAMETERS,
  overrides: Partial<LmPhysicsState> = {},
): LmPhysicsState {
  const base: LmPhysicsState = {
    simulationTimeUs: 0,
    altitudeM: 15_000,
    verticalVelocityMps: 0,
    dryMassKg: parameters.vehicle.dryMassKg.value,
    propellantMassKg: parameters.vehicle.initialPropellantKg.value,
    throttle: 0,
    engineEnabled: false,
    landed: false,
    crashed: false,
    touchdown: null,
  };
  return { ...base, ...overrides };
}

function clampThrottle(t: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function classifyTouchdown(
  speed: number,
  thresholds: LmPhysicsParameters["touchdown"],
): TouchdownResult["classification"] {
  if (speed <= thresholds.safeVerticalSpeedMps) return "safe";
  if (speed <= thresholds.hardVerticalSpeedMps) return "hard";
  return "crash";
}

/**
 * Advance the LM physics state by `dtUs` microseconds under a constant
 * control input. Pure function.
 */
export function stepLmPhysics(
  state: Readonly<LmPhysicsState>,
  input: Readonly<LmControlInput>,
  dtUs: number,
  parameters: Readonly<LmPhysicsParameters> = DEFAULT_LM_PHYSICS_PARAMETERS,
): LmPhysicsState {
  if (!Number.isFinite(dtUs) || dtUs < 0) {
    throw new RangeError(`stepLmPhysics: dtUs must be a finite non-negative number, got ${dtUs}`);
  }

  // Terminal: no advancement, but record the latched control command so the
  // UI can still reflect the last commanded throttle.
  if (state.landed) {
    if (dtUs === 0 && input.throttle === state.throttle && input.engineEnabled === state.engineEnabled) {
      return state;
    }
    return {
      ...state,
      simulationTimeUs: state.simulationTimeUs + Math.trunc(dtUs),
      throttle: clampThrottle(input.throttle),
      engineEnabled: input.engineEnabled,
    };
  }

  const substepUs = parameters.integration.substepUs;
  const substeps = Math.trunc(dtUs / substepUs);
  if (substeps === 0) {
    // Zero-length step still latches control input, but no dynamics.
    const clampedThrottle = clampThrottle(input.throttle);
    if (
      clampedThrottle === state.throttle &&
      input.engineEnabled === state.engineEnabled &&
      dtUs === 0
    ) {
      return state;
    }
    return {
      ...state,
      simulationTimeUs: state.simulationTimeUs + Math.trunc(dtUs),
      throttle: clampedThrottle,
      engineEnabled: input.engineEnabled,
    };
  }

  const dtS = substepUs / 1_000_000;
  const g = parameters.vehicle.lunarGravityMps2.value;
  const maxThrust = parameters.vehicle.maxThrustN.value;
  const isp = parameters.vehicle.specificImpulseS.value;
  const g0 = parameters.integration.standardGravityMps2;

  let altitude = state.altitudeM;
  let velocity = state.verticalVelocityMps;
  let propellant = state.propellantMassKg;
  const dryMass = state.dryMassKg;

  const throttle = clampThrottle(input.throttle);
  const engineEnabled = input.engineEnabled;

  let timeUs = state.simulationTimeUs;
  let landed = false;
  let touchdown: TouchdownResult | null = null;

  for (let i = 0; i < substeps; i++) {
    // Effective thrust (N) this substep: gated by fuel availability.
    const wantThrust = engineEnabled && propellant > 0 ? throttle * maxThrust : 0;
    const totalMass = dryMass + propellant;

    // Mass flow (kg/s) implied by wanted thrust.
    const mDot = wantThrust > 0 ? wantThrust / (isp * g0) : 0;
    let dm = mDot * dtS;
    let thrust = wantThrust;
    if (dm > propellant) {
      // Only burn what's left; scale thrust down accordingly.
      const scale = propellant / dm;
      dm = propellant;
      thrust = wantThrust * scale;
    }

    // Acceleration uses current total mass (before this substep's mass change).
    const accel = thrust / totalMass - g;

    // Semi-implicit Euler.
    const newVelocity = velocity + accel * dtS;
    const newAltitude = altitude + newVelocity * dtS;

    propellant -= dm;
    if (propellant < 0) propellant = 0;

    timeUs += substepUs;

    if (newAltitude <= 0) {
      // Interpolate touchdown within the substep so we don't fall through
      // the surface. Use current-substep constant acceleration.
      // Solve altitude(t') = altitude + velocity*t' + 0.5*accel*t'^2 = 0.
      const a = 0.5 * accel;
      const b = velocity;
      const c = altitude;
      let tPrime: number;
      if (Math.abs(a) < 1e-9) {
        tPrime = b !== 0 ? -c / b : dtS;
      } else {
        const disc = b * b - 4 * a * c;
        const sq = disc >= 0 ? Math.sqrt(disc) : 0;
        const r1 = (-b + sq) / (2 * a);
        const r2 = (-b - sq) / (2 * a);
        // Pick smallest non-negative root within [0, dtS].
        const candidates = [r1, r2].filter((r) => r >= 0 && r <= dtS + 1e-9);
        tPrime = candidates.length > 0 ? Math.min(...candidates) : dtS;
      }
      const vAtTouch = velocity + accel * tPrime;
      const speed = Math.abs(vAtTouch);
      const classification = classifyTouchdown(speed, parameters.touchdown);
      // Roll back time to the exact touchdown moment within this substep.
      const microsIntoSubstep = Math.round((tPrime / dtS) * substepUs);
      const touchdownTimeUs = timeUs - substepUs + microsIntoSubstep;
      touchdown = {
        classification,
        touchdownTimeUs,
        verticalVelocityMps: vAtTouch,
        remainingPropellantKg: propellant,
      };
      altitude = 0;
      velocity = 0;
      landed = true;
      timeUs = touchdownTimeUs;
      break;
    }

    altitude = newAltitude;
    velocity = newVelocity;
  }

  const next: LmPhysicsState = {
    simulationTimeUs: timeUs,
    altitudeM: altitude,
    verticalVelocityMps: velocity,
    dryMassKg: dryMass,
    propellantMassKg: propellant,
    throttle,
    engineEnabled,
    landed,
    crashed: landed && touchdown?.classification === "crash",
    touchdown,
  };
  return next;
}
