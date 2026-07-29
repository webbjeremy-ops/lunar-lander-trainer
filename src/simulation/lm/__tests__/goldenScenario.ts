// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.1 golden scenario. Not a mission-authentic PDI trajectory; it is a
// deterministic test vector that exercises free fall, throttle-up, propellant
// consumption, and touchdown. The expected numbers are computed by running
// the current kernel and locked here to detect any regression.

import type { TimedLmCommand } from "../types";
import type { LmPhysicsState } from "../types";
import { DEFAULT_LM_PHYSICS_PARAMETERS } from "../parameters";

export const GOLDEN_INITIAL_STATE: LmPhysicsState = {
  simulationTimeUs: 0,
  altitudeM: 2000,
  verticalVelocityMps: -20,
  dryMassKg: DEFAULT_LM_PHYSICS_PARAMETERS.vehicle.dryMassKg.value,
  propellantMassKg: 1000, // small load so the scenario terminates quickly
  throttle: 0,
  engineEnabled: false,
  landed: false,
  crashed: false,
  touchdown: null,
};

export const GOLDEN_COMMANDS: readonly TimedLmCommand[] = [
  // t=0s: free fall for 20s
  // t=20s: engine on at 60% throttle
  { simulationTimeUs: 20_000_000, throttle: 0.6, engineEnabled: true },
  // t=60s: throttle up to 80%
  { simulationTimeUs: 60_000_000, throttle: 0.8, engineEnabled: true },
];

/**
 * These checkpoints are the state at the given simulation times when
 * running the deterministic kernel with DEFAULT_LM_PHYSICS_PARAMETERS.
 * Values are captured to a tolerance suitable for regression, not for
 * mission validation.
 */
export interface GoldenCheckpoint {
  readonly simulationTimeUs: number;
  readonly altitudeM: number;
  readonly verticalVelocityMps: number;
  readonly propellantMassKg: number;
  /** Absolute tolerance for each field, respectively. */
  readonly tol: {
    readonly altitudeM: number;
    readonly verticalVelocityMps: number;
    readonly propellantMassKg: number;
  };
}
