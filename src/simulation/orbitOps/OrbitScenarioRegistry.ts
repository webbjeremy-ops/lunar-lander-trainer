// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Versioned orbital-operations scenario registry.

import {
  CIRCULAR_TOLERANCE_M,
  INTERCEPT_CLOSING_RATE_MPS,
  INTERCEPT_RANGE_M,
  NMI_M,
  SAFE_PERIAPSIS_M,
  orbitNumber,
} from "./OrbitConstants";
import type { OrbitControlId, OrbitScenario } from "./types";

const FULL_CONTROLS: readonly OrbitControlId[] = [
  "time-acceleration",
  "pause",
  "reset",
  "maneuver-node-time",
  "prograde-retrograde",
  "radial",
  "attitude",
  "burn-start",
  "burn-stop",
  "rcs-translation",
  "instructor-overlay",
  "view-toggle",
];

const CSM_ALTITUDE_M = orbitNumber("csm-parking-orbit-altitude");

function csmSeed(centralAngleRad: number) {
  return {
    periapsisAltitudeM: CSM_ALTITUDE_M,
    apoapsisAltitudeM: CSM_ALTITUDE_M,
    centralAngleRad,
    startAtPeriapsis: true,
  } as const;
}

export const ORBIT_SCENARIOS: Readonly<Record<string, OrbitScenario>> = {
  "orbit-fundamentals": {
    id: "orbit-fundamentals",
    version: 1,
    title: "Orbit Fundamentals",
    subtitle: "Read the orbit before you change it",
    summary:
      "A safe, roomy orbit and generous propellant. Learn to read periapsis, apoapsis, period, radial and tangential velocity and flight-path angle before touching a manoeuvre node.",
    order: 1,
    startingState: {
      periapsisAltitudeM: 60_000,
      apoapsisAltitudeM: 110_000,
      centralAngleRad: 0,
      startAtPeriapsis: true,
    },
    targetVehicleState: null,
    objectives: [
      {
        id: "read-the-orbit",
        title: "Read the orbit",
        detail:
          "Identify periapsis, apoapsis and period, and watch radial velocity change sign at each apsis.",
      },
    ],
    successConditions: [
      {
        id: "stay-safe",
        description: "Keep periapsis above the safety altitude.",
        kind: "periapsis-above",
        valueM: SAFE_PERIAPSIS_M,
      },
      {
        id: "inspect",
        description: "Review the orbit readout and end the exercise.",
        kind: "manual-review",
      },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "educational-approximation",
    sourceReferences: ["m4-0-kernel", "lunar2d-jpl-de-lunar-gm"],
    gameplayTuning: [
      "Starting orbit chosen for legibility, not from a flight plan.",
      "Generous propellant so mistakes are recoverable.",
    ],
    propulsion: "educational-maneuver-actuator",
    propellantKg: 600,
    rcsPropellantKg: 120,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: true,
    historicalNote:
      "A teaching orbit. No Apollo 11 claim is attached to these numbers.",
  },

  "save-the-periapsis": {
    id: "save-the-periapsis",
    version: 1,
    title: "Save the Periapsis",
    subtitle: "An impact trajectory with time to fix it",
    summary:
      "The orbit's low point is below the surface: left alone the vehicle strikes the Moon. Coast to apoapsis, plan a prograde burn and raise periapsis above the safety altitude.",
    order: 2,
    startingState: {
      periapsisAltitudeM: -8_000,
      apoapsisAltitudeM: 95_000,
      centralAngleRad: Math.PI,
      startAtPeriapsis: false,
    },
    targetVehicleState: null,
    objectives: [
      {
        id: "raise-periapsis",
        title: "Raise periapsis",
        detail:
          "Burn prograde near apoapsis until periapsis clears the safety altitude.",
      },
    ],
    successConditions: [
      {
        id: "safe-periapsis",
        description: "Periapsis above the safety altitude.",
        kind: "periapsis-above",
        valueM: SAFE_PERIAPSIS_M,
      },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
      {
        id: "dry",
        description: "Manoeuvring propellant exhausted before the orbit is safe.",
        kind: "propellant-exhausted",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "educational-approximation",
    sourceReferences: ["m4-0-kernel"],
    gameplayTuning: [
      "Negative starting periapsis chosen to force one correct apsis burn.",
      "Propellant sized so a late or badly aimed burn can still fail.",
    ],
    propulsion: "rcs-translation",
    propellantKg: 180,
    rcsPropellantKg: 120,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: false,
    historicalNote:
      "A constructed emergency, not an Apollo event. The physics and the RCS " +
      "translation figures are the project's registered values.",
  },

  "circularization-trainer": {
    id: "circularization-trainer",
    version: 1,
    title: "Circularization Trainer",
    subtitle: "One burn at the right apsis",
    summary:
      "Start on a markedly elliptical orbit and bring apoapsis and periapsis together. Burn at the wrong place and the ellipse only rotates.",
    order: 3,
    startingState: {
      periapsisAltitudeM: 30_000,
      apoapsisAltitudeM: 160_000,
      centralAngleRad: 0,
      startAtPeriapsis: true,
    },
    targetVehicleState: null,
    objectives: [
      {
        id: "circularize",
        title: "Circularize",
        detail:
          "Reduce the difference between apoapsis and periapsis to within tolerance.",
      },
    ],
    successConditions: [
      {
        id: "circular",
        description: "Apoapsis minus periapsis within tolerance.",
        kind: "circular-within",
        valueM: CIRCULAR_TOLERANCE_M,
      },
      {
        id: "safe-periapsis",
        description: "Periapsis above the safety altitude.",
        kind: "periapsis-above",
        valueM: SAFE_PERIAPSIS_M,
      },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
      {
        id: "dry",
        description: "Manoeuvring propellant exhausted.",
        kind: "propellant-exhausted",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "educational-approximation",
    sourceReferences: ["m4-0-kernel"],
    gameplayTuning: [
      "Ellipse sized so circularization costs roughly 30 m/s.",
      "Tolerance of 3 km chosen so one finite burn can satisfy it.",
    ],
    propulsion: "rcs-translation",
    propellantKg: 220,
    rcsPropellantKg: 120,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: false,
    historicalNote: "A teaching exercise; the orbit is not an Apollo orbit.",
  },

  "phasing-burn-trainer": {
    id: "phasing-burn-trainer",
    version: 1,
    title: "Phasing Burn Trainer",
    subtitle: "Catch the Command Module by changing period",
    summary:
      "A passive Command Module leads you around the Moon. Change your orbital period so the geometry closes over several revolutions, then arrive inside the intercept window.",
    order: 4,
    startingState: {
      periapsisAltitudeM: 85_000,
      apoapsisAltitudeM: 85_000,
      centralAngleRad: 0,
      startAtPeriapsis: true,
    },
    targetVehicleState: csmSeed(1.05),
    objectives: [
      {
        id: "phase-for-intercept",
        title: "Set up the intercept",
        detail:
          "Change period, let phase close over whole revolutions, and arrive within the intercept range and closing-rate limits.",
      },
    ],
    successConditions: [
      {
        id: "intercept",
        description: "Range and closing rate inside the intercept-setup limits.",
        kind: "intercept-setup",
        valueM: INTERCEPT_RANGE_M,
      },
      {
        id: "safe-periapsis",
        description: "Periapsis above the safety altitude.",
        kind: "periapsis-above",
        valueM: SAFE_PERIAPSIS_M,
      },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
      {
        id: "dry",
        description: "Manoeuvring propellant exhausted.",
        kind: "propellant-exhausted",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "educational-approximation",
    sourceReferences: ["m4-0-kernel", "nasa-sp-4029"],
    gameplayTuning: [
      "Initial phase angle chosen so a modest period change closes it in a few revolutions.",
      `Intercept boundary set at ${INTERCEPT_RANGE_M / 1000} km and ${INTERCEPT_CLOSING_RATE_MPS} m/s.`,
    ],
    propulsion: "rcs-translation",
    propellantKg: 260,
    rcsPropellantKg: 150,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: false,
    historicalNote:
      "Columbia's roughly 60 nautical-mile parking orbit is used as the " +
      "passive target. The relative trajectory is not Eagle's.",
  },

  "apollo11-orbital-operations": {
    id: "apollo11-orbital-operations",
    version: 1,
    title: "Apollo 11 Orbital Operations Challenge",
    subtitle: "From insertion toward the phasing region",
    summary:
      "Start from the registered Apollo 11-inspired 9 x 45 nautical-mile insertion orbit, raise the low point toward the 49 x 45 nautical-mile phasing region, and set up the intercept with Columbia.",
    order: 5,
    startingState: {
      periapsisAltitudeM: Math.round(9 * NMI_M),
      apoapsisAltitudeM: Math.round(45 * NMI_M),
      centralAngleRad: 0,
      startAtPeriapsis: true,
    },
    targetVehicleState: csmSeed(1.4),
    objectives: [
      {
        id: "raise-periapsis",
        title: "Raise the low point",
        detail:
          "Bring periapsis up toward the registered phasing region low point.",
      },
      {
        id: "phase-for-intercept",
        title: "Set up the intercept",
        detail: "Close the phase angle with Columbia and reach the intercept window.",
      },
    ],
    successConditions: [
      {
        id: "phasing-apoapsis",
        description: "Apoapsis near the registered phasing high point.",
        kind: "apoapsis-within",
        valueM: orbitNumber("apoapsis-tolerance"),
      },
      {
        id: "safe-periapsis",
        description: "Periapsis above the safety altitude.",
        kind: "periapsis-above",
        valueM: SAFE_PERIAPSIS_M,
      },
      {
        id: "intercept",
        description: "Range and closing rate inside the intercept-setup limits.",
        kind: "intercept-setup",
        valueM: INTERCEPT_RANGE_M,
      },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
      {
        id: "dry",
        description: "Ascent propulsion propellant exhausted.",
        kind: "propellant-exhausted",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "historically-grounded",
    sourceReferences: ["apollo-11-mission-report", "nasa-sp-4029", "m4-0-kernel"],
    gameplayTuning: [
      "Residual APS propellant after insertion is a game allowance, not a flight figure.",
      "Columbia's orbit is modelled as circular and passive.",
    ],
    propulsion: "ascent-propulsion",
    propellantKg: 300,
    rcsPropellantKg: 180,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: false,
    historicalNote:
      "The 9 x 45 and 49 x 45 nautical-mile orbits are published Apollo 11 " +
      "figures used as game targets. This is not a reconstruction of the " +
      "Eagle-Columbia trajectory.",
  },

  "orbit-sandbox": {
    id: "orbit-sandbox",
    version: 1,
    title: "Orbital Mechanics Sandbox",
    subtitle: "Plan anything, break anything",
    summary:
      "A passive Command Module, a full manoeuvre planner, time acceleration and no objectives. Export the state, reload it and replay it deterministically.",
    order: 6,
    startingState: {
      periapsisAltitudeM: 70_000,
      apoapsisAltitudeM: 140_000,
      centralAngleRad: 0,
      startAtPeriapsis: true,
    },
    targetVehicleState: csmSeed(2.2),
    objectives: [
      {
        id: "free-practice",
        title: "Free practice",
        detail: "No objective. Try a plan and watch what the finite burn actually does.",
      },
    ],
    successConditions: [
      { id: "none", description: "No success condition.", kind: "manual-review" },
    ],
    failureConditions: [
      {
        id: "impact",
        description: "The vehicle strikes the surface.",
        kind: "surface-impact",
      },
    ],
    availableControls: FULL_CONTROLS,
    fidelityClassification: "gameplay-tuned",
    sourceReferences: ["m4-0-kernel"],
    gameplayTuning: ["Everything here is tuned for experimentation."],
    propulsion: "educational-maneuver-actuator",
    propellantKg: 900,
    rcsPropellantKg: 200,
    safePeriapsisAltitudeM: SAFE_PERIAPSIS_M,
    sandbox: true,
    historicalNote: "Sandbox. No historical claim.",
  },
};

export const ORBIT_SCENARIO_IDS: readonly string[] = Object.values(ORBIT_SCENARIOS)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.id);

export function getOrbitScenario(id: string): OrbitScenario {
  const s = ORBIT_SCENARIOS[id];
  if (!s) throw new Error(`Unknown orbital-operations scenario: ${id}`);
  return s;
}
