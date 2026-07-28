// SPDX-License-Identifier: GPL-3.0-or-later
// Attempt-scoped AGC key-sequence matcher.
//
// Given a list of expected key codes (in order) and the observation's
// recentInputs stream, return the eventIds that consumed the sequence — but
// ONLY considering key-down events that occurred at or after the attempt's
// start cursor. Key-up events are always ignored; PROCEED is stateful and
// out-of-scope for these matchers.

import type { LessonAttempt, LessonInputEvent } from "./types";

export interface SequenceMatch {
  matched: boolean;
  /** The eventIds (oldest→newest) that consumed the expected sequence. */
  inputEventIds: readonly number[];
  /** eventId of the final matched key (== last of inputEventIds). */
  completedAtEventId: number | null;
  /** tickIndex/missionTimeUs of the final matched key. */
  completedAtTick: number | null;
  completedAtMissionTimeUs: number | null;
}

export function matchAttemptScopedSequence(
  inputs: readonly LessonInputEvent[],
  expected: readonly number[],
  attempt: LessonAttempt,
): SequenceMatch {
  const ids: number[] = [];
  let cursor = 0;
  let lastTick: number | null = null;
  let lastMt: number | null = null;
  let lastId: number | null = null;
  for (const ev of inputs) {
    if (ev.kind !== "dskyKeyDown") continue;
    if (ev.eventId < attempt.startedAtCursor) continue;
    if (ev.tickIndex < attempt.startedAtTick) continue;
    if (typeof ev.keyCode !== "number") continue;
    if (ev.keyCode !== expected[cursor]) {
      // A wrong key press within the attempt window is tolerated; the
      // learner may press extras. The predicate is a monotone matcher.
      continue;
    }
    ids.push(ev.eventId);
    lastTick = ev.tickIndex;
    lastMt = ev.missionTimeUs;
    lastId = ev.eventId;
    cursor += 1;
    if (cursor === expected.length) {
      return {
        matched: true,
        inputEventIds: ids,
        completedAtEventId: lastId,
        completedAtTick: lastTick,
        completedAtMissionTimeUs: lastMt,
      };
    }
  }
  return {
    matched: false,
    inputEventIds: ids,
    completedAtEventId: null,
    completedAtTick: null,
    completedAtMissionTimeUs: null,
  };
}

/**
 * Filter channel events to only those with eventId >= threshold. Used to
 * enforce that decoder-visible state came from AGC output produced AFTER
 * a specific input event id.
 */
export function channelEventsAfter(
  events: readonly { eventId: number; channel: number }[],
  eventIdThreshold: number,
): readonly { eventId: number; channel: number }[] {
  return events.filter((e) => e.eventId > eventIdThreshold);
}
