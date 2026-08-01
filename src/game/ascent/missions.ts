// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Mission registry for /play/ascent.
//
// Mass and propulsion come from the M4.0 constant registry (APS 15,569 N,
// Isp 311 s, ascent-stage inert mass ~2,229 kg, usable APS propellant
// ~2,353 kg). Target orbits come from src/game/ascent/targets.ts and carry
// their own provenance. No mission claims to reproduce Eagle's trajectory.

import { LM_MASS } from "@/simulation/lunar2d/LunarMissionConstants";
import { getAscentTarget, NMI_M } from "./targets";
import type { AscentMissionDefinition, AscentMissionId } from "./types";

const APS_PROPELLANT_KG = LM_MASS.ascentPropellantKg.value;
const RCS_PROPELLANT_KG = LM_MASS.rcsPropellantKg.value;

export const ASCENT_MISSIONS: Readonly<
  Record<AscentMissionId, AscentMissionDefinition>
> = {
  "liftoff-fundamentals": {
    id: "liftoff-fundamentals",
    version: 1,
    title: "Liftoff Fundamentals",
    subtitle: "Stage, rise, pitch over",
    summary:
      "The descent stage becomes the launch pad. Fire the ascent engine, hold " +
      "the vertical rise, then pitch over and watch altitude turn into orbit.",
    objective:
      "Reach any orbit with a periapsis at or above 15 km without running the " +
      "APS dry.",
    order: 1,
    targetOrbitId: "training-low-orbit",
    ascentPropellantKg: APS_PROPELLANT_KG,
    rcsPropellantKg: RCS_PROPELLANT_KG,
    safePeriapsisAltitudeM: 15_000,
    verticalRiseSeconds: 10,
    insertionAltitudeM: 18_000,
    defaultAssistance: "instructor",
    sandbox: false,
    historicalNote:
      "Apollo ascents began with a short vertical rise to clear the descent " +
      "stage and any terrain, followed by a pitch-over into the orbital plane. " +
      "Timings here are historically grounded gameplay estimates.",
  },

  "orbital-insertion-trainer": {
    id: "orbital-insertion-trainer",
    version: 1,
    title: "Orbital Insertion Trainer",
    subtitle: "Fly the 9 x 45 nmi target",
    summary:
      "Fly the full ascent to the published Apollo 11 insertion orbit of about " +
      "9 by 45 nautical miles, with the pitch-program cue available.",
    objective:
      "Cut off with a periapsis at or above 15 km and an apoapsis close to " +
      "45 nautical miles (about 83 km).",
    order: 2,
    targetOrbitId: "apollo11-insertion-9x45",
    ascentPropellantKg: APS_PROPELLANT_KG,
    rcsPropellantKg: RCS_PROPELLANT_KG,
    safePeriapsisAltitudeM: 15_000,
    verticalRiseSeconds: 10,
    insertionAltitudeM: Math.round(9 * NMI_M),
    defaultAssistance: "pilot",
    sandbox: false,
    historicalNote:
      "Eagle's ascent-stage main burn lasted roughly seven minutes and " +
      "inserted the vehicle into an approximately 9 by 45 nautical-mile orbit. " +
      "That orbit is the game target; the simulated path is not Eagle's.",
  },

  "apollo11-ascent-challenge": {
    id: "apollo11-ascent-challenge",
    version: 1,
    title: "Apollo 11 Ascent Challenge",
    subtitle: "Commander limits, no numeric cues",
    summary:
      "The same insertion target with the numeric cues suppressed and a tighter " +
      "periapsis floor. Fly the pitch program by feel and the horizon.",
    objective:
      "Reach 9 x 45 nautical miles with a periapsis at or above 16 km and " +
      "propellant in the tanks.",
    order: 3,
    targetOrbitId: "apollo11-insertion-9x45",
    ascentPropellantKg: APS_PROPELLANT_KG,
    rcsPropellantKg: RCS_PROPELLANT_KG,
    safePeriapsisAltitudeM: 16_000,
    verticalRiseSeconds: 10,
    insertionAltitudeM: Math.round(9 * NMI_M),
    defaultAssistance: "commander",
    sandbox: false,
    historicalNote:
      "Ascent guidance in Luminary was P12. This game does not start P12 in the " +
      "rope: the ascent cues here are educational, not rope-driven.",
  },

  "orbit-sandbox": {
    id: "orbit-sandbox",
    version: 1,
    title: "Orbit Sandbox",
    subtitle: "Optional phase-burn exercise",
    summary:
      "Begin already inserted at about 9 by 45 nautical miles with the " +
      "propellant a real ascent would have left, and practise the phasing burn " +
      "that precedes a rendezvous. Nothing latches; experiment freely.",
    objective:
      "Raise the low point toward an approximately 49 by 45 nautical-mile " +
      "phasing orbit. Rendezvous and docking are out of scope.",
    order: 4,
    targetOrbitId: "apollo11-phasing-49x45",
    ascentPropellantKg: 400,
    rcsPropellantKg: 180,
    safePeriapsisAltitudeM: 15_000,
    verticalRiseSeconds: 0,
    insertionAltitudeM: Math.round(45 * NMI_M),
    defaultAssistance: "instructor",
    sandbox: true,
    historicalNote:
      "Phasing changes where the vehicle is along its orbit relative to the " +
      "command module. The propellant figure here is a gameplay-tuned " +
      "allowance, not a measured Apollo 11 residual.",
  },
};

export const ASCENT_MISSION_IDS: readonly AscentMissionId[] = [
  "liftoff-fundamentals",
  "orbital-insertion-trainer",
  "apollo11-ascent-challenge",
  "orbit-sandbox",
];

export function getAscentMission(id: AscentMissionId): AscentMissionDefinition {
  const mission = ASCENT_MISSIONS[id];
  if (!mission) throw new Error(`Unknown ascent mission: ${id}`);
  return mission;
}

export function targetForMission(mission: AscentMissionDefinition) {
  return getAscentTarget(mission.targetOrbitId);
}
