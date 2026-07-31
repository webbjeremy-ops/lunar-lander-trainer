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
  },
  {
    id: "pdi-proceed",
    title: "Enable engine ignition",
    instruction:
      "The crew answered the ignition request with PROCEED. Press PRO to " +
      "commit to powered descent.",
    keystrokes: "PRO",
    expected: [...PROCEED_KEYS],
    phase: "procedure",
    programLabel: "P63 · PDI",
    hint: "Press the PRO key (keyboard: P).",
    citation: FLIGHT_PLAN,
    bridged: true,
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

const TERMINAL_STEPS: readonly DskyProcedureStep[] = [
  POWERED_DESCENT_STEPS[0]!,
  POWERED_DESCENT_STEPS[1]!,
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
  TERMINAL_DESCENT_SCRIPT,
  EMPTY_SCRIPT,
];

/** Pick the script for a mission + control mode combination. */
export function scriptFor(
  missionId: MissionId,
  mode: ControlModeId,
): DskyProcedureScript {
  if (mode === "quick-manual") return EMPTY_SCRIPT;
  if (missionId === "apollo11-powered-descent" || missionId === "high-gate-challenge") {
    return POWERED_DESCENT_SCRIPT;
  }
  if (missionId === "free-flight") return EMPTY_SCRIPT;
  return TERMINAL_DESCENT_SCRIPT;
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
