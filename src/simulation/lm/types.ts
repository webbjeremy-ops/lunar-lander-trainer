// SPDX-License-Identifier: GPL-3.0-or-later
// Public types for the deterministic LM vertical-descent kernel (M3.1).

export interface LmPhysicsState {
  /** Simulation time, integer microseconds since scenario start. */
  readonly simulationTimeUs: number;
  /** Altitude above the lunar surface, meters. Never negative. */
  readonly altitudeM: number;
  /** Vertical velocity, m/s. Positive = upward. */
  readonly verticalVelocityMps: number;
  /** Dry mass (structure + payload + non-descent propellant), kg. Constant. */
  readonly dryMassKg: number;
  /** Remaining descent propellant mass, kg. Never negative. */
  readonly propellantMassKg: number;
  /** Last commanded throttle, clamped to [0, 1]. */
  readonly throttle: number;
  /** Last commanded engine enable. */
  readonly engineEnabled: boolean;
  /** True once the vehicle has touched down (terminal). */
  readonly landed: boolean;
  /** True when touchdown classification is "crash" (terminal). */
  readonly crashed: boolean;
  /** Populated once, when landed becomes true. */
  readonly touchdown: TouchdownResult | null;
}

export interface LmControlInput {
  /** Commanded throttle in [0, 1]. Values outside the range are clamped. */
  readonly throttle: number;
  readonly engineEnabled: boolean;
}

export interface TouchdownResult {
  readonly classification: "safe" | "hard" | "crash";
  readonly touchdownTimeUs: number;
  readonly verticalVelocityMps: number;
  readonly remainingPropellantKg: number;
}

export interface TimedLmCommand {
  readonly simulationTimeUs: number;
  readonly throttle?: number;
  readonly engineEnabled?: boolean;
  /**
   * Tie-breaker for commands sharing a timestamp. Lower first; if equal,
   * ordering falls back to the command's index in the source array. This
   * keeps replay deterministic without relying on Array.sort stability.
   */
  readonly order?: number;
}
