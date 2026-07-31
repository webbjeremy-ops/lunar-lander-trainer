// SPDX-License-Identifier: GPL-3.0-or-later
//
// Apollo 11 powered-descent curated reference content.
//
// SOURCE: "Apollo 11 Powered Descent — A Technical Reconstruction" (ENG)
//         workbook, registered as a SECONDARY RECONSTRUCTION source under
//         id `apollo11-powered-descent-technical-reconstruction-workbook-v1`.
//
// The workbook blends NASA primary sources, Luminary material, air-to-ground
// transcript, Computer Words telemetry, secondary literature, and author
// inference. Nothing in this module is treated as flight-certified data.
//
// HARD RULES enforced here:
//   * Every value is RECONSTRUCTED FROM COMPUTER-WORDS TELEMETRY and is
//     NOT AN EXACT PHYSICS INITIAL CONDITION.
//   * This module is DATA ONLY. It is never imported by the physics kernel,
//     the AGC worker, the procedure engine, or any I/O path. It exists for
//     timeline markers, narration, lessons, scoring context, and debrief.
//   * No Verb/Noun dictionary from the workbook is imported. N60–N64
//     descriptions are deliberately absent pending verification against the
//     pinned Luminary099 rope or primary program documentation.
//   * No claim about rope cadence (e.g. "READACCS every two seconds") is
//     imported; the repository's pinned-rope semantics are authoritative.

export const APOLLO11_WORKBOOK_SOURCE_ID =
  "apollo11-powered-descent-technical-reconstruction-workbook-v1";

/** Provenance every imported item must carry. */
export interface WorkbookProvenance {
  workbookSheet: string;
  workbookRow: number;
  classification:
    | "source-derived-reconstruction"
    | "secondary-explanation"
    | "author-inference";
}

export const RECONSTRUCTION_DISCLAIMER =
  "RECONSTRUCTED FROM COMPUTER-WORDS TELEMETRY — NOT AN EXACT PHYSICS INITIAL CONDITION";

const FT_TO_M = 0.3048;
export const feetToMeters = (ft: number): number => ft * FT_TO_M;

/** "hhh:mm:ss" ground elapsed time → seconds. */
export function getToSeconds(get: string): number {
  const [h, m, s] = get.split(":").map((p) => Number.parseInt(p, 10));
  return h * 3600 + m * 60 + s;
}

export type DescentPhaseId =
  | "pdi-p63"
  | "throttle-down"
  | "p64"
  | "p66"
  | "contact";

export interface DescentPhaseAnchor {
  id: DescentPhaseId;
  label: string;
  /** Ground elapsed time, "hhh:mm:ss". */
  get: string;
  /** Seconds from PDI ignition (102:33:05). Negative before PDI. */
  tFromPdiSec: number;
  altitudeFt?: number;
  totalVelocityFtPerSec?: number;
  horizontalVelocityFtPerSec?: number;
  descentRateFtPerSec?: number;
  note: string;
  provenance: WorkbookProvenance;
}

const PDI_GET_SEC = getToSeconds("102:33:05");

export const APOLLO11_DESCENT_PHASE_ANCHORS: readonly DescentPhaseAnchor[] = [
  {
    id: "pdi-p63",
    label: "PDI — P63 braking phase, DPS ignition",
    get: "102:33:05",
    tFromPdiSec: 0,
    altitudeFt: 49_971,
    totalVelocityFtPerSec: 5_559.7,
    note: "Descent engine ignition at 10% throttle; P63 braking phase running.",
    provenance: {
      workbookSheet: "MissionLog",
      workbookRow: 18,
      classification: "source-derived-reconstruction",
    },
  },
  {
    id: "throttle-down",
    label: "Throttle-down (end of fixed throttle position)",
    get: "102:39:31",
    tFromPdiSec: getToSeconds("102:39:31") - PDI_GET_SEC,
    altitudeFt: 22_984,
    note: "Guidance commands throttle recovery out of the fixed maximum-thrust region.",
    provenance: {
      workbookSheet: "MissionLog",
      workbookRow: 130,
      classification: "source-derived-reconstruction",
    },
  },
  {
    id: "p64",
    label: "P64 — approach phase entered",
    get: "102:41:31",
    tFromPdiSec: getToSeconds("102:41:31") - PDI_GET_SEC,
    altitudeFt: 7_129,
    descentRateFtPerSec: 124.9,
    note: "Automatic transition to the approach phase; LPD becomes available.",
    provenance: {
      workbookSheet: "MissionLog",
      workbookRow: 185,
      classification: "source-derived-reconstruction",
    },
  },
  {
    id: "p66",
    label: "P66 — rate-of-descent (manual landing) phase",
    get: "102:43:22",
    tFromPdiSec: getToSeconds("102:43:22") - PDI_GET_SEC,
    altitudeFt: 410,
    horizontalVelocityFtPerSec: 60.3,
    descentRateFtPerSec: 10,
    note: "Commander takes semi-manual control; ROD commands trim the descent rate.",
    provenance: {
      workbookSheet: "MissionLog",
      workbookRow: 248,
      classification: "source-derived-reconstruction",
    },
  },
  {
    id: "contact",
    label: "Contact light / touchdown",
    get: "102:45:40",
    tFromPdiSec: getToSeconds("102:45:40") - PDI_GET_SEC,
    altitudeFt: 10,
    horizontalVelocityFtPerSec: 2.7,
    descentRateFtPerSec: 0.2,
    note: "Computed altitude at contact; the AGC estimate, not a surveyed height.",
    provenance: {
      workbookSheet: "MissionLog",
      workbookRow: 329,
      classification: "source-derived-reconstruction",
    },
  },
] as const;

export function anchorById(id: DescentPhaseId): DescentPhaseAnchor {
  const a = APOLLO11_DESCENT_PHASE_ANCHORS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown descent phase anchor: ${id}`);
  return a;
}

/** Curated educational timeline events. */
export type TimelineEventKind =
  | "transcript-derived"
  | "telemetry-derived"
  | "explanatory";

export interface DescentTimelineEvent {
  id: string;
  label: string;
  get: string;
  tFromPdiSec: number;
  kind: TimelineEventKind;
  /** One-line teaching note authored for this project. */
  teaching: string;
  altitudeFt?: number;
  provenance: WorkbookProvenance;
}

function ev(
  id: string,
  label: string,
  get: string,
  kind: TimelineEventKind,
  teaching: string,
  row: number,
  classification: WorkbookProvenance["classification"],
  altitudeFt?: number,
): DescentTimelineEvent {
  return {
    id,
    label,
    get,
    tFromPdiSec: getToSeconds(get) - PDI_GET_SEC,
    kind,
    teaching,
    altitudeFt,
    provenance: { workbookSheet: "MissionLog", workbookRow: row, classification },
  };
}

export const APOLLO11_DESCENT_TIMELINE: readonly DescentTimelineEvent[] = [
  ev(
    "p63-ignition",
    "P63 ignition (DPS light-off at minimum throttle)",
    "102:33:05",
    "telemetry-derived",
    "Powered descent starts at 10% thrust so the engine can settle before guidance commands full throttle.",
    18,
    "source-derived-reconstruction",
    49_971,
  ),
  ev(
    "throttle-up",
    "Throttle-up to fixed throttle position",
    "102:33:31",
    "telemetry-derived",
    "26 seconds after ignition the DPS goes to its fixed maximum-thrust setting for the braking phase.",
    23,
    "source-derived-reconstruction",
  ),
  ev(
    "face-up-yaw",
    "Face-up yaw maneuver",
    "102:36:57",
    "transcript-derived",
    "Rolling windows-up points the landing radar at the surface and restores the CSM communications geometry.",
    71,
    "source-derived-reconstruction",
    42_426,
  ),
  ev(
    "lr-data-good",
    "Landing-radar data good",
    "102:37:51",
    "telemetry-derived",
    "The radar begins producing valid altitude; the crew can now compare it against the AGC's own estimate.",
    86,
    "source-derived-reconstruction",
    37_462,
  ),
  ev(
    "v16-n68-deltah",
    "V16 N68 Delta-H monitoring",
    "102:38:11",
    "transcript-derived",
    "Delta-H is the disagreement between radar altitude and the computer's estimated altitude — the go/no-go for accepting radar.",
    95,
    "source-derived-reconstruction",
  ),
  ev(
    "alarm-1202-first",
    "1202 program alarm (Executive overflow — no core sets)",
    "102:38:23",
    "telemetry-derived",
    "The Executive ran out of core sets: more jobs were requested than the AGC could hold. It restarts, sheds low-priority work, and keeps guidance running.",
    101,
    "source-derived-reconstruction",
    34_069,
  ),
  ev(
    "v57-lr-accept",
    "V57 — landing-radar acceptance",
    "102:38:43",
    "transcript-derived",
    "V57 tells the computer to start incorporating radar altitude into its state estimate.",
    107,
    "source-derived-reconstruction",
    31_566,
  ),
  ev(
    "alarm-1202-second",
    "Second 1202 alarm",
    "102:39:02",
    "telemetry-derived",
    "Recurring overload; Mission Control's call was based on whether guidance and the displays stayed healthy, not on the alarm itself.",
    116,
    "source-derived-reconstruction",
    26_977,
  ),
  ev(
    "throttle-down",
    "Throttle-down",
    "102:39:31",
    "telemetry-derived",
    "Guidance drops out of fixed throttle and begins commanding thrust continuously.",
    130,
    "source-derived-reconstruction",
    22_984,
  ),
  ev(
    "p64-transition",
    "P64 approach phase entered",
    "102:41:31",
    "telemetry-derived",
    "The transition is automatic — it happens on guidance progression, not on a crew keystroke.",
    185,
    "source-derived-reconstruction",
    7_129,
  ),
  ev(
    "landing-site-assessment",
    "Landing-site assessment / landing point redesignation",
    "102:43:10",
    "transcript-derived",
    "In P64 the LPD angle lets the commander look through the window and shift the aim point.",
    240,
    "source-derived-reconstruction",
  ),
  ev(
    "att-hold",
    "ATT HOLD selected",
    "102:43:15",
    "transcript-derived",
    "Attitude hold hands attitude authority to the commander ahead of the rate-of-descent takeover.",
    243,
    "source-derived-reconstruction",
    513,
  ),
  ev(
    "p66-takeover",
    "P66 takeover (rate-of-descent mode)",
    "102:43:22",
    "telemetry-derived",
    "P66 is reached through the ATT HOLD / ROD takeover interaction, not by typing a program number.",
    248,
    "source-derived-reconstruction",
    410,
  ),
  ev(
    "lr-dropout",
    "Landing-radar dropouts near the surface",
    "102:44:11",
    "telemetry-derived",
    "Radar data goes bad and good again in the last minute; the estimate has to survive the gaps.",
    280,
    "source-derived-reconstruction",
    232,
  ),
  ev(
    "fuel-low-level",
    "Low-level propellant quantity light",
    "102:44:27",
    "telemetry-derived",
    "The light starts the famous countdown to the bingo call — it measures remaining burn time, not tank volume.",
    290,
    "source-derived-reconstruction",
    166,
  ),
  ev(
    "contact-light",
    "Contact light / touchdown",
    "102:45:40",
    "telemetry-derived",
    "A probe on a landing leg touches first; the crew's cue is the light, then engine stop.",
    329,
    "source-derived-reconstruction",
    10,
  ),
  ev(
    "engine-stop",
    "ENG STOP pushed",
    "102:45:44",
    "transcript-derived",
    "Shutting the DPS down promptly avoids pressurizing the bell against the surface.",
    332,
    "source-derived-reconstruction",
  ),
] as const;

/**
 * The historical progression M4.2 teaches. This is narrative ordering for
 * lessons — it is NOT a keystroke script, and it does not claim to be the
 * exact Apollo 11 cockpit sequence.
 */
export interface ProgressionStage {
  id: string;
  label: string;
  detail: string;
  anchorId?: DescentPhaseId;
  eventId?: string;
}

export const APOLLO11_TEACHING_PROGRESSION: readonly ProgressionStage[] = [
  {
    id: "p63-prep",
    label: "P63 selection and preparation",
    detail:
      "The crew selects the braking program and verifies the descent displays before ignition.",
    anchorId: "pdi-p63",
  },
  {
    id: "ignition-auth",
    label: "Ignition authorization",
    detail: "Ignition is authorized, not automatic — the crew concurs before the engine lights.",
    eventId: "p63-ignition",
  },
  {
    id: "post-ignition-display",
    label: "Post-ignition descent display",
    detail: "Altitude and rate come up on the DSKY and the crew starts cross-checking them.",
    eventId: "throttle-up",
  },
  {
    id: "delta-h",
    label: "Delta-H monitoring",
    detail: "V16 N68 shows the radar-vs-computer altitude disagreement.",
    eventId: "v16-n68-deltah",
  },
  {
    id: "lr-accept",
    label: "Landing-radar acceptance",
    detail: "Once Delta-H is acceptable, V57 lets the radar update the state estimate.",
    eventId: "v57-lr-accept",
  },
  {
    id: "alarm-recognition",
    label: "Alarm recognition",
    detail:
      "Recognize 1201/1202 as Executive overload with restart and load shedding — keep flying if guidance and displays are healthy.",
    eventId: "alarm-1202-first",
  },
  {
    id: "p64-auto",
    label: "Automatic P64 transition",
    detail: "Guidance progression enters the approach phase by itself.",
    anchorId: "p64",
  },
  {
    id: "site-assessment",
    label: "Landing-site assessment",
    detail: "Use the LPD angle to judge the aim point and redesignate if needed.",
    eventId: "landing-site-assessment",
  },
  {
    id: "att-hold-rod",
    label: "ATT HOLD / ROD takeover",
    detail: "Attitude hold plus rate-of-descent commands hand the landing to the commander.",
    eventId: "att-hold",
  },
  {
    id: "p66-control",
    label: "P66-style control",
    detail: "Trim descent rate and null lateral drift down to contact.",
    anchorId: "p66",
  },
] as const;

/**
 * Curated 1201/1202 explanatory content. Narrative only. No rope-cadence
 * claims are imported — the repository's pinned Luminary099 semantics and
 * the M3.3E hardware-interface behaviour remain authoritative.
 */
export interface AlarmTeachingCard {
  id: string;
  title: string;
  body: string;
  provenance: WorkbookProvenance;
}

export const APOLLO11_ALARM_TEACHING: readonly AlarmTeachingCard[] = [
  {
    id: "alarm-overview",
    title: "What 1201 and 1202 mean",
    body:
      "1202 is 'Executive overflow — no core sets'; 1201 is 'Executive overflow — no VAC areas'. Both say the same thing in different words: more jobs were queued than the Executive had storage to run.",
    provenance: {
      workbookSheet: "12011202 alarm",
      workbookRow: 1,
      classification: "secondary-explanation",
    },
  },
  {
    id: "alarm-cycle-stealing",
    title: "Cycle stealing",
    body:
      "Counter interrupts steal memory cycles from running programs. When an unexpected extra load consumed cycles, the AGC's remaining margin was too small to finish every scheduled job in its period.",
    provenance: {
      workbookSheet: "12011202 alarm",
      workbookRow: 1,
      classification: "secondary-explanation",
    },
  },
  {
    id: "alarm-restart",
    title: "Restart and load shedding",
    body:
      "The AGC's response was designed-in: raise the alarm, restart, rebuild the job list from restart points, and shed low-priority work. Guidance and the essential displays survive; the landing continues.",
    provenance: {
      workbookSheet: "12011202 alarm",
      workbookRow: 1,
      classification: "secondary-explanation",
    },
  },
  {
    id: "alarm-response",
    title: "Crew and Mission Control response",
    body:
      "The call was made on whether guidance stayed healthy, not on the alarm code alone. Recurring alarms were acceptable as long as the displays and the trajectory looked right.",
    provenance: {
      workbookSheet: "12011202 alarm",
      workbookRow: 1,
      classification: "secondary-explanation",
    },
  },
] as const;

/** Comparison row used by the debrief. */
export interface HistoricalComparisonRow {
  id: string;
  label: string;
  historical: string;
  player: string;
}

export function buildContactComparison(input: {
  descentRateMps: number;
  horizontalSpeedMps: number;
  altitudeM?: number;
}): HistoricalComparisonRow[] {
  const c = anchorById("contact");
  const fmt = (v: number) => `${v.toFixed(2)} m/s`;
  const rows: HistoricalComparisonRow[] = [
    {
      id: "descent-rate",
      label: "Descent rate at contact",
      historical: `${feetToMeters(c.descentRateFtPerSec ?? 0).toFixed(2)} m/s (${c.descentRateFtPerSec} ft/s)`,
      player: fmt(Math.abs(input.descentRateMps)),
    },
    {
      id: "lateral",
      label: "Lateral velocity at contact",
      historical: `${feetToMeters(c.horizontalVelocityFtPerSec ?? 0).toFixed(2)} m/s (${c.horizontalVelocityFtPerSec} ft/s)`,
      player: fmt(Math.abs(input.horizontalSpeedMps)),
    },
    {
      id: "p66-alt",
      label: "Altitude at P66 takeover",
      historical: `${feetToMeters(anchorById("p66").altitudeFt ?? 0).toFixed(0)} m (${anchorById("p66").altitudeFt} ft)`,
      player:
        input.altitudeM === undefined ? "—" : `${input.altitudeM.toFixed(0)} m`,
    },
  ];
  return rows;
}
