// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — DSKY procedure scripts.
//
// The player operates the REAL DSKY keypad; every keystroke is delivered to
// the live Luminary099 session over the existing typed protocol. This module
// only describes what the player is expected to key and when, and never
// injects keystrokes on the player's behalf.
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// The AGC in this project runs authentic Luminary099, but it is NOT flying
// the vehicle: the physics firewall (M3.3E) forbids closed-loop AGC control.
// Therefore some display states a real crew would have seen — a flashing
// V99 ignition request, the P64 landing-point-designator display, the P66
// rate-of-descent mode — are not produced by the rope in this configuration.
// Steps marked `bridged: true` are exactly those states. For a bridged step
// the game:
//   1. still requires the player to key the authentic keystrokes,
//   2. still forwards them to the real AGC,
//   3. labels the step as bridged in the UI, and
//   4. advances its own procedure state machine rather than waiting for a
//      rope-produced display it cannot legitimately produce.
// Nothing is faked on the DSKY itself: the DSKY always shows what Luminary099
// actually drove onto channel 010.

import { AGC_KEY, digitKey } from "@/lessons/keyCodes";
import type { ControlModeId, MissionId, PlayPhase } from "./types";

export type ProcedureKey = number;

export interface ProcedureCitation {
  readonly label: string;
  readonly detail: string;
}

export interface DskyProcedureStep {
  readonly id: string;
  readonly title: string;
  /** What the player must do, in crew-procedure language. */
  readonly instruction: string;
  /** Human-readable keystroke line, e.g. "V37E 63E". */
  readonly keystrokes: string;
  /** Exact ordered AGC key codes the player must press. */
  readonly expected: readonly ProcedureKey[];
  readonly phase: PlayPhase;
  /** Coarse mission phase label surfaced in the UI. */
  readonly programLabel: string;
  readonly hint: string;
  readonly citation: ProcedureCitation;
  /** See "Historically Grounded Procedure Bridge" above. */
  readonly bridged: boolean;
  /** Completing this step hands manual flight control to the player. */
  readonly unlocksManualControl?: boolean;
  /**
   * The step is refused unless the descent engine has been armed on the
   * cockpit panel first (Aldrin's ENG ARM — DESCENT switch).
   */
  readonly requiresEngineArm?: boolean;
  /**
   * The step is refused until the vehicle has been rolled windows-up, because
   * the landing radar cannot see the surface while the vehicle is face-down.
   */
  readonly requiresWindowsUp?: boolean;
  /** The step is refused unless a program alarm is currently lit. */
  readonly requiresAlarm?: boolean;
  /** Completing this step starts the PDI countdown clock. */
  readonly startsIgnitionCountdown?: boolean;
  /** Completing this step releases the flight-control lock for guided flight. */
  readonly releasesFlightLock?: boolean;
}

export interface DskyProcedureScript {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly steps: readonly DskyProcedureStep[];
}

// -----------------------------------------------------------------------------
// Keystroke builders
// -----------------------------------------------------------------------------

function digits(n: number, count: number): ProcedureKey[] {
  const s = String(Math.trunc(Math.abs(n))).padStart(count, "0");
  return s.split("").map((c) => digitKey(Number(c)));
}

/** V37E nnE — major-mode (program) change. */
export function majorModeKeys(program: number): ProcedureKey[] {
  return [
    AGC_KEY.VERB,
    ...digits(37, 2),
    AGC_KEY.ENTR,
    ...digits(program, 2),
    AGC_KEY.ENTR,
  ];
}

/** Vvv E — a verb with no noun (e.g. V57 landing-radar acceptance). */
export function verbKeys(verb: number): ProcedureKey[] {
  return [AGC_KEY.VERB, ...digits(verb, 2), AGC_KEY.ENTR];
}

/** Vvv Nnn E — verb/noun display request. */
export function verbNounKeys(verb: number, noun: number): ProcedureKey[] {
  return [
    AGC_KEY.VERB,
    ...digits(verb, 2),
    AGC_KEY.NOUN,
    ...digits(noun, 2),
    AGC_KEY.ENTR,
  ];
}

export const PROCEED_KEYS: readonly ProcedureKey[] = [AGC_KEY.PRO];

const GSOP: ProcedureCitation = {
  label: "Luminary 099 / LM GSOP R-567",
  detail:
    "Program numbers and monitor verb/noun pairs follow the Luminary 099 " +
    "assembly listing and the published LM Guidance System Operations Plan.",
};

const FLIGHT_PLAN: ProcedureCitation = {
  label: "Apollo 11 Flight Plan / Lunar Module Timeline Book",
  detail:
    "Crew keystroke order for powered descent (P63 select, ignition PRO, " +
    "P64 approach monitoring, P66 takeover) follows the published timeline.",
};

// -----------------------------------------------------------------------------
// Scripts
// -----------------------------------------------------------------------------

const POWERED_DESCENT_STEPS: readonly DskyProcedureStep[] = [
  {
    id: "p63-select",
    title: "Select P63 — Braking Phase",
    instruction:
      "Key the braking-phase program into the AGC. The computer answers on " +
      "the real DSKY.",
    keystrokes: "V37 E 6 3 E",
    expected: majorModeKeys(63),
    phase: "procedure",
    programLabel: "P63",
    hint: "VERB · 3 · 7 · ENTR, then 6 · 3 · ENTR.",
    citation: GSOP,
    bridged: false,
  },
  {
    id: "p63-monitor",
    title: "Call the pre-ignition monitor",
    instruction:
      "Request the monitored display the crew watched down to ignition.",
    keystrokes: "V16 N62 E",
    expected: verbNounKeys(16, 62),
    phase: "procedure",
    programLabel: "P63",
    hint: "VERB · 1 · 6 · NOUN · 6 · 2 · ENTR.",
    citation: GSOP,
    bridged: false,
    startsIgnitionCountdown: true,
  },
  {
    id: "pdi-proceed",
    title: "Arm the descent engine, then enable ignition",
    instruction:
      "Aldrin's job: set ENG ARM to DESCENT on the cockpit panel. At TIG-35 s " +
      "the computer flashes V99 N62 asking permission to ignite — answer it " +
      "with PROCEED. PRO is refused while ENG ARM is off.",
    keystrokes: "ENG ARM · DES, then PRO",
    expected: [...PROCEED_KEYS],
    phase: "procedure",
    programLabel: "P63 · PDI",
    hint: "Throw ENG ARM to DESCENT in the ignition panel, then press PRO (keyboard: P).",
    citation: FLIGHT_PLAN,
    bridged: true,
    requiresEngineArm: true,
    releasesFlightLock: true,
  },
  {
    id: "p64-monitor",
    title: "Approach phase — landing-point data",
    instruction:
      "At high gate the vehicle pitches up and the site comes into view. " +
      "Call the approach-phase display.",
    keystrokes: "V06 N64 E",
    expected: verbNounKeys(6, 64),
    phase: "guided-flight",
    programLabel: "P64",
    hint: "VERB · 0 · 6 · NOUN · 6 · 4 · ENTR.",
    citation: GSOP,
    bridged: true,
  },
  {
    id: "p66-takeover",
    title: "Take P66 — rate of descent",
    instruction:
      "Take semi-manual control: attitude is yours, and the throttle trims " +
      "the sink rate. Armstrong flew the last stretch this way.",
    keystrokes: "V37 E 6 6 E",
    expected: majorModeKeys(66),
    phase: "manual-flight",
    programLabel: "P66",
    hint: "VERB · 3 · 7 · ENTR, then 6 · 6 · ENTR.",
    citation: FLIGHT_PLAN,
    bridged: true,
    unlocksManualControl: true,
    releasesFlightLock: true,
  },
];

// M4.8 — Apollo 11 only: the windows-up roll, radar acceptance and the
// program-alarm response. These sit between ignition and the approach phase.
const APOLLO11_EXTRA_STEPS: readonly DskyProcedureStep[] = [
  {
    id: "roll-windows-up",
    title: "Roll windows-up, then check Delta-H",
    instruction:
      "Eagle flew the early braking phase face-down. Roll 180° to windows-up " +
      "on the cockpit ROLL control so the landing-radar antenna looks at the " +
      "surface, then call the Delta-H display to compare radar altitude with " +
      "the computer's estimate.",
    keystrokes: "ROLL · WINDOWS UP, then V16 N68 E",
    expected: verbNounKeys(16, 68),
    phase: "guided-flight",
    programLabel: "P63 · roll",
    hint: "Hold ROLL (keyboard: R) until the indicator reads WINDOWS UP, then VERB · 1 · 6 · NOUN · 6 · 8 · ENTR.",
    citation: FLIGHT_PLAN,
    bridged: true,
    requiresWindowsUp: true,
  },
  {
    id: "lr-accept",
    title: "Accept the landing radar",
    instruction:
      "With Delta-H small enough to trust, tell the computer to start " +
      "incorporating radar altitude into its state estimate.",
    keystrokes: "V57 E",
    expected: verbKeys(57),
    phase: "guided-flight",
    programLabel: "P63 · LR",
    hint: "VERB · 5 · 7 · ENTR.",
    citation: FLIGHT_PLAN,
    bridged: true,
    requiresWindowsUp: true,
  },
  {
    id: "alarm-response",
    title: "Answer the program alarm",
    instruction:
      "A program alarm will light during the braking phase. Read the code " +
      "with V05 N09 E, then clear the lamp with RSET. Keep flying: the call " +
      "is made on whether guidance and the displays stay healthy.",
    keystrokes: "V05 N09 E, then RSET",
    expected: [...verbNounKeys(5, 9), AGC_KEY.RSET],
    phase: "guided-flight",
    programLabel: "P63 · alarm",
    hint: "Wait for the PROG lamp, then VERB · 0 · 5 · NOUN · 0 · 9 · ENTR, then RSET.",
    citation: FLIGHT_PLAN,
    bridged: true,
    requiresAlarm: true,
  },
];

const APOLLO11_STEPS: readonly DskyProcedureStep[] = [
  ...POWERED_DESCENT_STEPS.slice(0, 3),
  ...APOLLO11_EXTRA_STEPS,
  ...POWERED_DESCENT_STEPS.slice(3),
];

const TERMINAL_STEPS: readonly DskyProcedureStep[] = [
  POWERED_DESCENT_STEPS[0]!,
  // Terminal descent begins below high gate: there is no PDI countdown here.
  { ...POWERED_DESCENT_STEPS[1]!, startsIgnitionCountdown: false },
  {
    ...POWERED_DESCENT_STEPS[4]!,
    instruction:
      "You are already in the low-gate region. Take P66 and fly it down.",
  },
];

export const POWERED_DESCENT_SCRIPT: DskyProcedureScript = {
  id: "apollo11-powered-descent-v1",
  version: 1,
  title: "Powered descent — P63 / P64 / P66",
  steps: POWERED_DESCENT_STEPS,
};

/**
 * M4.8 — the full Apollo 11 flight, including the windows-up roll, landing-
 * radar acceptance and the 1201/1202 program-alarm response. Other missions
 * keep the shorter POWERED_DESCENT_SCRIPT.
 */
export const APOLLO11_DESCENT_SCRIPT: DskyProcedureScript = {
  id: "apollo11-powered-descent-v2",
  version: 2,
  title: "Apollo 11 powered descent — roll, radar, alarms",
  steps: APOLLO11_STEPS,
};

export const TERMINAL_DESCENT_SCRIPT: DskyProcedureScript = {
  id: "terminal-descent-v1",
  version: 1,
  title: "Terminal descent — P63 monitor, P66 takeover",
  steps: TERMINAL_STEPS,
};

export const EMPTY_SCRIPT: DskyProcedureScript = {
  id: "quick-manual-v1",
  version: 1,
  title: "Quick manual — no DSKY procedure",
  steps: [],
};

export const PROCEDURE_SCRIPTS: readonly DskyProcedureScript[] = [
  POWERED_DESCENT_SCRIPT,
  APOLLO11_DESCENT_SCRIPT,
  TERMINAL_DESCENT_SCRIPT,
  EMPTY_SCRIPT,
];

/** Pick the script for a mission + control mode combination. */
export function scriptFor(
  missionId: MissionId,
  mode: ControlModeId,
): DskyProcedureScript {
  if (mode === "quick-manual") return EMPTY_SCRIPT;
  if (missionId === "full-descent") return APOLLO11_DESCENT_SCRIPT;
  if (missionId === "free-flight") return EMPTY_SCRIPT;
  return TERMINAL_DESCENT_SCRIPT;
}

/** True when this mission flies the Apollo 11 roll + program-alarm timeline. */
export function usesApollo11Timeline(script: DskyProcedureScript): boolean {
  return script.id === APOLLO11_DESCENT_SCRIPT.id;
}

export function describeKey(code: ProcedureKey): string {
  switch (code) {
    case AGC_KEY.VERB: return "VERB";
    case AGC_KEY.NOUN: return "NOUN";
    case AGC_KEY.ENTR: return "ENTR";
    case AGC_KEY.CLR: return "CLR";
    case AGC_KEY.PLUS: return "+";
    case AGC_KEY.MINUS: return "−";
    case AGC_KEY.RSET: return "RSET";
    case AGC_KEY.KEY_REL: return "KEY REL";
    case AGC_KEY.PRO: return "PRO";
    case AGC_KEY.DIGIT_0: return "0";
    default:
      return code >= 1 && code <= 9 ? String(code) : `0o${code.toString(8)}`;
  }
}
