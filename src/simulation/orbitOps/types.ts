// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Public types for the lunar orbital-operations layer.
//
// PHYSICS FIREWALL: nothing in this directory reads AGC state, and nothing
// here is ever applied to the AGC. The authoritative vehicle propagator is the
// frozen M4.0 planar kernel (`src/simulation/lunar2d`); this layer only adds
// derivation, planning, objectives, scoring and traces on top of it.

import type { LunarFlightState } from "@/simulation/lunar2d/types";

/** The project's five accuracy classifications. */
export type OrbitAccuracyClass =
  | "authentic-agc"
  | "source-derived"
  | "historically-grounded"
  | "educational-approximation"
  | "gameplay-tuned";

export interface OrbitSourcedValue {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly classification: OrbitAccuracyClass;
  readonly sourceId: string | null;
  readonly rationale: string;
}

// -----------------------------------------------------------------------------
// Orbital elements
// -----------------------------------------------------------------------------

export type OrbitShape =
  | "circular"
  | "elliptical"
  | "suborbital"
  | "escape"
  | "degenerate";

export interface OrbitalElements {
  readonly radiusM: number;
  readonly altitudeM: number;
  readonly speedMps: number;
  /** Positive = climbing. */
  readonly radialSpeedMps: number;
  /** Positive = prograde (increasing central angle). */
  readonly tangentialSpeedMps: number;
  readonly specificEnergyJPerKg: number;
  /** Planar specific angular momentum (signed z component), m^2/s. */
  readonly specificAngularMomentumM2S: number;
  readonly eccentricity: number;
  readonly semiMajorAxisM: number | null;
  readonly periapsisRadiusM: number;
  readonly apoapsisRadiusM: number | null;
  readonly periapsisAltitudeM: number;
  readonly apoapsisAltitudeM: number | null;
  readonly orbitalPeriodS: number | null;
  readonly trueAnomalyRad: number;
  readonly argumentOfPeriapsisRad: number;
  /** Angle of the velocity vector above the local horizontal, radians. */
  readonly flightPathAngleRad: number;
  readonly centralAngleRad: number;
  readonly timeToPeriapsisS: number | null;
  readonly timeToApoapsisS: number | null;
  /** True when the conic intersects the reference surface. */
  readonly impactTrajectory: boolean;
  readonly shape: OrbitShape;
  /** False when the inputs were non-finite or physically degenerate. */
  readonly valid: boolean;
}

// -----------------------------------------------------------------------------
// Manoeuvres
// -----------------------------------------------------------------------------

export type BurnDirection =
  | "prograde"
  | "retrograde"
  | "radial-out"
  | "radial-in";

export type PropulsionSourceId =
  | "ascent-propulsion"
  | "rcs-translation"
  | "educational-maneuver-actuator";

export interface ManeuverNode {
  /** Absolute mission microseconds at which ignition is planned. */
  readonly ignitionTimeUs: number;
  readonly direction: BurnDirection;
  /** Planned delta-v magnitude, m/s (always non-negative). */
  readonly deltaVMps: number;
}

export interface ImpulsivePreview {
  /** Label required on every UI surface that shows this preview. */
  readonly label: "IMPULSIVE MANEUVER PREVIEW";
  readonly note: "EDUCATIONAL PLANNING APPROXIMATION";
  readonly before: OrbitalElements;
  readonly after: OrbitalElements;
  readonly periapsisChangeM: number;
  readonly apoapsisChangeM: number | null;
  readonly periodChangeS: number | null;
  /** Predicted phase drift per revolution against the target, radians. */
  readonly phaseChangePerRevRad: number | null;
  readonly estimatedPropellantKg: number;
  readonly estimatedBurnSeconds: number;
  readonly affordable: boolean;
  readonly impactRisk: boolean;
}

export interface FiniteBurnResult {
  readonly state: LunarFlightState;
  readonly achievedDeltaVMps: number;
  readonly propellantUsedKg: number;
  readonly burnSeconds: number;
  readonly completed: boolean;
  readonly ranOutOfPropellant: boolean;
}

// -----------------------------------------------------------------------------
// Relative motion
// -----------------------------------------------------------------------------

export interface RelativeState {
  readonly rangeM: number;
  readonly rangeRateMps: number;
  readonly relativePositionM: readonly [number, number];
  readonly relativeVelocityMps: readonly [number, number];
  readonly lineOfSightAngleRad: number;
  readonly lineOfSightRateRadPerSec: number;
  /** Target central angle minus LM central angle, wrapped to (-pi, pi]. */
  readonly phaseAngleRad: number;
  readonly alongTrackSeparationM: number;
  readonly radialSeparationM: number;
  readonly closestApproachM: number;
  readonly timeToClosestApproachS: number;
}

// -----------------------------------------------------------------------------
// Scenarios
// -----------------------------------------------------------------------------

export type OrbitControlId =
  | "time-acceleration"
  | "pause"
  | "reset"
  | "maneuver-node-time"
  | "prograde-retrograde"
  | "radial"
  | "attitude"
  | "burn-start"
  | "burn-stop"
  | "rcs-translation"
  | "instructor-overlay"
  | "view-toggle";

export interface OrbitVehicleSeed {
  readonly periapsisAltitudeM: number;
  readonly apoapsisAltitudeM: number;
  /** Central angle at scenario start, radians. */
  readonly centralAngleRad: number;
  /** True to start at periapsis, false to start at apoapsis. */
  readonly startAtPeriapsis: boolean;
}

export type OrbitObjectiveId =
  | "read-the-orbit"
  | "raise-periapsis"
  | "circularize"
  | "phase-for-intercept"
  | "free-practice";

export interface OrbitObjective {
  readonly id: OrbitObjectiveId;
  readonly title: string;
  readonly detail: string;
}

export interface OrbitSuccessCondition {
  readonly id: string;
  readonly description: string;
  readonly kind:
    | "periapsis-above"
    | "circular-within"
    | "apoapsis-within"
    | "period-within"
    | "intercept-setup"
    | "manual-review";
  readonly valueM?: number;
  readonly valueS?: number;
}

export interface OrbitFailureCondition {
  readonly id: string;
  readonly description: string;
  readonly kind: "surface-impact" | "propellant-exhausted" | "escape";
}

export interface OrbitScenario {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly subtitle: string;
  readonly summary: string;
  readonly order: number;
  readonly startingState: OrbitVehicleSeed;
  readonly targetVehicleState: OrbitVehicleSeed | null;
  readonly objectives: readonly OrbitObjective[];
  readonly successConditions: readonly OrbitSuccessCondition[];
  readonly failureConditions: readonly OrbitFailureCondition[];
  readonly availableControls: readonly OrbitControlId[];
  readonly fidelityClassification: OrbitAccuracyClass;
  readonly sourceReferences: readonly string[];
  readonly gameplayTuning: readonly string[];
  readonly propulsion: PropulsionSourceId;
  /** Usable propellant for the manoeuvring system, kg. */
  readonly propellantKg: number;
  readonly rcsPropellantKg: number;
  readonly safePeriapsisAltitudeM: number;
  /** Sandboxes never latch a terminal result. */
  readonly sandbox: boolean;
  readonly historicalNote: string;
}
