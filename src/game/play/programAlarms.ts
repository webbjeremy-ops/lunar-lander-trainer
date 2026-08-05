// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.8 — Pure 1201 / 1202 program-alarm state machine.
//
// The alarms Apollo 11 took during powered descent are raised here on a
// scripted timeline keyed to reconstructed times, and the crew response
// (read the code with V05 N09 E, then RSET) is required of the player.
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// Our Luminary 099 runs authentically but is not flying the vehicle, so its
// Executive is never loaded the way the flight rope's was and it cannot raise
// a genuine 1202. These alarms are therefore GAME-GENERATED and every consumer
// must label them as a bridged overlay. The player's keystrokes still go to
// the real computer; nothing here is injected into the AGC and nothing here
// reads AGC state.
//
// Deterministic reducer: (state, event) -> state. No timers, no side effects.

import { AGC_KEY, digitKey } from "@/lessons/keyCodes";
import {
  APOLLO11_DESCENT_TIMELINE,
  getToSeconds,
} from "@/content/apollo11PoweredDescentReference";

const S = 1_000_000;

export type ProgramAlarmCode = "1201" | "1202";

export interface ProgramAlarmDefinition {
  readonly id: string;
  readonly code: ProgramAlarmCode;
  /** Seconds after ignition (PDI) at which the alarm is raised. */
  readonly atSinceIgnitionSec: number;
  /**
   * …or the telemetry-derived altitude (feet) the alarm was taken at. The
   * game's planar trajectory does not run at exactly the flown timeline, so
   * whichever condition is met first raises the alarm.
   */
  readonly belowAltitudeFt?: number;
  readonly label: string;
  readonly teaching: string;
}

const PDI_GET_SEC = getToSeconds("102:33:05");

function timelineSeconds(id: string, fallbackGet: string): number {
  const ev = APOLLO11_DESCENT_TIMELINE.find((e) => e.id === id);
  return ev ? ev.tFromPdiSec : getToSeconds(fallbackGet) - PDI_GET_SEC;
}

/**
 * The alarm timeline. The two 1202s take their times from the curated
 * powered-descent reference content rather than being re-entered by hand; the
 * 1201 pair in the approach phase is transcript-derived (102:42:18 and
 * 102:42:43 ground elapsed time).
 */
export const APOLLO11_ALARM_TIMELINE: readonly ProgramAlarmDefinition[] = [
  {
    id: "alarm-1202-first",
    code: "1202",
    atSinceIgnitionSec: timelineSeconds("alarm-1202-first", "102:38:22"),
    // Telemetry-derived altitude at the first 1202 (mission log row 101).
    belowAltitudeFt: 34_069,
    label: "1202 — Executive overflow, no core sets",
    teaching:
      "More jobs were queued than the Executive had core sets to hold. It " +
      "restarts, sheds low-priority work and keeps guidance running.",
  },
  {
    id: "alarm-1202-second",
    code: "1202",
    atSinceIgnitionSec: timelineSeconds("alarm-1202-second", "102:39:02"),
    belowAltitudeFt: 26_977,
    label: "1202 — Executive overflow (recurring)",
    teaching:
      "Recurring overload. Houston's call was based on whether guidance and " +
      "the displays stayed healthy, not on the alarm itself.",
  },
  {
    id: "alarm-1201-first",
    code: "1201",
    atSinceIgnitionSec: getToSeconds("102:42:18") - PDI_GET_SEC,
    // Between the P64 entry (7,129 ft) and ATT HOLD (513 ft) anchors.
    belowAltitudeFt: 3_000,
    label: "1201 — Executive overflow, no VAC areas",
    teaching:
      "Same overload, different exhausted resource: vector accumulator areas " +
      "rather than core sets.",
  },
  {
    id: "alarm-1201-second",
    code: "1202",
    atSinceIgnitionSec: getToSeconds("102:42:43") - PDI_GET_SEC,
    belowAltitudeFt: 1_000,
    label: "1202 — Executive overflow (recurring)",
    teaching:
      "The overload returns in the approach phase with the landing point " +
      "already in the window; guidance and displays stay healthy.",
  },
  {
    id: "alarm-1201-third",
    code: "1202",
    atSinceIgnitionSec: getToSeconds("102:42:58") - PDI_GET_SEC,
    belowAltitudeFt: 800,
    label: "1202 — Executive overflow (recurring)",
    teaching:
      "The last of the descent alarms, taken low on the approach with the " +
      "site in the window.",
  },
] as const;

export const ALARM_CITATION = {
  label:
    "Apollo 11 air-to-ground transcript / Apollo 11 Mission Report / " +
    "Apollo 11 Powered Descent technical-reconstruction workbook",
  detail:
    "Alarm codes and times are reconstructed from the transcript and " +
    "telemetry-derived mission log. The alarms are raised by the game, not by " +
    "the pinned Luminary 099 rope, and are labelled as a bridged overlay.",
} as const;

/** Crew response window used for scoring, seconds. */
export const ALARM_RESPONSE_TARGET_SEC = 30;

export interface ProgramAlarmRecord {
  readonly id: string;
  readonly code: ProgramAlarmCode;
  readonly raisedSinceIgnitionUs: number;
  /** Microseconds from raise to RSET; null while unresolved. */
  readonly clearedAfterUs: number | null;
  readonly codeRead: boolean;
  /** Cleared with the controller shortcut rather than the DSKY sequence. */
  readonly shortcutCleared?: boolean;
}

export interface ProgramAlarmState {
  /** True while the PROG lamp is lit. */
  readonly lampOn: boolean;
  /** The alarm currently displayed, or null. */
  readonly active: ProgramAlarmRecord | null;
  /** Index of the next alarm in the timeline. */
  readonly nextIndex: number;
  readonly history: readonly ProgramAlarmRecord[];
  /** Keys accepted so far toward the V05 N09 E read sequence. */
  readonly readBuffer: number;
  readonly lastMessage: string;
  /** Ignition-relative time the last alarm was raised; null before the first. */
  readonly lastRaisedSinceIgnitionUs: number | null;
}

/**
 * Minimum spacing between two raised alarms. Without it a trajectory that is
 * lower than the flown one satisfies several `belowAltitudeFt` triggers at
 * once and the next alarm re-lights on the tick after RSET, so the lamp looks
 * as if it will not silence. Apollo 11's closest pair was ~25 s apart.
 */
export const ALARM_MIN_SPACING_SEC = 20;

/**
 * How early the altitude trigger may pre-empt the scheduled time. It exists to
 * keep alarms in the right part of the descent, not to fire them minutes early.
 */
export const ALARM_ALTITUDE_LEAD_SEC = 60;


export type ProgramAlarmEvent =
  | {
      readonly kind: "tick";
      readonly sinceIgnitionUs: number;
      /** Current altitude in feet; enables the altitude-based trigger. */
      readonly altitudeFt?: number;
    }
  | { readonly kind: "key"; readonly code: number; readonly sinceIgnitionUs: number }
  /**
   * M4.30 — controller shortcut (RB). The historical clear is V05 N09 E then
   * RSET; on a gamepad that is unusable, so the bumper performs the whole
   * ritual in one press. The record is still marked `codeRead`, but the flight
   * log keeps it distinguishable through `shortcutCleared`.
   */
  | { readonly kind: "cancel"; readonly sinceIgnitionUs: number };

/** V05 N09 E — display the alarm code from the AGC's alarm register. */
export const ALARM_READ_KEYS: readonly number[] = [
  AGC_KEY.VERB,
  digitKey(0),
  digitKey(5),
  AGC_KEY.NOUN,
  digitKey(0),
  digitKey(9),
  AGC_KEY.ENTR,
];

export function createProgramAlarmState(): ProgramAlarmState {
  return {
    lampOn: false,
    active: null,
    nextIndex: 0,
    history: [],
    readBuffer: 0,
    lastMessage: "No program alarms.",
    lastRaisedSinceIgnitionUs: null,
  };
}

export function reduceProgramAlarms(
  state: ProgramAlarmState,
  event: ProgramAlarmEvent,
  timeline: readonly ProgramAlarmDefinition[] = APOLLO11_ALARM_TIMELINE,
): ProgramAlarmState {
  switch (event.kind) {
    case "tick": {
      const def = timeline[state.nextIndex];
      if (def === undefined) return state;
      // M4.61 — alarms are TIME events, full stop. The altitude column is kept
      // as reference (and shown in the debrief), but it may no longer pre-empt
      // the clock: a trajectory a little low used to raise the 1202 seconds
      // before Aldrin's recorded "twelve-oh-two" call, so lamp and voice
      // disagreed. Both now key off the same ignition-relative second.
      const dueByTime = event.sinceIgnitionUs >= def.atSinceIgnitionSec * S;
      if (!dueByTime) return state;

      // Never stack two alarms on top of each other: a low trajectory can
      // satisfy several altitude triggers at once, which would re-light the
      // lamp on the tick after the crew cleared it.
      if (
        state.lastRaisedSinceIgnitionUs !== null &&
        event.sinceIgnitionUs - state.lastRaisedSinceIgnitionUs <
          ALARM_MIN_SPACING_SEC * S
      ) {
        return state;
      }

      // A new alarm supersedes an unanswered one; the unanswered alarm is
      // recorded as such.
      const history =
        state.active === null ? state.history : [...state.history, state.active];
      const active: ProgramAlarmRecord = {
        id: def.id,
        code: def.code,
        raisedSinceIgnitionUs: event.sinceIgnitionUs,
        clearedAfterUs: null,
        codeRead: false,
      };
      return {
        ...state,
        lampOn: true,
        active,
        nextIndex: state.nextIndex + 1,
        history,
        readBuffer: 0,
        lastMessage: `PROG — ${def.label}. Key V05 N09 E to read the code, then RSET.`,
        lastRaisedSinceIgnitionUs: event.sinceIgnitionUs,
      };
    }


    case "cancel": {
      const active = state.active;
      if (active === null) return state;
      const cleared: ProgramAlarmRecord = {
        ...active,
        codeRead: true,
        shortcutCleared: true,
        clearedAfterUs: Math.max(0, event.sinceIgnitionUs - active.raisedSinceIgnitionUs),
      };
      return {
        ...state,
        lampOn: false,
        active: null,
        history: [...state.history, cleared],
        readBuffer: 0,
        lastMessage: `${active.code} cleared from the controller. Houston: "We're GO on that alarm."`,
      };
    }

    case "key": {
      const active = state.active;
      if (active === null) return state;

      if (event.code === AGC_KEY.RSET) {
        if (!active.codeRead) {
          return {
            ...state,
            lastMessage:
              "RSET before reading the code — key V05 N09 E first so you know " +
              "which alarm you are clearing.",
          };
        }
        const cleared: ProgramAlarmRecord = {
          ...active,
          clearedAfterUs: Math.max(0, event.sinceIgnitionUs - active.raisedSinceIgnitionUs),
        };
        return {
          ...state,
          lampOn: false,
          active: null,
          history: [...state.history, cleared],
          readBuffer: 0,
          lastMessage: `${active.code} cleared. Houston: "We're GO on that alarm."`,
        };
      }

      if (active.codeRead) return state;

      const expected = ALARM_READ_KEYS[state.readBuffer];
      if (expected === undefined) return state;
      if (event.code !== expected) {
        return state.readBuffer === 0
          ? state
          : { ...state, readBuffer: 0, lastMessage: "Read sequence broken — key V05 N09 E again." };
      }

      const readBuffer = state.readBuffer + 1;
      if (readBuffer < ALARM_READ_KEYS.length) {
        return { ...state, readBuffer };
      }
      return {
        ...state,
        readBuffer: 0,
        active: { ...active, codeRead: true },
        lastMessage: `Alarm code ${active.code} read out. Press RSET to clear the lamp.`,
      };
    }
  }
}

// --- Derived helpers ---------------------------------------------------------

/** The bridged DSKY overlay this alarm state asks the panel to display. */
export interface BridgedAlarmOverlay {
  readonly verb: string;
  readonly noun: string;
  readonly flashing: boolean;
  readonly label: string;
  readonly variant: "alarm";
  readonly code: string;
}

export function bridgedAlarmFor(state: ProgramAlarmState): BridgedAlarmOverlay | null {
  const active = state.active;
  if (active === null || !state.lampOn) return null;
  return {
    verb: "05",
    noun: "09",
    flashing: !active.codeRead,
    label: active.codeRead ? "PRESS RSET TO CLEAR" : "PROG ALARM — KEY V05 N09 E",
    variant: "alarm",
    code: active.code,
  };
}

export interface AlarmScoreInput {
  readonly raised: number;
  readonly cleared: number;
  readonly unresolved: number;
  /** Mean seconds from alarm to RSET over cleared alarms; 0 when none. */
  readonly meanResponseSeconds: number;
}

/** Roll the alarm history (including any still-active alarm) into a score input. */
export function summarizeAlarms(state: ProgramAlarmState): AlarmScoreInput {
  const all = state.active === null ? state.history : [...state.history, state.active];
  const cleared = all.filter((a) => a.clearedAfterUs !== null);
  const totalUs = cleared.reduce((sum, a) => sum + (a.clearedAfterUs ?? 0), 0);
  return {
    raised: all.length,
    cleared: cleared.length,
    unresolved: all.length - cleared.length,
    meanResponseSeconds: cleared.length === 0 ? 0 : totalUs / cleared.length / S,
  };
}

export function definitionFor(id: string): ProgramAlarmDefinition | null {
  return APOLLO11_ALARM_TIMELINE.find((a) => a.id === id) ?? null;
}
