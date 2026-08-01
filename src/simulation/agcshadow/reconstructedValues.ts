// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — Reconstructed-value registry for the EXPERIMENTAL Luminary shadow
// profile.
//
// This module does NOT duplicate the M4.5a assumption registry
// (`src/simulation/agcguidance/assumptions.ts`). It is the numeric layer on
// top of it: every value the shadow bootstrap could install, or explicitly
// could NOT resolve, is declared here and MUST reference an assumption id
// that the M4.5a registry already owns. `assertAssumptionsDeclared` is the
// gate, so a value with an invented assumption id cannot be added.

import { assertAssumptionsDeclared } from "@/simulation/agcguidance/assumptions";

export type ReconstructedClassification =
  | "source-derived"
  | "historically-grounded-estimate"
  | "experimental-best-estimate";

export interface ReconstructedValue {
  readonly id: string;
  /** `null` means the value is UNRESOLVED and must not be installed. */
  readonly value: number | readonly number[] | null;
  readonly unit: string;
  readonly classification: ReconstructedClassification;
  readonly sourceReferences: readonly string[];
  readonly rationale: string;
  readonly uncertainty: string;
  /** Assumption id in the M4.5a registry that justifies this value. */
  readonly assumptionId: string;
  /** Category required by the M4.6A brief. */
  readonly category: ReconstructedValueCategory;
}

export type ReconstructedValueCategory =
  | "pdi-position-velocity"
  | "mission-time"
  | "mass-and-propellant"
  | "refsmmat"
  | "cdu-imu-initial-state"
  | "rn-vn"
  | "piptime"
  | "average-g-integration-state"
  | "avegflag"
  | "moon-gravity-flags"
  | "landing-site-reference"
  | "engine-ready-state"
  | "p63-program-entry"
  | "landing-radar-availability";

/** Every category the brief requires must appear at least once below. */
export const REQUIRED_VALUE_CATEGORIES: readonly ReconstructedValueCategory[] = [
  "pdi-position-velocity",
  "mission-time",
  "mass-and-propellant",
  "refsmmat",
  "cdu-imu-initial-state",
  "rn-vn",
  "piptime",
  "average-g-integration-state",
  "avegflag",
  "moon-gravity-flags",
  "landing-site-reference",
  "engine-ready-state",
  "p63-program-entry",
  "landing-radar-availability",
];

const ROPE = "Luminary099 @911e5c0283c629c50cb97666f34065e8c07d71a5";

export const RECONSTRUCTED_VALUES: readonly ReconstructedValue[] = [
  {
    id: "pdi.altitude-and-speed",
    category: "pdi-position-velocity",
    value: [49_971, 5_559.7],
    unit: "[ft, ft/s]",
    classification: "historically-grounded-estimate",
    sourceReferences: [
      "apollo11-powered-descent-technical-reconstruction-workbook-v1 (MissionLog:18)",
      "src/simulation/agcguidance/pdiCheckpoint.ts",
    ],
    rationale:
      "Workbook PDI anchor, placed in the M4.0 planar frame with zero radial rate.",
    uncertainty:
      "Secondary reconstruction; radial-rate split is a declared modelling choice.",
    assumptionId: "pdi-state-vector",
  },
  {
    id: "pdi.mission-time",
    category: "mission-time",
    value: 0,
    unit: "us since PDI ignition (102:33:05 GET)",
    classification: "historically-grounded-estimate",
    sourceReferences: ["docs/M3_3C_PAD_LOAD_AND_ACCEPTANCE.md"],
    rationale:
      "Scenario time zero is PDI ignition. The AGC's TIME1/TIME2 pair starts at rope reset and is NOT Apollo 11 GET.",
    uncertainty: "The offset between AGC clock and GET is declared, not recovered.",
    assumptionId: "pdi-mission-time",
  },
  {
    id: "pdi.mass-and-propellant",
    category: "mass-and-propellant",
    value: null,
    unit: "kg (MASS erasable, scale unresolved)",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} ERASABLE_ASSIGNMENTS.agc (MASS = 0o1244)`],
    rationale:
      "The planar kernel owns vehicle mass. The rope's MASS erasable scaling was not resolved from in-repo sources, so no word is installed.",
    uncertainty: "UNRESOLVED SCALE. Not installed.",
    assumptionId: "erasable-p63-initialisation",
  },
  {
    id: "imu.refsmmat",
    category: "refsmmat",
    value: null,
    unit: "18 erasable words",
    classification: "source-derived",
    sourceReferences: [
      "src/simulation/agcio/imuBootstrap.ts",
      "docs/M3_3C_PHASE4A_COORDINATE_CHAIN.md",
    ],
    rationale:
      "Supplied unchanged by the FROZEN M3.3E fixed-attitude pad load, which M4.6A does not modify or re-declare.",
    uncertainty: "Fixed-attitude bootstrap, not the flown landing-site REFSMMAT.",
    assumptionId: "refsmmat-and-cdu",
  },
  {
    id: "imu.cdu-initial",
    category: "cdu-imu-initial-state",
    value: null,
    unit: "CDU counts",
    classification: "source-derived",
    sourceReferences: ["src/simulation/agcio/imuBootstrap.ts"],
    rationale:
      "Supplied unchanged by the frozen M3.3E pad load. No dynamic CDU input interface exists in the canonical hardware layer, so attitude is static for the whole shadow run.",
    uncertainty:
      "No inertial coupling is claimed. Dynamic CDU input is UNAVAILABLE in HW-I/O v4.",
    assumptionId: "refsmmat-and-cdu",
  },
  {
    id: "nav.rn-vn",
    category: "rn-vn",
    value: null,
    unit: "double-precision erasable vectors (RN = 0o1220, VN = 0o1226)",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} ERASABLE_ASSIGNMENTS.agc`],
    rationale:
      "The rope's position/velocity scaling could not be established from in-repo sources without resuming archival transcription, which this milestone forbids.",
    uncertainty: "UNRESOLVED SCALE. Not installed; observed read-only as raw words.",
    assumptionId: "erasable-p63-initialisation",
  },
  {
    id: "nav.piptime",
    category: "piptime",
    value: null,
    unit: "double-precision centiseconds (PIPTIME = 0o1234)",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} SERVICER.agc:42-83`],
    rationale:
      "PIPTIME is written by the rope's own PIPASR read, not by a pad load. Installing it would fabricate Servicer state.",
    uncertainty: "Deliberately not installed.",
    assumptionId: "erasable-p63-initialisation",
  },
  {
    id: "averageg.integration-state",
    category: "average-g-integration-state",
    value: null,
    unit: "PHASE5 / WCHPHASE task state",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} SERVICER.agc:38-100`],
    rationale:
      "Average-G integration is started by PREREAD scheduling READACCS through WAITLIST. It is task state, not a word, and cannot be pad-loaded.",
    uncertainty:
      "BLOCKING: no pad-loadable representation exists. See the M4.6A verdict.",
    assumptionId: "average-g-activation",
  },
  {
    id: "flags.avegflag",
    category: "avegflag",
    value: 0o20,
    unit: "bit mask into FLAGWRD7 (0o103), AVEGFBIT = BIT5",
    classification: "source-derived",
    sourceReferences: [
      `${ROPE} FLAGWORD_ASSIGNMENTS.agc:809-810 (AVEGFLAG = 115D, AVEGFBIT = BIT5)`,
      `${ROPE} SERVICER.agc:53`,
    ],
    rationale:
      "The one bit whose address, mask and meaning are fully source-derived. Setting it is a necessary — not sufficient — precondition for READACCS.",
    uncertainty:
      "Setting the bit does not start the Average-G task; PREREAD does.",
    assumptionId: "average-g-activation",
  },
  {
    id: "flags.moon-gravity",
    category: "moon-gravity-flags",
    value: null,
    unit: "MUNFLAG flag bit (flag number 97 in FLAGWORD_ASSIGNMENTS)",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} THE_LUNAR_LANDING.agc:69-71 (P63 sets MUNFLAG itself)`],
    rationale:
      "P63's FLAGORGY sets MUNFLAG and clears LRBYPASS itself. Pad-loading it would duplicate rope behaviour.",
    uncertainty: "Deliberately not installed; the rope owns it.",
    assumptionId: "erasable-p63-initialisation",
  },
  {
    id: "site.rls",
    category: "landing-site-reference",
    value: null,
    unit: "double-precision moon-fixed vector (RLS = 0o2022)",
    classification: "experimental-best-estimate",
    sourceReferences: [`${ROPE} THE_LUNAR_LANDING.agc:79-90 (IGNALG loads RLS, TLAND)`],
    rationale:
      "P63's IGNALG requires RLS and TLAND. Their erasable scaling is unresolved in-repo.",
    uncertainty: "UNRESOLVED SCALE. Not installed. Primary blocker for ignition timing.",
    assumptionId: "program-transition-conditions",
  },
  {
    id: "engine.ready",
    category: "engine-ready-state",
    value: 0.1,
    unit: "fraction of rated DPS thrust",
    classification: "historically-grounded-estimate",
    sourceReferences: ["src/simulation/agcguidance/pdiCheckpoint.ts"],
    rationale: "DPS armed at the 10% ignition setting in the host flight model only.",
    uncertainty: "Host-side state; no rope word is written.",
    assumptionId: "control-electronics-response",
  },
  {
    id: "program.p63-entry",
    category: "p63-program-entry",
    value: 63,
    unit: "MODREG (0o1011) major mode",
    classification: "source-derived",
    sourceReferences: [`${ROPE} THE_LUNAR_LANDING.agc:40 (P63LM)`],
    rationale:
      "P63 is entered ONLY by keying V37E 63E on the real shared DSKY. MODREG is observed, never written.",
    uncertainty: "None: this is an observation, not an installed value.",
    assumptionId: "program-transition-conditions",
  },
  {
    id: "radar.availability",
    category: "landing-radar-availability",
    value: 1,
    unit: "boolean",
    classification: "source-derived",
    sourceReferences: ["docs/M3_3E_HARDWARE_INTERFACE_LAB_FREEZE.md"],
    rationale:
      "The host will answer an authentic CHAN13 solicitation only. No host timer, no fabricated request.",
    uncertainty: "Availability is a host capability, not a rope word.",
    assumptionId: "landing-radar-timing",
  },
];

export interface ValueRegistryError {
  readonly kind: string;
  readonly detail: string;
}

/** Registry gate: unique ids, declared assumptions, every category covered. */
export function validateReconstructedValues(
  values: readonly ReconstructedValue[] = RECONSTRUCTED_VALUES,
): readonly ValueRegistryError[] {
  const errors: ValueRegistryError[] = [];
  const ids = new Set<string>();
  for (const v of values) {
    if (ids.has(v.id)) errors.push({ kind: "duplicate-id", detail: v.id });
    ids.add(v.id);
    if (v.sourceReferences.length === 0) {
      errors.push({ kind: "missing-source", detail: v.id });
    }
    if (v.rationale.length === 0 || v.uncertainty.length === 0) {
      errors.push({ kind: "missing-rationale-or-uncertainty", detail: v.id });
    }
  }
  try {
    assertAssumptionsDeclared(values.map((v) => v.assumptionId));
  } catch (e) {
    errors.push({ kind: "undeclared-assumption", detail: String(e) });
  }
  for (const c of REQUIRED_VALUE_CATEGORIES) {
    if (!values.some((v) => v.category === c)) {
      errors.push({ kind: "missing-category", detail: c });
    }
  }
  return errors;
}

export function reconstructedValueById(id: string): ReconstructedValue {
  const v = RECONSTRUCTED_VALUES.find((x) => x.id === id);
  if (!v) throw new Error(`undeclared reconstructed value: ${id}`);
  return v;
}

/** Values that could not be resolved and are therefore never installed. */
export const UNRESOLVED_VALUES: readonly ReconstructedValue[] =
  RECONSTRUCTED_VALUES.filter((v) => v.value === null);
