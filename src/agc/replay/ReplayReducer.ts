// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pure deterministic replay reducer for a validated event-log recording.
//
// This module has NO React, NO Worker, NO timers, and NO I/O. Given the
// baseline captured at the start of the recorded epoch plus the ordered
// event list from the same payload, it reconstructs the recorded DSKY and
// channel-value state at any event index using the SAME `DskyDecoder` used
// by live capture. Two calls with the same inputs return byte-identical
// output (verified by unit tests via `decodedDskyCanonical`).
//
// Semantics
//   * `currentEventIndex === -1` is the baseline (no events applied).
//   * `applyNext(state, event)` advances by exactly one event.
//   * `channelUpdate` writes `channelValues[channel]` and, if the channel is
//     a DSKY channel (010/011/0163), the decoded DSKY is updated by the
//     canonical decoder. Duplicate-value writes are still applied — each
//     event exists independently in the log.
//   * `inputAccepted` NEVER touches `channelValues` or `decodedDsky`; it
//     only advances tick/MET/steps and the currentEvent cursor. Input events
//     are metadata in the recording — the AGC's actual response was already
//     captured as later channelUpdate events.
//
// Live isolation: the reducer never references `AgcWorkerClient`, the
// shared session, `window`, `crypto`, or any global timer. A caller can run
// an entire replay against an imported recording and be certain no live
// AGC state is touched.

import type {
  AgcEventLogPayloadV1,
  ExportedAgcEvent,
} from "../eventLog/schema";
import type { ImportResult } from "../eventLog/importSchema";
import type { DecodedDsky } from "../dsky/DskyTypes";
import {
  applyDskyChannelEvent,
  makeEmptyDecodedDsky,
} from "../dsky/DskyDecoder";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ReplayStatus = "idle" | "paused" | "playing" | "finished";

export interface ReplayState {
  status: ReplayStatus;
  /** -1 = baseline; N = events[N] just applied. */
  currentEventIndex: number;
  currentEventId: number | null;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  /** Decoded DSKY reconstructed from baseline + applied channel writes. */
  decodedDsky: DecodedDsky;
  /** Latest AGC output value seen per channel, keyed by decimal channel #. */
  channelValues: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Slider / index conversion helpers
//
// Slider domain is [0, events.length]. Slider 0 = baseline (index -1);
// slider N = events[N - 1]. This keeps the baseline and event zero
// visually distinct in the UI and prevents off-by-one bugs.
// ---------------------------------------------------------------------------

export function sliderValueToEventIndex(value: number): number {
  return Math.trunc(value) - 1;
}

export function eventIndexToSliderValue(index: number): number {
  return index + 1;
}

export function clampIndex(index: number, eventCount: number): number {
  if (!Number.isFinite(index)) return -1;
  if (index < -1) return -1;
  if (index > eventCount - 1) return eventCount - 1;
  return Math.trunc(index);
}

// ---------------------------------------------------------------------------
// Deep clone
// ---------------------------------------------------------------------------

function cloneDecoded(d: DecodedDsky): DecodedDsky {
  // DecodedDsky is a tree of plain data (numbers, strings, nulls, booleans).
  // structuredClone would work but JSON round-tripping is faster and matches
  // the canonicalisation contract used elsewhere in the codebase.
  return JSON.parse(JSON.stringify(d)) as DecodedDsky;
}

function cloneChannelValues(v: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in v) out[k] = v[k]!;
  return out;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

export function initReplayState(payload: AgcEventLogPayloadV1): ReplayState {
  // Baseline is a lossless snapshot; we clone it so downstream mutation
  // through reducer transitions cannot poison the validated recording.
  const decoded = payload.baseline.decodedDsky
    ? cloneDecoded(payload.baseline.decodedDsky)
    : makeEmptyDecodedDsky();
  const channels = cloneChannelValues(payload.baseline.channelValues ?? {});
  return {
    status: "idle",
    currentEventIndex: -1,
    currentEventId: null,
    tickIndex: payload.baseline.tickIndex,
    missionTimeUs: payload.baseline.missionTimeUs,
    totalAgcSteps: payload.baseline.totalAgcSteps,
    decodedDsky: decoded,
    channelValues: channels,
  };
}

// ---------------------------------------------------------------------------
// applyNext / reconstructAt
// ---------------------------------------------------------------------------

/** Return a new state with `event` applied. Callers must pass events in
 *  strict recorded order. */
export function applyNext(
  state: ReplayState,
  event: ExportedAgcEvent,
  newIndex: number,
): ReplayState {
  const next: ReplayState = {
    status: state.status,
    currentEventIndex: newIndex,
    currentEventId: event.eventId,
    tickIndex: event.tickIndex,
    missionTimeUs: event.missionTimeUs,
    totalAgcSteps: event.totalAgcSteps,
    // Only clone if we're about to mutate.
    decodedDsky: state.decodedDsky,
    channelValues: state.channelValues,
  };
  if (event.type === "channelUpdate") {
    const channels = cloneChannelValues(state.channelValues);
    channels[String(event.channel)] = event.value;
    next.channelValues = channels;
    // Route through the same decoder used by live capture. The decoder
    // handles non-DSKY channels by returning false — safe no-op.
    const decoded = cloneDecoded(state.decodedDsky);
    applyDskyChannelEvent(decoded, event.channel, event.value);
    next.decodedDsky = decoded;
  }
  // inputAccepted: no channel or decoded change — the AGC's response was
  // captured as later channelUpdate events. Tick/MET/steps already advanced.
  return next;
}

/** Fold baseline → targetIndex. Idempotent: the same targetIndex always
 *  yields byte-identical decoded state (verified by test). */
export function reconstructAt(
  payload: AgcEventLogPayloadV1,
  targetIndex: number,
): ReplayState {
  const clamped = clampIndex(targetIndex, payload.events.length);
  let s = initReplayState(payload);
  for (let i = 0; i <= clamped; i++) {
    s = applyNext(s, payload.events[i]!, i);
  }
  return s;
}

/** Copy state and force the status field. Used by clocks / UI to publish
 *  status changes without altering the reconstructed data. */
export function withStatus(state: ReplayState, status: ReplayStatus): ReplayState {
  if (state.status === status) return state;
  return { ...state, status };
}

// ---------------------------------------------------------------------------
// Compatibility gate for timed deterministic playback
// ---------------------------------------------------------------------------

/** Timed deterministic playback is only certified when every replay-critical
 *  provenance field matches the current live session. Manual seeking /
 *  stepping remains available for `valid-incompatible` recordings because
 *  the recorded channel outputs are self-contained. */
export function canDeterministicallyPlay(result: ImportResult | null): boolean {
  return result?.status === "valid-compatible";
}

/** UI-facing gate for whether the replay panel should render at all. */
export function isReplayable(result: ImportResult | null): boolean {
  return result?.status === "valid-compatible" || result?.status === "valid-incompatible";
}
