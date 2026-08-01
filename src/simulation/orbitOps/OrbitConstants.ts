// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Typed provenance registry for lunar orbital operations.
//
// Every mission number, tolerance, limit and allowance used by the orbital
// operations layer is registered here with one of the project's five accuracy
// classifications. Nothing in this file is a new historical claim: the two
// Apollo 11 orbits reuse the already-registered M4.3 ascent targets.

import type { OrbitSourcedValue, OrbitAccuracyClass } from "./types";

export const NMI_M = 1852;

export const ORBIT_OPS_SOURCE_IDS: readonly string[] = [
  "apollo-11-mission-report",
  "nasa-sp-4029",
  "lunar2d-jpl-de-lunar-gm",
  "m4-0-kernel",
  "apollo11-powered-descent-technical-reconstruction-workbook-v1",
] as const;

function v(
  id: string,
  label: string,
  value: number,
  unit: string,
  classification: OrbitAccuracyClass,
  sourceId: string | null,
  rationale: string,
): OrbitSourcedValue {
  return { id, label, value, unit, classification, sourceId, rationale };
}

export const ORBIT_OPS_VALUES: readonly OrbitSourcedValue[] = [
  v(
    "safe-periapsis-altitude",
    "Safe periapsis altitude",
    15_000,
    "m",
    "gameplay-tuned",
    "m4-0-kernel",
    "Reuses the M4.0 kernel's orbit-achieved periapsis threshold so a safe " +
      "orbit means the same thing in ascent and in orbital operations.",
  ),
  v(
    "danger-periapsis-altitude",
    "Periapsis danger threshold",
    5_000,
    "m",
    "gameplay-tuned",
    null,
    "Below this the HUD raises a periapsis warning. Chosen to give the " +
      "student time to plan a rescue burn, not a flight rule.",
  ),
  v(
    "apollo11-insertion-periapsis",
    "Apollo 11 insertion periapsis",
    Math.round(9 * NMI_M),
    "m",
    "source-derived",
    "apollo-11-mission-report",
    "Published Apollo 11 ascent insertion orbit, approximately 9 x 45 nmi. " +
      "Used as a game target; not a reconstruction of Eagle's trajectory.",
  ),
  v(
    "apollo11-insertion-apoapsis",
    "Apollo 11 insertion apoapsis",
    Math.round(45 * NMI_M),
    "m",
    "source-derived",
    "apollo-11-mission-report",
    "Published Apollo 11 ascent insertion orbit high point.",
  ),
  v(
    "apollo11-phasing-periapsis",
    "Apollo 11 phasing-region low point",
    Math.round(45 * NMI_M),
    "m",
    "source-derived",
    "apollo-11-mission-report",
    "Post-insertion phasing region of approximately 49 x 45 nmi.",
  ),
  v(
    "apollo11-phasing-apoapsis",
    "Apollo 11 phasing-region high point",
    Math.round(49 * NMI_M),
    "m",
    "source-derived",
    "apollo-11-mission-report",
    "Post-insertion phasing region of approximately 49 x 45 nmi.",
  ),
  v(
    "csm-parking-orbit-altitude",
    "Command Module parking orbit",
    Math.round(60 * NMI_M),
    "m",
    "historically-grounded",
    "nasa-sp-4029",
    "Columbia held a near-circular orbit close to 60 nautical miles while " +
      "Eagle was away. Modelled as a passive circular target orbit.",
  ),
  v(
    "circularization-tolerance",
    "Circular-orbit tolerance",
    3_000,
    "m",
    "gameplay-tuned",
    null,
    "Apoapsis minus periapsis at or below this counts as circularized. " +
      "Chosen so a single well-timed finite burn can satisfy it.",
  ),
  v(
    "apoapsis-tolerance",
    "Target apoapsis tolerance",
    5_000,
    "m",
    "gameplay-tuned",
    null,
    "Scoring tolerance on the target high point.",
  ),
  v(
    "period-tolerance",
    "Target period tolerance",
    30,
    "s",
    "gameplay-tuned",
    null,
    "Scoring tolerance on orbital period for phasing exercises.",
  ),
  v(
    "intercept-range",
    "Intercept-setup range limit",
    40_000,
    "m",
    "gameplay-tuned",
    null,
    "M5.0 ends when the LM reaches this range of the Command Module with a " +
      "bounded closing rate. Terminal rendezvous is deliberately out of scope.",
  ),
  v(
    "intercept-closing-rate",
    "Intercept-setup closing-rate limit",
    30,
    "m/s",
    "gameplay-tuned",
    null,
    "Maximum acceptable closing rate at the intercept-setup boundary.",
  ),
  v(
    "educational-actuator-thrust",
    "Educational manoeuvre actuator thrust",
    2_000,
    "N",
    "educational-approximation",
    null,
    "A deliberately gentle, clearly-labelled actuator used only by teaching " +
      "scenarios where the fixed-thrust APS is unsuitable for a small " +
      "correction. It is not LM hardware.",
  ),
  v(
    "educational-actuator-isp",
    "Educational manoeuvre actuator specific impulse",
    311,
    "s",
    "educational-approximation",
    null,
    "Matches the APS figure so propellant arithmetic stays comparable.",
  ),
  v(
    "rcs-translation-thrust",
    "RCS translation thrust",
    1_780,
    "N",
    "historically-grounded",
    "lm-familiarization-manual",
    "Four 445 N (100 lbf) RCS jets firing together along one translation " +
      "axis. Aggregated as a single planar actuator.",
  ),
  v(
    "rcs-translation-isp",
    "RCS translation specific impulse",
    290,
    "s",
    "historically-grounded",
    "lm-familiarization-manual",
    "Representative RCS vacuum specific impulse.",
  ),
];

const BY_ID = new Map(ORBIT_OPS_VALUES.map((x) => [x.id, x]));

export function orbitValue(id: string): OrbitSourcedValue {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown orbit-ops registered value: ${id}`);
  return found;
}

export function orbitNumber(id: string): number {
  return orbitValue(id).value;
}

export const SAFE_PERIAPSIS_M = orbitNumber("safe-periapsis-altitude");
export const DANGER_PERIAPSIS_M = orbitNumber("danger-periapsis-altitude");
export const CIRCULAR_TOLERANCE_M = orbitNumber("circularization-tolerance");
export const INTERCEPT_RANGE_M = orbitNumber("intercept-range");
export const INTERCEPT_CLOSING_RATE_MPS = orbitNumber("intercept-closing-rate");

export const INTERCEPT_COMPLETE_LABEL = "INTERCEPT SETUP COMPLETE" as const;
export const INTERCEPT_CONTINUES_LABEL =
  "TERMINAL RENDEZVOUS CONTINUES IN M5.1" as const;
export const EDUCATIONAL_RELATIVE_VIEW_LABEL =
  "EDUCATIONAL RELATIVE-MOTION VIEW" as const;
export const EDUCATIONAL_MANEUVER_LABEL = "EDUCATIONAL MANEUVER MODEL" as const;
