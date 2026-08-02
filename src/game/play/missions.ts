// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Mission registry for /play.
//
// Landmark altitudes are taken from NASA's Apollo 11 mission summary
// (descent-orbit low point ~8.5 nmi, high gate ~7,600 ft, low gate ~500 ft).
// They are used as scenario landmarks only. NONE of these scenarios claims to
// reproduce the Apollo 11 trajectory; the state vectors are historically
// grounded gameplay estimates.

import type {
  AssistanceLevel,
  LandingLimits,
  MissionDefinition,
  MissionId,
} from "./types";
import { LUNAR_ENVIRONMENT } from "@/simulation/lunar2d/LunarMissionConstants";
import { COUNTDOWN_LENGTH_US } from "./ignitionSequence";
import {
  createLunarFlightState,
  stepLunarFlight,
  type LunarFlightState,
} from "@/simulation/lunar2d";

const FT = 0.3048;
const NMI = 1852;

/** Historically anchored landmark altitudes, metres. */
export const DESCENT_LANDMARKS = {
  /** ~8.5 nmi descent-orbit low point / powered-descent initiation. */
  poweredDescentInitiationM: Math.round(8.5 * NMI),
  /** ~7,600 ft high gate. */
  highGateM: Math.round(7_600 * FT),
  /** ~500 ft low gate. */
  lowGateM: Math.round(500 * FT),
} as const;

export const MOON_RADIUS_M = LUNAR_ENVIRONMENT.meanRadiusM.value;

/** Landing-gear limits per assistance level. Commander is the tightest. */
export const LANDING_LIMITS: Readonly<Record<AssistanceLevel, LandingLimits>> = {
  instructor: {
    verticalSpeedMps: 4.6,
    horizontalSpeedMps: 2.4,
    tiltRad: (12 * Math.PI) / 180,
    landingZoneRadiusM: 400,
  },
  pilot: {
    verticalSpeedMps: 3.05,
    horizontalSpeedMps: 1.2,
    tiltRad: (6 * Math.PI) / 180,
    landingZoneRadiusM: 250,
  },
  commander: {
    verticalSpeedMps: 2.4,
    horizontalSpeedMps: 0.9,
    tiltRad: (5 * Math.PI) / 180,
    landingZoneRadiusM: 120,
  },
};

export const MISSIONS: Readonly<Record<MissionId, MissionDefinition>> = {
  "landing-fundamentals": {
    id: "landing-fundamentals",
    version: 1,
    order: 1,
    title: "Landing Fundamentals",
    subtitle: "120 m · generous propellant",
    summary:
      "A short hover-and-settle exercise close to the surface with far more " +
      "descent propellant than a real mission carried.",
    objective:
      "Null the small horizontal drift and settle onto the pad inside the " +
      "landing-gear limits.",
    initial: {
      altitudeM: 120,
      radialSpeedMps: -2.5,
      tangentialSpeedMps: 4,
      attitudeRad: 0,
      descentPropellantKg: 1_600,
      rangeToLandingZoneM: 180,
    },
    defaultControlMode: "quick-manual",
    availableControlModes: ["quick-manual", "training", "agc-assisted"],
    defaultAssistance: "instructor",
    hazards: [
      { angleOffsetRad: 0, radiusM: 55, kind: "crater", label: "Shallow crater" },
    ],
    historicalNote:
      "Training scenario. Altitude chosen for teaching, not from the flight record.",
  },

  "full-descent": {
    id: "full-descent",
    version: 2,
    order: 2,
    title: "Full Descent",
    subtitle: "PDI (~8.5 nmi) through touchdown",
    summary:
      "The complete powered descent: the PDI ignition ritual, the braking " +
      "phase on your back, the windows-up roll, the 1201/1202 program " +
      "alarms, pitch-over at high gate, then P66 to the surface.",
    objective:
      "Work the DSKY procedure from P63 through P64, answer the program " +
      "alarms, take P66 at low gate and land inside the gear limits.",
    initial: {
      altitudeM: DESCENT_LANDMARKS.poweredDescentInitiationM,
      radialSpeedMps: -3,
      // Apollo 11 crossed PDI at about 5,570 ft/s inertial, 259 nmi of ground
      // track still to run to the aim point.
      tangentialSpeedMps: 1_698,
      attitudeRad: -1.35,
      descentPropellantKg: 8_200,
      rangeToLandingZoneM: 480_000,
    },
    defaultControlMode: "agc-assisted",
    availableControlModes: ["agc-assisted", "training", "quick-manual"],
    defaultAssistance: "pilot",
    hazards: [
      { angleOffsetRad: 0, radiusM: 60, kind: "boulder-field", label: "West-crater ejecta" },
      { angleOffsetRad: 0, radiusM: 190, kind: "crater", label: "Blocky crater" },
    ],
    historicalNote:
      "The descent-orbit low point was about 8.5 nautical miles and high gate " +
      "about 7,600 ft (NASA mission summary). This is a historically grounded " +
      "gameplay scenario — it is NOT a reproduction of the Apollo 11 trajectory.",
  },

  "free-flight": {
    id: "free-flight",
    version: 1,
    order: 3,
    title: "Free Flight",
    subtitle: "Sandbox",
    summary:
      "Unscored sandbox: full descent propellant, no procedure, no clock " +
      "pressure. Experiment with thrust-to-weight and energy management.",
    objective: "Explore. Any outcome is a valid outcome.",
    initial: {
      altitudeM: 3_000,
      radialSpeedMps: -10,
      tangentialSpeedMps: 60,
      attitudeRad: -0.3,
      descentPropellantKg: 8_200,
      rangeToLandingZoneM: 6_000,
    },
    defaultControlMode: "quick-manual",
    availableControlModes: ["quick-manual", "agc-assisted", "training"],
    defaultAssistance: "instructor",
    hazards: [],
    historicalNote: "Sandbox. No historical claim.",
  },
};

export const MISSION_IDS: readonly MissionId[] = (
  Object.values(MISSIONS) as MissionDefinition[]
)
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((m) => m.id);

export function getMission(id: MissionId): MissionDefinition {
  const m = MISSIONS[id];
  if (!m) throw new Error(`Unknown mission: ${id}`);
  return m;
}

/** Central angle offset that corresponds to a downrange distance. */
export function angleForRange(rangeM: number): number {
  return rangeM / MOON_RADIUS_M;
}

/** Downrange distance from the landing zone (positive = short of the zone). */
export function downrangeToLandingZoneM(
  centralAngleRad: number,
  landingZoneAngleRad: number,
): number {
  return (landingZoneAngleRad - centralAngleRad) * MOON_RADIUS_M;
}

/** The landing zone always sits at central angle 0 in the planar frame. */
export const LANDING_ZONE_ANGLE_RAD = 0;

// --- Pre-ignition insertion (M4.41) -----------------------------------------
//
// Eagle did not hang motionless waiting for TIG: it was already on the descent
// orbit, crossing the PDI point at about 5,570 ft/s (1,698 m/s) with the
// engine cold. The scenario therefore inserts the player UPRANGE of PDI and
// coasts, so the countdown ritual (V99 flashing, ENG ARM, PROCEED, ullage) is
// flown on a live, fast-moving vehicle that arrives at the PDI state exactly
// at TIG.

/**
 * Seconds of engine-off descent-orbit coast before TIG. This is DERIVED from
 * the PDI countdown length: the coast and the countdown are the same clock, so
 * the vehicle reaches the PDI state at exactly T-0 and every downstream cue
 * (roll, alarms, high gate, low gate) keeps its historical timing.
 */
export const PRE_IGNITION_COAST_SEC = COUNTDOWN_LENGTH_US / 1_000_000;

/**
 * Back-propagate a mission's PDI state along an engine-off Keplerian coast.
 * Gravity is time-symmetric, so reversing velocity, integrating forward and
 * reversing again lands exactly on the earlier point of the same orbit.
 */
export function insertionStateForMission(
  mission: MissionDefinition,
  coastSec: number = PRE_IGNITION_COAST_SEC,
): LunarFlightState {
  const pdi = createLunarFlightState({
    altitudeM: mission.initial.altitudeM,
    centralAngleRad:
      LANDING_ZONE_ANGLE_RAD - angleForRange(mission.initial.rangeToLandingZoneM),
    radialSpeedMps: mission.initial.radialSpeedMps,
    tangentialSpeedMps: mission.initial.tangentialSpeedMps,
    attitudeRad: mission.initial.attitudeRad,
    descentPropellantKg: mission.initial.descentPropellantKg,
  });
  if (coastSec <= 0) return pdi;

  const reversed: LunarFlightState = {
    ...pdi,
    velocityMps: [-pdi.velocityMps[0], -pdi.velocityMps[1]],
  };
  const STEP_US = 20_000;
  let s = reversed;
  for (let t = 0; t < coastSec * 1_000_000; t += STEP_US) {
    s = stepLunarFlight(
      s,
      { throttle: 0, engineCommand: "off", attitudeCommand: 0 },
      STEP_US,
    );
  }
  return {
    ...pdi,
    positionM: s.positionM,
    velocityMps: [-s.velocityMps[0], -s.velocityMps[1]],
  };
}
