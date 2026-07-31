// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.0 — Public types for the deterministic planar lunar-flight kernel.
//
// Frame: Moon-centered, non-rotating, planar (X, Y) inertial frame in meters.
// The Moon's center is the origin. Local vertical at a point is the outward
// radial unit vector; local horizontal is that vector rotated +90 degrees
// (counter-clockwise), i.e. the direction of increasing central angle.
//
// Attitude is the angle of the vehicle body axis (the thrust axis) measured
// from local vertical, positive toward local horizontal. attitudeRad = 0 means
// thrust points straight up, away from the Moon.

export type LunarVehicleConfiguration =
  | "complete-lm"
  | "descent-stage"
  | "ascent-stage";

export type LunarMainEngine = "off" | "descent" | "ascent";

export type LunarTerminalState =
  | null
  | "landed"
  | "hard-landing"
  | "crashed"
  | "orbit-achieved"
  | "propellant-depleted";

export interface LunarTouchdownReport {
  readonly classification: "landed" | "hard-landing" | "crashed";
  readonly missionTimeUs: number;
  readonly verticalSpeedMps: number;
  readonly horizontalSpeedMps: number;
  readonly tiltRad: number;
  readonly violations: readonly ("vertical-speed" | "horizontal-speed" | "tilt")[];
}

export interface LunarFlightState {
  /** Integer microseconds since scenario start. */
  readonly missionTimeUs: number;
  /** Moon-centered inertial position, meters. */
  readonly positionM: readonly [number, number];
  /** Moon-centered inertial velocity, m/s. */
  readonly velocityMps: readonly [number, number];

  /** Body (thrust) axis angle from local vertical, radians. */
  readonly attitudeRad: number;
  /** Attitude rate, rad/s. */
  readonly angularRateRadPerSec: number;

  readonly configuration: LunarVehicleConfiguration;

  /** Inert mass of the current configuration, kg. */
  readonly dryMassKg: number;
  readonly descentPropellantKg: number;
  readonly ascentPropellantKg: number;
  readonly rcsPropellantKg: number;

  readonly mainEngine: LunarMainEngine;
  /** Last effective throttle after engine-specific clamping, [0, 1]. */
  readonly throttle: number;

  readonly terminalState: LunarTerminalState;
  /** Populated once, when a surface-contact terminal state is reached. */
  readonly touchdown: LunarTouchdownReport | null;
  /**
   * The jettisoned descent stage, once staging has occurred. It is inert:
   * if it was on the surface at separation it stays exactly where it was.
   */
  readonly separatedDescentStage: LunarFlightState | null;
}

export interface LunarControlInput {
  /** Commanded throttle in [0, 1]; clamped/snapped per engine. */
  readonly throttle: number;
  readonly engineCommand: LunarMainEngine;
  /** Attitude authority command in [-1, 1], fraction of max angular accel. */
  readonly attitudeCommand: number;
  /** Level-triggered request to jettison the descent stage. */
  readonly stageSeparation?: boolean;
}

export interface TimedLunarCommand {
  readonly missionTimeUs: number;
  readonly throttle?: number;
  readonly engineCommand?: LunarMainEngine;
  readonly attitudeCommand?: number;
  readonly stageSeparation?: boolean;
  /** Tie-breaker for commands sharing a timestamp; lower first. */
  readonly order?: number;
}

/** Derived, never-stored orbital and local-frame values. */
export interface LunarOrbitalValues {
  readonly radiusM: number;
  readonly altitudeM: number;
  readonly speedMps: number;
  /** Along local vertical; positive = climbing. */
  readonly radialSpeedMps: number;
  /** Along local horizontal; positive = prograde (increasing central angle). */
  readonly tangentialSpeedMps: number;
  readonly specificEnergyJPerKg: number;
  readonly semiMajorAxisM: number | null;
  readonly eccentricity: number;
  readonly apoapsisRadiusM: number | null;
  readonly periapsisRadiusM: number;
  readonly apoapsisAltitudeM: number | null;
  readonly periapsisAltitudeM: number;
  /** Central angle of the position vector, radians, atan2(y, x). */
  readonly centralAngleRad: number;
  /** Terrain radius directly beneath the vehicle. */
  readonly terrainRadiusM: number;
}
