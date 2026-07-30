// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C §6 — PURE Channel 13 radar-request decoder.
//
// No WASM, no Worker, no timers, no mutable module state. It converts the
// lossless stream of Luminary099 CHAN13 output writes into immutable
// radar-request events, so that a host radar response can NEVER be produced
// by anything other than an authentic, AGC-issued solicitation.
//
// PRIMARY SOURCE (pinned Luminary099, chrislgarry/Apollo-11 @ 911e5c0)
//
//   INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc, "CHANNEL 13 CHAN13; OUTPUT
//   CHANNEL":
//     BIT 1  RADAR C   \
//     BIT 2  RADAR B    >  "PROPER SETTING OF THE A,B,C MATRIX SELECTS
//     BIT 3  RADAR A   /    CERTAIN RADAR PARAMETERS TO BE READ."
//     BIT 4  RADAR ACTIVITY
//
//   P20-P25.agc "RADAR READ INITIALIZATION" (p.553) — the lead-in table
//   gives the literal A,B,C+ACTIVITY word each read writes:
//     LRALT   TC INITREAD -1 ; ALLREAD OCT 17   (select 7 + ACTIVITY)
//     LRVELZ  TC INITREAD    ;         OCT 16   (select 6 + ACTIVITY)
//     LRVELY  TC INITREAD    ;         OCT 15   (select 5 + ACTIVITY)
//     LRVELX  TC INITREAD    ;         OCT 14   (select 4 + ACTIVITY)
//     RRRDOT  TC INITREAD -1 ;         OCT 12   (select 2 + ACTIVITY)
//     RRRANGE TC INITREAD -1 ;         OCT 11   (select 1 + ACTIVITY)
//
//   P20-P25.agc INITREAD (p.554):
//     CS ALLREAD / EXTEND / WAND CHAN13   "REMOVE ALL RADAR BITS"
//     INDEX Q / CAF 0 / EXTEND / WOR CHAN13  "SET NEW RADAR BITS"
//   i.e. every read is a clear-then-set edge on bits 1-4. The retained
//   level is therefore NOT a repeat request: only a fresh transition from
//   ACTIVITY-clear to ACTIVITY-set is a solicitation.
//
//   P20-P25.agc RADAREAD (p.555) — the RADARUPT handler reads the counter
//   and resets the ACTIVITY bit (`CAF BIT4 ... WOR CHAN13` / `RXOR CHAN13`);
//   ONE RADARUPT delivers ONE data word chosen by bits 1-3.
//
// SCOPE — this module DECODES every documented selection but marks only the
// landing-radar altitude selection (OCT 17) as answerable. Everything else
// yields an explicit diagnostic and no data: fabricating LR velocity or
// rendezvous-radar words is prohibited (docs/M3_3B2_SCALE_ARCHAEOLOGY.md).

/** CHAN13 output channel number. */
export const CHAN13 = 0o13;

/** Bits 1-3, the A/B/C radar-select matrix. */
export const CHAN13_RADAR_SELECT_MASK = 0o7;

/** Bit 4, RADAR ACTIVITY. */
export const CHAN13_RADAR_ACTIVITY_BIT = 0o10;

/** `ALLREAD OCT 17` — every radar bit, cleared by INITREAD before each read. */
export const CHAN13_ALL_RADAR_BITS = 0o17;

export type RadarSelection =
  | "none"
  | "rr-range"
  | "rr-range-rate"
  | "unassigned-3"
  | "lr-velocity-x"
  | "lr-velocity-y"
  | "lr-velocity-z"
  | "lr-altitude";

/** Select code (bits 1-3) → selection, straight from the lead-in table. */
export const RADAR_SELECTION_BY_CODE: Readonly<Record<number, RadarSelection>> = {
  0: "none",
  1: "rr-range",
  2: "rr-range-rate",
  3: "unassigned-3",
  4: "lr-velocity-x",
  5: "lr-velocity-y",
  6: "lr-velocity-z",
  7: "lr-altitude",
} as const;

export const RADAR_SELECTION_SOURCE: Readonly<Record<RadarSelection, string>> = {
  "none": "no radar bits set (INITREAD CS ALLREAD / WAND CHAN13 clear state)",
  "rr-range": "Luminary099/P20-P25.agc RRRANGE lead-in, OCT 11",
  "rr-range-rate": "Luminary099/P20-P25.agc RRRDOT lead-in, OCT 12",
  "unassigned-3": "no lead-in in Luminary099 P20-P25.agc writes select code 3",
  "lr-velocity-x": "Luminary099/P20-P25.agc LRVELX lead-in, OCT 14",
  "lr-velocity-y": "Luminary099/P20-P25.agc LRVELY lead-in, OCT 15",
  "lr-velocity-z": "Luminary099/P20-P25.agc LRVELZ lead-in, OCT 16",
  "lr-altitude": "Luminary099/P20-P25.agc LRALT lead-in, ALLREAD OCT 17",
} as const;

/** The ONLY selection this milestone answers. */
export const ANSWERABLE_SELECTION: RadarSelection = "lr-altitude";

export type RadarRequestRefusal =
  | "selection-not-implemented-lr-velocity"
  | "selection-not-implemented-rendezvous-radar"
  | "selection-unassigned-in-luminary099";

export function refusalFor(selection: RadarSelection): RadarRequestRefusal | null {
  switch (selection) {
    case "lr-altitude":
      return null;
    case "lr-velocity-x":
    case "lr-velocity-y":
    case "lr-velocity-z":
      return "selection-not-implemented-lr-velocity";
    case "rr-range":
    case "rr-range-rate":
      return "selection-not-implemented-rendezvous-radar";
    case "unassigned-3":
      return "selection-unassigned-in-luminary099";
    case "none":
      return null;
  }
}

/** An immutable, AGC-originated radar solicitation. */
export interface Chan13RadarRequest {
  readonly kind: "chan13-radar-request";
  /** Monotonic per-epoch sequence number. */
  readonly sequence: number;
  /** Raw CHAN13 word exactly as Luminary wrote it. */
  readonly rawWord: number;
  readonly rawWordOctal: string;
  /** Bits 1-4 only. */
  readonly radarBits: number;
  readonly selectCode: number;
  readonly selection: RadarSelection;
  readonly activity: true;
  /** Emulator cycle at which the write was observed. */
  readonly agcCycle: number;
  readonly missionTimeUs: number;
  /** null when the host may answer, otherwise the explicit refusal. */
  readonly refusal: RadarRequestRefusal | null;
  readonly sourceCitation: string;
}

export interface Chan13ObserverState {
  readonly kind: "chan13-observer-state-v1";
  /** Last retained radar bits (1-4) seen on CHAN13; -1 before any write. */
  readonly retainedRadarBits: number;
  readonly sequence: number;
  /** A request awaiting exactly one host response, or null. */
  readonly outstanding: Chan13RadarRequest | null;
  readonly requestCount: number;
  readonly refusedCount: number;
  readonly duplicateSuppressedCount: number;
}

export function createChan13ObserverState(): Chan13ObserverState {
  return {
    kind: "chan13-observer-state-v1",
    retainedRadarBits: -1,
    sequence: 0,
    outstanding: null,
    requestCount: 0,
    refusedCount: 0,
    duplicateSuppressedCount: 0,
  };
}

/** One observed CHAN13 output write, taken losslessly from the AGC output
 *  packet stream. */
export interface Chan13Write {
  readonly channel: number;
  readonly word: number;
  readonly agcCycle: number;
  readonly missionTimeUs: number;
}

export interface Chan13ObserveResult {
  readonly nextState: Chan13ObserverState;
  /** Emitted at most once per write, only on a genuine new solicitation. */
  readonly request: Chan13RadarRequest | null;
  readonly duplicateSuppressed: boolean;
}

/**
 * Fold one CHAN13 write into the observer state.
 *
 * A request is emitted only when ALL hold:
 *   * the write is on CHAN13;
 *   * RADAR ACTIVITY (bit 4) is set;
 *   * the select code (bits 1-3) is non-zero;
 *   * bits 1-4 differ from the retained level (INITREAD's clear-then-set
 *     edge), so a merely retained level never re-requests;
 *   * no earlier request is still outstanding — one AGC solicitation may
 *     cause at most one host response.
 */
export function observeChan13Write(
  state: Chan13ObserverState,
  write: Chan13Write,
): Chan13ObserveResult {
  if (write.channel !== CHAN13) {
    return { nextState: state, request: null, duplicateSuppressed: false };
  }
  const radarBits = write.word & CHAN13_ALL_RADAR_BITS;
  const activity = (radarBits & CHAN13_RADAR_ACTIVITY_BIT) !== 0;
  const selectCode = radarBits & CHAN13_RADAR_SELECT_MASK;

  if (!activity || selectCode === 0) {
    // ACTIVITY reset (RADAREAD) or all bits removed (INITREAD's WAND).
    return {
      nextState: { ...state, retainedRadarBits: radarBits },
      request: null,
      duplicateSuppressed: false,
    };
  }

  if (radarBits === state.retainedRadarBits) {
    return {
      nextState: {
        ...state,
        duplicateSuppressedCount: state.duplicateSuppressedCount + 1,
      },
      request: null,
      duplicateSuppressed: true,
    };
  }

  if (state.outstanding !== null) {
    // A previous solicitation has not been answered; do not stack a second
    // response onto the same transaction.
    return {
      nextState: {
        ...state,
        retainedRadarBits: radarBits,
        duplicateSuppressedCount: state.duplicateSuppressedCount + 1,
      },
      request: null,
      duplicateSuppressed: true,
    };
  }

  const selection = RADAR_SELECTION_BY_CODE[selectCode];
  const refusal = refusalFor(selection);
  const sequence = state.sequence + 1;
  const request: Chan13RadarRequest = {
    kind: "chan13-radar-request",
    sequence,
    rawWord: write.word,
    rawWordOctal: `0o${write.word.toString(8)}`,
    radarBits,
    selectCode,
    selection,
    activity: true,
    agcCycle: write.agcCycle,
    missionTimeUs: write.missionTimeUs,
    refusal,
    sourceCitation: RADAR_SELECTION_SOURCE[selection],
  };
  return {
    nextState: {
      ...state,
      retainedRadarBits: radarBits,
      sequence,
      outstanding: refusal === null ? request : null,
      requestCount: state.requestCount + 1,
      refusedCount: state.refusedCount + (refusal === null ? 0 : 1),
    },
    request,
    duplicateSuppressed: false,
  };
}

/** Mark the single outstanding solicitation as answered by the host. */
export function completeOutstandingRequest(
  state: Chan13ObserverState,
  sequence: number,
): Chan13ObserverState {
  if (state.outstanding === null || state.outstanding.sequence !== sequence) return state;
  return { ...state, outstanding: null };
}
