// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Target-orbit provenance registry for the lunar-ascent game.
//
// The Apollo 11 ascent-stage main burn lasted roughly seven minutes and placed
// Eagle into an approximately 9 x 45 nautical-mile lunar orbit; a later
// manoeuvre raised the low point toward an approximately 49 x 45 nautical-mile
// phasing orbit before rendezvous operations. Those two orbits are used here as
// GAME TARGETS. This browser trajectory does NOT reproduce Eagle's flown
// trajectory: the flight model is the deterministic planar M4.0 kernel, the
// vehicle is flown by the player, and every tuned number below is labelled.

import type { TargetOrbit } from "./types";

export const NMI_M = 1852;

/** Sources already registered by the project; ids match LUNAR2D_SOURCES. */
export const ASCENT_TARGET_SOURCES = [
  "APOLLO-11-MISSION-REPORT",
  "NASA-SP-4029",
  "NASA-TN-D-6846",
  "NASA-TN-D-7082",
] as const;

export const ASCENT_TARGETS: Readonly<Record<string, TargetOrbit>> = {
  "apollo11-insertion-9x45": {
    id: "apollo11-insertion-9x45",
    label: "Insertion — 9 x 45 nmi",
    periapsisAltitudeM: Math.round(9 * NMI_M),
    apoapsisAltitudeM: Math.round(45 * NMI_M),
    classification: "source-derived",
    sourceId: "APOLLO-11-MISSION-REPORT",
    rationale:
      "Published Apollo 11 ascent insertion orbit, approximately 9 by 45 " +
      "nautical miles. Used as the game's insertion target; the simulated " +
      "trajectory is not claimed to reproduce Eagle's.",
  },
  "apollo11-phasing-49x45": {
    id: "apollo11-phasing-49x45",
    label: "Phasing — 49 x 45 nmi",
    periapsisAltitudeM: Math.round(45 * NMI_M),
    apoapsisAltitudeM: Math.round(49 * NMI_M),
    classification: "source-derived",
    sourceId: "APOLLO-11-MISSION-REPORT",
    rationale:
      "Post-insertion phasing orbit of approximately 49 by 45 nautical miles " +
      "reached before rendezvous operations. Used as the sandbox's optional " +
      "phase-burn exercise target. Rendezvous itself is out of scope for M4.3.",
  },
  "training-low-orbit": {
    id: "training-low-orbit",
    label: "Training — 15 x 60 km",
    periapsisAltitudeM: 15_000,
    apoapsisAltitudeM: 60_000,
    classification: "gameplay-tuned",
    sourceId: null,
    rationale:
      "Deliberately forgiving first target: a safe periapsis with a modest " +
      "apoapsis. Chosen for teaching, not a historical claim.",
  },
};

export const ASCENT_TARGET_IDS: readonly string[] = [
  "training-low-orbit",
  "apollo11-insertion-9x45",
  "apollo11-phasing-49x45",
];

export function getAscentTarget(id: string): TargetOrbit {
  const target = ASCENT_TARGETS[id];
  if (!target) throw new Error(`Unknown ascent target orbit: ${id}`);
  return target;
}
