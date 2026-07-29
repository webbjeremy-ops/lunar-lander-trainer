// SPDX-License-Identifier: GPL-3.0-or-later
//
// LM descent physics parameters for M3.1.
//
// Historically sourced constants carry provenance. Any value flagged
// `provisional: true` is a temporary development default and MUST NOT be
// presented to players as historically authoritative.
//
// Sign convention (kernel-wide):
//   - altitude increases UPWARD (m, >= 0 at surface)
//   - vertical velocity POSITIVE = upward (m/s)
//   - lunar gravity acceleration acts DOWNWARD
//   - engine thrust acts UPWARD
//   - propellant mass flow is POSITIVE (kg consumed per second)

export interface SourcedParameter {
  readonly value: number;
  readonly unit: string;
  readonly sourceTitle: string;
  readonly sourceReference: string;
  readonly notes?: string;
  /** True when the value is a development placeholder, not a cited datum. */
  readonly provisional?: boolean;
}

export interface LmVehicleParameters {
  /** Lunar surface gravitational acceleration magnitude. */
  readonly lunarGravityMps2: SourcedParameter;
  /** Descent engine (DPS) maximum thrust at 100% throttle. */
  readonly maxThrustN: SourcedParameter;
  /**
   * Descent engine specific impulse (vacuum). Mass flow = F / (Isp * g0),
   * where g0 is standard gravity (9.80665 m/s^2).
   */
  readonly specificImpulseS: SourcedParameter;
  /** LM dry mass at PDI (descent stage + ascent stage + crew, minus propellant). */
  readonly dryMassKg: SourcedParameter;
  /** Usable descent propellant loaded at PDI. */
  readonly initialPropellantKg: SourcedParameter;
  /**
   * Minimum commandable throttle for the DPS below FTP. The real DPS
   * throttled between ~10% and ~60% continuously, and ran at 100% (FTP)
   * above ~65%. For M3.1 the kernel clamps to [0, 1] linearly and leaves
   * the throttle-band shaping to a later milestone.
   */
  readonly minThrottleFraction: SourcedParameter;
}

export interface LmTouchdownThresholds {
  /** |v_z| at or below this magnitude counts as a safe landing (m/s). */
  readonly safeVerticalSpeedMps: number;
  /** |v_z| at or below this magnitude is hard but survivable (m/s). */
  readonly hardVerticalSpeedMps: number;
  /** Above `hardVerticalSpeedMps` classifies as crash. */
}

export interface LmIntegrationSettings {
  /**
   * Internal fixed physics substep, in microseconds. A public tick of
   * arbitrary length is broken into whole substeps of this size, with any
   * fractional remainder carried into the next call by the caller.
   */
  readonly substepUs: number;
  /** Standard gravity used in Isp -> mass-flow conversion. */
  readonly standardGravityMps2: number;
}

export interface LmPhysicsParameters {
  readonly vehicle: LmVehicleParameters;
  readonly touchdown: LmTouchdownThresholds;
  readonly integration: LmIntegrationSettings;
}

// -----------------------------------------------------------------------------
// Default vehicle parameters
// -----------------------------------------------------------------------------

const NASA_SP_4029 = "NASA SP-4029, Apollo by the Numbers (Orloff, 2000)";
const NASA_LM_HANDBOOK =
  "Lunar Module LM 10 through LM 14 Vehicle Familiarization Manual (Grumman, 1969)";

export const DEFAULT_LM_VEHICLE_PARAMETERS: LmVehicleParameters = {
  lunarGravityMps2: {
    value: 1.62,
    unit: "m/s^2",
    sourceTitle: "Standard lunar surface gravity",
    sourceReference: "NASA fact sheet, moon surface gravity",
    notes:
      "Surface value; kernel treats gravity as constant over the descent altitude band.",
  },
  maxThrustN: {
    value: 45040,
    unit: "N",
    sourceTitle: "Descent Propulsion System (DPS) rated thrust (FTP)",
    sourceReference: NASA_LM_HANDBOOK,
    notes:
      "Fixed Throttle Position (~92.5% of full rated). Kernel uses this as thrust at throttle=1.",
  },
  specificImpulseS: {
    value: 311,
    unit: "s",
    sourceTitle: "DPS vacuum specific impulse",
    sourceReference: NASA_LM_HANDBOOK,
  },
  dryMassKg: {
    value: 7365,
    unit: "kg",
    sourceTitle: "Apollo 11 LM inert + ascent-propellant + crew mass at PDI",
    sourceReference: NASA_SP_4029,
    notes:
      "Placeholder rounded figure pending exact PDI breakdown; refine in M3.3.",
    provisional: true,
  },
  initialPropellantKg: {
    value: 8200,
    unit: "kg",
    sourceTitle: "Descent stage usable propellant at PDI (Apollo 11)",
    sourceReference: NASA_SP_4029,
    provisional: true,
  },
  minThrottleFraction: {
    value: 0,
    unit: "fraction",
    sourceTitle: "Kernel-level throttle floor",
    sourceReference: "M3.1 design decision",
    notes:
      "M3.1 accepts any throttle in [0,1]. Real DPS throttle-band behavior is deferred.",
    provisional: true,
  },
};

export const DEFAULT_TOUCHDOWN_THRESHOLDS: LmTouchdownThresholds = {
  // Gameplay thresholds — deliberately separate from historical vehicle data.
  safeVerticalSpeedMps: 3.0,
  hardVerticalSpeedMps: 6.0,
};

export const DEFAULT_INTEGRATION_SETTINGS: LmIntegrationSettings = {
  substepUs: 10_000, // 10 ms fixed substep
  standardGravityMps2: 9.80665,
};

export const DEFAULT_LM_PHYSICS_PARAMETERS: LmPhysicsParameters = {
  vehicle: DEFAULT_LM_VEHICLE_PARAMETERS,
  touchdown: DEFAULT_TOUCHDOWN_THRESHOLDS,
  integration: DEFAULT_INTEGRATION_SETTINGS,
};
