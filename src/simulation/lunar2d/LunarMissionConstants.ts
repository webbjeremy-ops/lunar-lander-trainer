// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Typed constant registry for the planar lunar-flight kernel.
//
// Every value carries an explicit provenance classification so the UI and the
// documentation can distinguish cited data from tuned gameplay values.
//
// Classification vocabulary (project-wide, M4.0):
//   "source-derived"                  value taken from, or arithmetically
//                                     derived from, a cited primary source
//   "historically-grounded-estimate"  reconstructed from sources that
//                                     disagree in detail, or aggregated from
//                                     several published breakdowns
//   "gameplay-tuned"                  chosen for playability/teaching; not a
//                                     historical claim

export type ConstantClassification =
  | "source-derived"
  | "historically-grounded-estimate"
  | "gameplay-tuned";

export interface SourcedConstant {
  readonly value: number;
  readonly unit: string;
  readonly classification: ConstantClassification;
  readonly sourceId: string | null;
  readonly rationale: string;
}

export interface SourceRecord {
  readonly id: string;
  readonly title: string;
  readonly reference: string;
}

export const LUNAR2D_SOURCES: readonly SourceRecord[] = [
  {
    id: "NASA-SP-4029",
    title: "Apollo by the Numbers: A Statistical Reference",
    reference: "R. W. Orloff, NASA SP-4029 (2000)",
  },
  {
    id: "APOLLO-11-MISSION-REPORT",
    title: "Apollo 11 Mission Report",
    reference: "NASA MSC-00171 (1969)",
  },
  {
    id: "NASA-TN-D-6846",
    title: "Mission Planning for Lunar Module Descent and Ascent",
    reference: "NASA TN D-6846 (1972)",
  },
  {
    id: "NASA-TN-D-7143",
    title: "Apollo Experience Report — Lunar Module Descent Propulsion System",
    reference: "NASA TN D-7143 (1973)",
  },
  {
    id: "NASA-TN-D-7082",
    title: "Apollo Experience Report — Lunar Module Ascent Propulsion System",
    reference: "NASA TN D-7082 (1972)",
  },
  {
    id: "LM-FAMILIARIZATION-MANUAL",
    title: "Lunar Module Vehicle Familiarization Manual",
    reference: "Grumman Aircraft Engineering Corp. (1969)",
  },
  {
    id: "JPL-DE-LUNAR-GM",
    title: "Lunar gravitational parameter (GL0660B / DE ephemeris family)",
    reference: "NASA/JPL published GM_moon = 4.9028e12 m^3/s^2",
  },
  {
    id: "M4-0-DESIGN",
    title: "AGC Tranquility M4.0 kernel design decision",
    reference: "docs/M4_0_LUNAR_FLIGHT_KERNEL.md",
  },
] as const;

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

export interface LunarEnvironmentConstants {
  readonly gravitationalParameterM3S2: SourcedConstant;
  readonly meanRadiusM: SourcedConstant;
  readonly standardGravityMps2: SourcedConstant;
}

export const LUNAR_ENVIRONMENT: LunarEnvironmentConstants = {
  gravitationalParameterM3S2: {
    value: 4.9028e12,
    unit: "m^3/s^2",
    classification: "source-derived",
    sourceId: "JPL-DE-LUNAR-GM",
    rationale:
      "Standard published lunar GM. Used directly for inverse-square gravity; " +
      "gives 1.6229 m/s^2 at the mean radius, consistent with the 1.62 m/s^2 " +
      "surface value used by the frozen 1D kernel.",
  },
  meanRadiusM: {
    value: 1_737_400,
    unit: "m",
    classification: "source-derived",
    sourceId: "JPL-DE-LUNAR-GM",
    rationale:
      "IAU/NASA mean lunar radius. Serves as the nominal terrain radius; " +
      "scenario terrain is expressed as a deviation from this datum.",
  },
  standardGravityMps2: {
    value: 9.80665,
    unit: "m/s^2",
    classification: "source-derived",
    sourceId: "M4-0-DESIGN",
    rationale: "Standard gravity used only to convert Isp into mass flow.",
  },
};

// -----------------------------------------------------------------------------
// Propulsion
// -----------------------------------------------------------------------------

export interface DescentEngineConstants {
  readonly maxThrustN: SourcedConstant;
  readonly specificImpulseS: SourcedConstant;
  readonly minThrottleFraction: SourcedConstant;
  readonly maxContinuousThrottleFraction: SourcedConstant;
  readonly fixedThrottlePositionFraction: SourcedConstant;
  readonly ftpEngageThresholdFraction: SourcedConstant;
}

export const DESCENT_ENGINE: DescentEngineConstants = {
  maxThrustN: {
    value: 45_040,
    unit: "N",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7143",
    rationale:
      "DPS thrust at the Fixed Throttle Position (~10,125 lbf). Kernel treats " +
      "this as thrust at throttle = 1.0.",
  },
  specificImpulseS: {
    value: 311,
    unit: "s",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7143",
    rationale: "DPS vacuum specific impulse; matches the frozen 1D kernel.",
  },
  minThrottleFraction: {
    value: 0.1,
    unit: "fraction",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7143",
    rationale:
      "Lower end of the DPS continuous throttle band (~10% of FTP thrust).",
  },
  maxContinuousThrottleFraction: {
    value: 0.65,
    unit: "fraction",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7143",
    rationale:
      "Upper end of the continuous throttle band. Between this and FTP the " +
      "real engine was not operated continuously (erosion region).",
  },
  fixedThrottlePositionFraction: {
    value: 1.0,
    unit: "fraction",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7143",
    rationale: "FTP is the only commandable setting above the continuous band.",
  },
  ftpEngageThresholdFraction: {
    value: 0.94,
    unit: "fraction",
    classification: "gameplay-tuned",
    rationale:
      "Commanded throttle at or above this snaps to FTP; below it snaps down " +
      "to the continuous-band ceiling. A playable stand-in for the real " +
      "throttle-actuator logic, not a historical claim.",
    sourceId: null,
  },
};

export interface AscentEngineConstants {
  readonly thrustN: SourcedConstant;
  readonly specificImpulseS: SourcedConstant;
}

export const ASCENT_ENGINE: AscentEngineConstants = {
  thrustN: {
    value: 15_569,
    unit: "N",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7082",
    rationale:
      "APS rated thrust (3,500 lbf). The APS was not throttleable: commanded " +
      "throttle is ignored and the engine burns at rated thrust.",
  },
  specificImpulseS: {
    value: 311,
    unit: "s",
    classification: "source-derived",
    sourceId: "NASA-TN-D-7082",
    rationale: "APS vacuum specific impulse.",
  },
};

// -----------------------------------------------------------------------------
// Mass properties (Apollo 11 / LM-5 at powered descent initiation)
// -----------------------------------------------------------------------------

export interface LmMassConstants {
  readonly descentStageDryMassKg: SourcedConstant;
  readonly ascentStageDryMassKg: SourcedConstant;
  readonly descentPropellantKg: SourcedConstant;
  readonly ascentPropellantKg: SourcedConstant;
  readonly rcsPropellantKg: SourcedConstant;
}

export const LM_MASS: LmMassConstants = {
  descentStageDryMassKg: {
    value: 2_034,
    unit: "kg",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-SP-4029",
    rationale:
      "Descent stage inert mass excluding usable propellant. Published " +
      "breakdowns differ by a few tens of kg depending on residuals " +
      "accounting; this figure closes the LM-5 PDI total of ~15,103 kg.",
  },
  ascentStageDryMassKg: {
    value: 2_229,
    unit: "kg",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-SP-4029",
    rationale:
      "Ascent stage inert mass including crew, suits and consumables, " +
      "excluding usable APS and RCS propellant.",
  },
  descentPropellantKg: {
    value: 8_200,
    unit: "kg",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-SP-4029",
    rationale:
      "Usable DPS propellant at PDI. Matches the frozen 1D kernel so the two " +
      "models stay comparable.",
  },
  ascentPropellantKg: {
    value: 2_353,
    unit: "kg",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-SP-4029",
    rationale: "Usable APS propellant loaded for lunar liftoff.",
  },
  rcsPropellantKg: {
    value: 287,
    unit: "kg",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-SP-4029",
    rationale:
      "Total RCS propellant. In this kernel RCS is consumed only by the " +
      "attitude-control model.",
  },
};

// -----------------------------------------------------------------------------
// Attitude control (simplified, bounded)
// -----------------------------------------------------------------------------

export interface AttitudeControlConstants {
  readonly maxAngularAccelRadPerSec2: SourcedConstant;
  readonly maxAngularRateRadPerSec: SourcedConstant;
  readonly rcsMassFlowKgPerSec: SourcedConstant;
  readonly rateDeadbandRadPerSec: SourcedConstant;
}

export const ATTITUDE_CONTROL: AttitudeControlConstants = {
  maxAngularAccelRadPerSec2: {
    value: 0.6,
    unit: "rad/s^2",
    classification: "gameplay-tuned",
    sourceId: null,
    rationale:
      "Single-axis stand-in for the 16-thruster RCS. M4.10 raised this so a " +
      "pilot input bites within about a tenth of a second and a released " +
      "control nulls the rate promptly, matching the feel of the digital " +
      "autopilot without modelling jet geometry or inertia tensors.",
  },
  maxAngularRateRadPerSec: {
    value: 0.35,
    unit: "rad/s",
    classification: "gameplay-tuned",
    sourceId: null,
    rationale: "Hard rate limit (~20 deg/s) so attitude cannot run away.",
  },

  rcsMassFlowKgPerSec: {
    value: 0.4,
    unit: "kg/s",
    classification: "gameplay-tuned",
    sourceId: null,
    rationale:
      "RCS propellant consumed at full attitude command; scales linearly " +
      "with |command|. Makes RCS budget a real constraint without claiming " +
      "per-jet fidelity.",
  },
  rateDeadbandRadPerSec: {
    value: 2e-3,
    unit: "rad/s",
    classification: "gameplay-tuned",
    sourceId: null,
    rationale:
      "Attitude-hold deadband (~0.1 deg/s). Zero-command rates below this " +
      "collapse to exactly zero, so a released control settles in one or two " +
      "substeps and serialized states stay bit-reproducible.",
  },

};

// -----------------------------------------------------------------------------
// Landing-gear / contact limits
// -----------------------------------------------------------------------------

export interface ContactLimitConstants {
  readonly safeVerticalSpeedMps: SourcedConstant;
  readonly hardVerticalSpeedMps: SourcedConstant;
  readonly safeHorizontalSpeedMps: SourcedConstant;
  readonly hardHorizontalSpeedMps: SourcedConstant;
  readonly safeTiltRad: SourcedConstant;
  readonly hardTiltRad: SourcedConstant;
}

const DEG = Math.PI / 180;

export const CONTACT_LIMITS: ContactLimitConstants = {
  safeVerticalSpeedMps: {
    value: 3.05,
    unit: "m/s",
    classification: "source-derived",
    sourceId: "NASA-TN-D-6846",
    rationale:
      "10 ft/s design touchdown limit for the LM landing gear at nominal " +
      "attitude and horizontal velocity.",
  },
  hardVerticalSpeedMps: {
    value: 4.6,
    unit: "m/s",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-TN-D-6846",
    rationale:
      "Beyond the design limit but within the gear stroke envelope for some " +
      "conditions; classified as a survivable hard landing.",
  },
  safeHorizontalSpeedMps: {
    value: 1.2,
    unit: "m/s",
    classification: "source-derived",
    sourceId: "NASA-TN-D-6846",
    rationale: "4 ft/s lateral touchdown limit (tip-over avoidance).",
  },
  hardHorizontalSpeedMps: {
    value: 2.4,
    unit: "m/s",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-TN-D-6846",
    rationale: "Twice the design lateral limit; hard but not automatic loss.",
  },
  safeTiltRad: {
    value: 6 * DEG,
    unit: "rad",
    classification: "source-derived",
    sourceId: "NASA-TN-D-6846",
    rationale: "6 deg attitude limit at touchdown for the nominal gear model.",
  },
  hardTiltRad: {
    value: 12 * DEG,
    unit: "rad",
    classification: "historically-grounded-estimate",
    sourceId: "NASA-TN-D-6846",
    rationale:
      "Static tip-over threshold is steeper, but combined with touchdown " +
      "dynamics 12 deg is treated as the survivable ceiling.",
  },
};

// -----------------------------------------------------------------------------
// Integration / mission settings
// -----------------------------------------------------------------------------

export interface Lunar2dIntegrationSettings {
  /** Fixed internal physics substep, integer microseconds. */
  readonly substepUs: number;
  /**
   * Periapsis altitude at or above which an engine-off ascent stage is
   * considered to have achieved orbit.
   */
  readonly orbitPeriapsisAltitudeM: number;
}

export const DEFAULT_INTEGRATION: Lunar2dIntegrationSettings = {
  substepUs: 10_000,
  orbitPeriapsisAltitudeM: 15_000,
};

/** Serializable terrain model: mean radius plus an optional sinusoid. */
export interface LunarTerrainModel {
  readonly meanRadiusM: number;
  readonly amplitudeM: number;
  /** Angular wavelength of the terrain sinusoid, radians of central angle. */
  readonly angularWavelengthRad: number;
  readonly phaseRad: number;
}

export const FLAT_TERRAIN: LunarTerrainModel = {
  meanRadiusM: LUNAR_ENVIRONMENT.meanRadiusM.value,
  amplitudeM: 0,
  angularWavelengthRad: 1,
  phaseRad: 0,
};

export interface LunarFlightParameters {
  readonly environment: LunarEnvironmentConstants;
  readonly descentEngine: DescentEngineConstants;
  readonly ascentEngine: AscentEngineConstants;
  readonly mass: LmMassConstants;
  readonly attitude: AttitudeControlConstants;
  readonly contact: ContactLimitConstants;
  readonly integration: Lunar2dIntegrationSettings;
  readonly terrain: LunarTerrainModel;
}

export const DEFAULT_LUNAR_FLIGHT_PARAMETERS: LunarFlightParameters = {
  environment: LUNAR_ENVIRONMENT,
  descentEngine: DESCENT_ENGINE,
  ascentEngine: ASCENT_ENGINE,
  mass: LM_MASS,
  attitude: ATTITUDE_CONTROL,
  contact: CONTACT_LIMITS,
  integration: DEFAULT_INTEGRATION,
  terrain: FLAT_TERRAIN,
};

/** Flat list of every registered constant, for docs and dev UI. */
export function listLunarConstants(): readonly {
  path: string;
  constant: SourcedConstant;
}[] {
  const groups: Record<string, Record<string, SourcedConstant>> = {
    environment: LUNAR_ENVIRONMENT as unknown as Record<string, SourcedConstant>,
    descentEngine: DESCENT_ENGINE as unknown as Record<string, SourcedConstant>,
    ascentEngine: ASCENT_ENGINE as unknown as Record<string, SourcedConstant>,
    mass: LM_MASS as unknown as Record<string, SourcedConstant>,
    attitude: ATTITUDE_CONTROL as unknown as Record<string, SourcedConstant>,
    contact: CONTACT_LIMITS as unknown as Record<string, SourcedConstant>,
  };
  const out: { path: string; constant: SourcedConstant }[] = [];
  for (const groupName of Object.keys(groups)) {
    const group = groups[groupName];
    for (const key of Object.keys(group)) {
      out.push({ path: `${groupName}.${key}`, constant: group[key] });
    }
  }
  return out;
}
