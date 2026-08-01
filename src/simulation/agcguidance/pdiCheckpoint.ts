// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — RECONSTRUCTED PDI INITIALIZATION.
//
//   RECONSTRUCTED PDI INITIALIZATION
//   NOT THE ORIGINAL APOLLO 11 INPUT DECK
//
// This module builds a single, declared, historically grounded checkpoint that
// places the vehicle and the AGC "at PDI" without pretending to be the lost
// 1969 input deck. It is pure data + pure builders:
//
//   * flight state      — planar Moon-centred state from the workbook anchor;
//   * coordinate state  — the frozen fixed-attitude REFSMMAT/CDU pad load;
//   * bookkeeping flags — Average-G, radar availability, engine-ready;
//   * every estimate    — referenced into the assumption registry.
//
// It performs no I/O, touches no AGC, and cannot move the vehicle.

import type { LunarFlightState } from "@/simulation/lunar2d/types";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import { createLunarFlightState } from "@/simulation/lunar2d/physics";
import {
  anchorById,
  feetToMeters,
  getToSeconds,
} from "@/content/apollo11PoweredDescentReference";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1,
  type AgcScenarioPadLoadManifestV1,
} from "@/simulation/agcio/padLoadManifest";
import {
  RECONSTRUCTED_GUIDANCE_LABEL,
  assertAssumptionsDeclared,
} from "./assumptions";

/** AGC-side bookkeeping the reconstructed checkpoint declares. */
export interface ReconstructedAgcBookkeepingV1 {
  /** Average-G integration is treated as active (see `average-g-activation`). */
  readonly averageGActive: boolean;
  /** Major mode the checkpoint represents once the crew keys V37E 63E. */
  readonly intendedMajorMode: 63;
  /** Landing radar is powered and may answer CHAN13 solicitations. */
  readonly landingRadarAvailable: boolean;
  /** DPS armed and at the 10% ignition setting. */
  readonly engineReady: boolean;
  /** Initial throttle the DPS is ignited at, fraction. */
  readonly ignitionThrottleFraction: number;
  /** PIPA pulse period the encoder is driven at, microseconds. */
  readonly pipaSamplePeriodUs: number;
}

export interface ReconstructedPdiCheckpointV1 {
  readonly id: "apollo11-reconstructed-pdi-checkpoint-v1";
  readonly version: 1;
  readonly label: typeof RECONSTRUCTED_GUIDANCE_LABEL;
  readonly classification: "historically-grounded-reconstruction";
  /** Ground elapsed time the checkpoint represents. */
  readonly get: string;
  readonly getSeconds: number;
  /** Planar flight state at the checkpoint. Mission time is zero at PDI. */
  readonly flightState: LunarFlightState;
  readonly bookkeeping: ReconstructedAgcBookkeepingV1;
  /** Erasable bootstrap installed before the first CPU step. */
  readonly padLoad: AgcScenarioPadLoadManifestV1;
  /** Assumption ids this checkpoint depends on. */
  readonly assumptionIds: readonly string[];
  readonly notes: readonly string[];
}

const PDI = anchorById("pdi-p63");

/** Altitude and inertial speed the checkpoint is built from. */
export const PDI_ALTITUDE_M = feetToMeters(PDI.altitudeFt ?? 0);
export const PDI_TOTAL_SPEED_MPS = feetToMeters(PDI.totalVelocityFtPerSec ?? 0);

const CHECKPOINT_ASSUMPTIONS = [
  "pdi-state-vector",
  "pdi-mission-time",
  "refsmmat-and-cdu",
  "erasable-p63-initialisation",
  "average-g-activation",
  "landing-radar-timing",
] as const;

export function buildReconstructedPdiCheckpoint(
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): ReconstructedPdiCheckpointV1 {
  assertAssumptionsDeclared(CHECKPOINT_ASSUMPTIONS);

  // The workbook gives altitude and TOTAL inertial speed only. We declare the
  // radial rate as zero at PDI and put the whole magnitude into the prograde
  // tangential component — that is the `pdi-state-vector` assumption.
  const flightState = createLunarFlightState(
    {
      missionTimeUs: 0,
      altitudeM: PDI_ALTITUDE_M,
      radialSpeedMps: 0,
      tangentialSpeedMps: PDI_TOTAL_SPEED_MPS,
      // Thrust axis roughly retrograde-horizontal for braking: the braking
      // phase holds the engine against the velocity vector.
      attitudeRad: -Math.PI / 2 + 0.1,
      configuration: "complete-lm",
      descentPropellantKg: parameters.mass.descentPropellantKg.value,
    },
    parameters,
  );

  return {
    id: "apollo11-reconstructed-pdi-checkpoint-v1",
    version: 1,
    label: RECONSTRUCTED_GUIDANCE_LABEL,
    classification: "historically-grounded-reconstruction",
    get: PDI.get,
    getSeconds: getToSeconds(PDI.get),
    flightState,
    bookkeeping: {
      averageGActive: true,
      intendedMajorMode: 63,
      landingRadarAvailable: true,
      engineReady: true,
      ignitionThrottleFraction:
        parameters.descentEngine.minThrottleFraction.value,
      pipaSamplePeriodUs: 20_000,
    },
    padLoad: LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1,
    assumptionIds: CHECKPOINT_ASSUMPTIONS,
    notes: [
      RECONSTRUCTED_GUIDANCE_LABEL,
      "Derived from the Apollo 11 powered-descent workbook PDI anchor (secondary reconstruction) and the frozen M3.3C coordinate bootstrap.",
      "Mission time zero means PDI ignition. The AGC clock is not Apollo 11 GET.",
      "Installing this checkpoint never moves the vehicle by itself; it only defines an initial condition.",
    ],
  };
}

export const RECONSTRUCTED_PDI_CHECKPOINT_V1 = buildReconstructedPdiCheckpoint();

export interface CheckpointValidationError {
  readonly kind: string;
  readonly detail: string;
}

/** Pure sanity gate: the checkpoint must be a usable, declared initial state. */
export function validateReconstructedPdiCheckpoint(
  checkpoint: ReconstructedPdiCheckpointV1 = RECONSTRUCTED_PDI_CHECKPOINT_V1,
  parameters: Readonly<LunarFlightParameters> = DEFAULT_LUNAR_FLIGHT_PARAMETERS,
): readonly CheckpointValidationError[] {
  const errors: CheckpointValidationError[] = [];
  const s = checkpoint.flightState;

  if (s.missionTimeUs !== 0) {
    errors.push({ kind: "mission-time-not-zero", detail: String(s.missionTimeUs) });
  }
  if (s.terminalState !== null) {
    errors.push({ kind: "terminal-state-set", detail: String(s.terminalState) });
  }
  const r = Math.hypot(s.positionM[0], s.positionM[1]);
  const altitude = r - parameters.environment.meanRadiusM.value;
  if (Math.abs(altitude - PDI_ALTITUDE_M) > 1) {
    errors.push({ kind: "altitude-mismatch", detail: `${altitude} != ${PDI_ALTITUDE_M}` });
  }
  const speed = Math.hypot(s.velocityMps[0], s.velocityMps[1]);
  if (Math.abs(speed - PDI_TOTAL_SPEED_MPS) > 1) {
    errors.push({ kind: "speed-mismatch", detail: `${speed} != ${PDI_TOTAL_SPEED_MPS}` });
  }
  if (s.descentPropellantKg <= 0) {
    errors.push({ kind: "no-descent-propellant", detail: String(s.descentPropellantKg) });
  }
  if (checkpoint.padLoad.requiredMajorMode !== 0) {
    errors.push({
      kind: "pad-load-not-p00",
      detail: String(checkpoint.padLoad.requiredMajorMode),
    });
  }
  try {
    assertAssumptionsDeclared(checkpoint.assumptionIds);
  } catch (e) {
    errors.push({ kind: "undeclared-assumption", detail: String(e) });
  }
  if (!checkpoint.notes.includes(RECONSTRUCTED_GUIDANCE_LABEL)) {
    errors.push({ kind: "missing-label", detail: "checkpoint must carry its label" });
  }
  return errors;
}
