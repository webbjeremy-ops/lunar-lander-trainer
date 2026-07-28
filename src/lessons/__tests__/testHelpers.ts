// SPDX-License-Identifier: GPL-3.0-or-later
// Shared helpers for lesson tests. Framework-free; the engine is pure so
// we can drive it with hand-built observations.

import type { ChannelEventLite, StateSnapshot } from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import type {
  LessonInputEvent,
  LessonObservation,
  LessonProvenance,
} from "@/lessons/types";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";

let idCounter = 1000;
export function nextEventId(): number { return ++idCounter; }
export function resetEventIds(): void { idCounter = 1000; }

export function makeObservation(opts: {
  decoded?: DecodedDsky;
  previousDecoded?: DecodedDsky | null;
  snapshot?: Partial<StateSnapshot> | null;
  recentInputs?: readonly LessonInputEvent[];
  recentChannelEvents?: readonly ChannelEventLite[];
  eventLogCursor?: number;
  tickIndex: number;
  missionTimeUs?: number;
  provenance?: LessonProvenance;
}): LessonObservation {
  const decoded = opts.decoded ?? makeEmptyDecodedDsky();
  const snap: StateSnapshot | null = opts.snapshot === null ? null : {
    version: 1,
    missionTimeUs: opts.missionTimeUs ?? opts.tickIndex * 20000,
    timingRemainderNs: 0,
    totalAgcSteps: opts.tickIndex * 1706,
    timeScale: 1,
    running: true,
    lamps: 0,
    channels: {},
    channelEventCount: 0,
    recentEvents: [],
    erasableBase: 0,
    erasableWindow: [],
    avgTickMs: 20,
    schedulerOverruns: 0,
    tickIndex: opts.tickIndex,
    decodedDsky: decoded,
    ...(opts.snapshot ?? {}),
  };
  return {
    decoded,
    previousDecoded: opts.previousDecoded ?? null,
    snapshot: snap,
    recentInputs: opts.recentInputs ?? [],
    recentChannelEvents: opts.recentChannelEvents ?? [],
    eventLogCursor: opts.eventLogCursor ?? 0,
    tickIndex: opts.tickIndex,
    missionTimeUs: opts.missionTimeUs ?? opts.tickIndex * 20000,
    provenance: opts.provenance ?? FIXTURE_PROVENANCE,
  };
}

export function keyInput(
  keyCode: number,
  tickIndex: number,
  eventId = nextEventId(),
): LessonInputEvent {
  return {
    eventId,
    tickIndex,
    missionTimeUs: tickIndex * 20000,
    kind: "dskyKeyDown",
    keyCode,
  };
}

export function channelEv(
  channel: number,
  value: number,
  tickIndex: number,
  eventId = nextEventId(),
): ChannelEventLite {
  return {
    eventId,
    tickIndex,
    missionTimeUs: tickIndex * 20000,
    channel,
    value,
    seq: eventId,
  };
}
