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

  "terminal-descent": {
    id: "terminal-descent",
    version: 1,
    order: 2,
    title: "Terminal Descent",
    subtitle: "~500 ft · low-gate region",
    summary:
      "Begins near the historically meaningful low-gate region (~500 ft), " +
      "where the crew flew a largely visual, semi-manual descent.",
    objective:
      "Fly the last 150 m: hold a controlled sink rate, kill the residual " +
      "horizontal velocity, and touch down on the marked zone.",
    initial: {
      altitudeM: DESCENT_LANDMARKS.lowGateM,
      radialSpeedMps: -4.5,
      tangentialSpeedMps: 14,
      attitudeRad: -0.15,
      descentPropellantKg: 900,
      rangeToLandingZoneM: 600,
    },
    defaultControlMode: "quick-manual",
    availableControlModes: ["quick-manual", "agc-assisted", "training"],
    defaultAssistance: "pilot",
    hazards: [
      { angleOffsetRad: 0, radiusM: 40, kind: "boulder-field", label: "Boulder field" },
      { angleOffsetRad: 0, radiusM: 90, kind: "crater", label: "Crater rim" },
    ],
    historicalNote:
      "Low gate was approximately 500 ft on Apollo 11 (NASA mission summary). " +
      "The state vector here is a gameplay estimate, not the flown trajectory.",
  },

  "high-gate-challenge": {
    id: "high-gate-challenge",
    version: 1,
    order: 3,
    title: "High-Gate Challenge",
    subtitle: "~7,600 ft · approach phase",
    summary:
      "Starts near the historically meaningful high-gate region, where the " +
      "LM pitched up and the landing site came into view.",
    objective:
      "Manage energy from high gate through low gate and land on the zone " +
      "without exhausting descent propellant.",
    initial: {
      altitudeM: DESCENT_LANDMARKS.highGateM,
      radialSpeedMps: -44,
      tangentialSpeedMps: 152,
      attitudeRad: -0.6,
      descentPropellantKg: 2_300,
      rangeToLandingZoneM: 7_400,
    },
    defaultControlMode: "agc-assisted",
    availableControlModes: ["quick-manual", "agc-assisted", "training"],
    defaultAssistance: "pilot",
    hazards: [
      { angleOffsetRad: 0, radiusM: 70, kind: "crater", label: "West crater" },
      { angleOffsetRad: 0, radiusM: 160, kind: "boulder-field", label: "Ejecta blanket" },
    ],
    historicalNote:
      "High gate was approximately 7,600 ft on Apollo 11 (NASA mission summary).",
  },

  "apollo11-powered-descent": {
    id: "apollo11-powered-descent",
    version: 1,
    order: 4,
    title: "Apollo 11 Powered-Descent Challenge",
    subtitle: "~8.5 nmi · powered-descent initiation",
    summary:
      "Begins near powered-descent initiation from the descent-orbit low " +
      "point, with the full Apollo-style DSKY procedure and P63/P64 guidance.",
    objective:
      "Work the DSKY procedure, monitor the braking and approach phases, " +
      "then take P66 and land inside the gear limits.",
    initial: {
      altitudeM: DESCENT_LANDMARKS.poweredDescentInitiationM,
      radialSpeedMps: -3,
      tangentialSpeedMps: 1_620,
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
      "The descent-orbit low point was about 8.5 nautical miles (NASA mission " +
      "summary). This is a historically grounded gameplay scenario — it is " +
      "NOT a reproduction of the Apollo 11 trajectory.",
  },

  "free-flight": {
    id: "free-flight",
    version: 1,
    order: 5,
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
