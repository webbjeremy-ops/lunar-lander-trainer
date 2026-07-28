// SPDX-License-Identifier: GPL-3.0-or-later
//
// LessonHost — attaches to a *shared* AgcWorkerClient owned by the /learn
// route and observes it losslessly.
//
// Historical bug we're fixing here (M2.2 Step 5.2):
//   Snapshots are wall-clock coalesced. A transient DSKY state that lives
//   for a single AGC tick (e.g. the V35 lamp-test peak, where every 7-seg
//   digit briefly reads '8' before the rope moves on) can be dropped by the
//   snapshot publisher entirely. The predicate then never sees the peak
//   even though the AGC really produced it.
//
// Fix: LessonHost maintains its own *shadow* DSKY decoder driven by the
// lossless per-event `channelUpdate` stream. The shadow is seeded from the
// worker-authoritative `boundary.decodedDsky` at attempt start (via the
// same monotonic id namespace as inputs/channels), then advanced by every
// channel event with `eventId > boundaryEventId`. Each application dispatches
// an `observe` action carrying the exact single-event delta — no coalescing,
// no snapshots — so the predicate observes every intermediate transition
// including single-tick peaks.
//
// LessonHost is responsible for:
//   - subscribing supplementary listeners on the shared client
//   - maintaining an attempt-scoped shadow DSKY decoder
//   - dispatching one `observe` action per applied channel event
//   - buffering attempt-scoped input events for predicate sequence matching
//   - emitting a single lesson-status live region
//   - publishing 3-stream diagnostics on window.__learnDiag
//     (rawChannels, transitions, publishedSnapshots)

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type {
  ChannelEventLite,
  EventBoundaryPayload,
  InputAcceptedEvent,
  ReadyPayload,
  StateSnapshot,
} from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import {
  applyDskyChannelEvent,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "@/agc/dsky/DskyDecoder";
import { stepLesson } from "./LessonEngine";
import { FIXTURE_PROVENANCE } from "./fixtureExpectations";
import type {
  LessonDefinition,
  LessonInputEvent,
  LessonObservation,
  LessonProvenance,
  LessonState,
} from "./types";

const MAX_INPUTS = 128;
const DIAG_LIMIT = 1024;

export interface LessonHostProps {
  /** Shared client owned by the /learn route. May be null while booting. */
  client: AgcWorkerClient | null;
  lesson: LessonDefinition;
  state: LessonState;
  onStateChange: (next: LessonState) => void;
  /** Boundary from the most recent attempt handshake (owned by /learn).
   *  When it changes AND the current attempt starts, the shadow decoder is
   *  reseeded from `boundary.decodedDsky` — guaranteeing the shadow reflects
   *  exactly what the AGC had emitted through `boundaryEventId`. */
  boundary?: EventBoundaryPayload | null;
  /** Optional: propagate ready payload up (readiness banner). */
  onReady?: (payload: ReadyPayload) => void;
}

/** Public helper: exported for tests. */
export function buildObservation(args: {
  snapshot: StateSnapshot | null;
  decoded: DecodedDsky;
  previousDecoded: DecodedDsky | null;
  inputsSinceAttempt: readonly LessonInputEvent[];
  channelsSincePrev: readonly ChannelEventLite[];
  provenance: LessonProvenance;
  tickIndex?: number;
  missionTimeUs?: number;
  eventLogCursor?: number;
}): LessonObservation {
  const snap = args.snapshot;
  return {
    decoded: args.decoded,
    previousDecoded: args.previousDecoded,
    snapshot: snap,
    recentInputs: args.inputsSinceAttempt,
    recentChannelEvents: args.channelsSincePrev,
    eventLogCursor: args.eventLogCursor ?? snap?.channelEventCount ?? 0,
    tickIndex: args.tickIndex ?? snap?.tickIndex ?? 0,
    missionTimeUs: args.missionTimeUs ?? snap?.missionTimeUs ?? 0,
    provenance: args.provenance,
  };
}

interface DiagState {
  rawChannels: Array<{ eventId: number; tickIndex: number; channel: number; value: number }>;
  transitions: Array<{ eventId: number; tickIndex: number; channel: number; checksum: string }>;
  publishedSnapshots: Array<{ tickIndex: number; checksum: string; latestEventId: number }>;
}

function makeEmptyDiag(): DiagState {
  return { rawChannels: [], transitions: [], publishedSnapshots: [] };
}

function pushBounded<T>(arr: T[], item: T): void {
  arr.push(item);
  if (arr.length > DIAG_LIMIT) arr.splice(0, arr.length - DIAG_LIMIT);
}

function cloneDecoded(d: DecodedDsky): DecodedDsky {
  return JSON.parse(JSON.stringify(d)) as DecodedDsky;
}

export function LessonHost(props: LessonHostProps): React.ReactElement {
  const { client, lesson, state, onStateChange, boundary } = props;
  const [ready, setReady] = useState<ReadyPayload | null>(() => client?.ready() ?? null);
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);

  // Attempt-scoped input buffer.
  const inputsRef = useRef<LessonInputEvent[]>([]);
  const channelBufRef = useRef<ChannelEventLite[]>([]);
  const previousDecodedRef = useRef<DecodedDsky | null>(null);

  // Shadow decoder — advances losslessly from channelUpdate events.
  const shadowRef = useRef<DecodedDsky>(makeEmptyDecodedDsky());
  const shadowSeededAttemptIdRef = useRef<string | null>(null);
  const boundaryEventIdRef = useRef<number>(-1);

  const stateRef = useRef<LessonState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const lessonRef = useRef<LessonDefinition>(lesson);
  useEffect(() => { lessonRef.current = lesson; }, [lesson]);

  const provenance = useMemo<LessonProvenance>(() => {
    if (!ready) return FIXTURE_PROVENANCE;
    return {
      ropeSha256: ready.ropeSha256,
      ropeSourceCommit: ready.ropeSourceCommit,
      emulatorCommit: ready.emulatorCommit,
      decoderSchemaVersion: FIXTURE_PROVENANCE.decoderSchemaVersion,
    };
  }, [ready]);
  const provenanceRef = useRef(provenance);
  useEffect(() => { provenanceRef.current = provenance; }, [provenance]);

  // Diagnostics — three streams published to window for E2E introspection.
  const diagRef = useRef<DiagState>(makeEmptyDiag());
  const publishDiag = useCallback(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __learnDiag?: unknown }).__learnDiag = {
      rawChannels: diagRef.current.rawChannels,
      transitions: diagRef.current.transitions,
      publishedSnapshots: diagRef.current.publishedSnapshots,
      shadowChecksum: decodedDskyCanonical(shadowRef.current),
      boundaryEventId: boundaryEventIdRef.current,
      attemptId: stateRef.current.attempt?.attemptId ?? null,
    };
  }, []);

  // Reseed the shadow when a new attempt begins with a fresh boundary.
  useEffect(() => {
    const cur = state.attempt;
    if (!cur) {
      shadowSeededAttemptIdRef.current = null;
      return;
    }
    if (shadowSeededAttemptIdRef.current === cur.attemptId) return;
    if (!boundary) return;
    // Reseed strictly from the worker-authoritative decoded baseline that
    // corresponds to boundary.boundaryEventId. This is the ONLY correct
    // starting point for lossless per-event application.
    shadowRef.current = cloneDecoded(boundary.decodedDsky);
    boundaryEventIdRef.current = boundary.boundaryEventId;
    shadowSeededAttemptIdRef.current = cur.attemptId;
    previousDecodedRef.current = null;
    // Clear per-attempt buffers so predicates never see stale evidence.
    channelBufRef.current.length = 0;
    // Fresh diagnostic slate per attempt.
    diagRef.current = makeEmptyDiag();
    publishDiag();
  }, [state.attempt, boundary, publishDiag]);

  const dispatchObservation = useCallback((
    decoded: DecodedDsky,
    singleChannel: ChannelEventLite | null,
    tickIndex: number,
    missionTimeUs: number,
  ) => {
    const cur = stateRef.current;
    const def = lessonRef.current;
    const step = def.steps[cur.currentStepIndex];
    if (!step || step.kind !== "interactive") return;
    if (!cur.attempt) return;
    if (cur.status === "completed") return;

    const inputsScoped = inputsRef.current.filter(
      (i) => i.eventId >= cur.attempt!.startedAtCursor && i.tickIndex >= cur.attempt!.startedAtTick,
    );
    // Build a channels-since-prev list. In lossless mode we typically
    // dispatch per single channel event; still, we fold in anything buffered
    // (defensive: input-only dispatch or boundary-race edge cases).
    const buffered = channelBufRef.current;
    const channels: ChannelEventLite[] = singleChannel
      ? (buffered.length === 0 ? [singleChannel] : [...buffered, singleChannel])
      : buffered.slice();
    channelBufRef.current.length = 0;

    const snap = latestSnapshotRef.current;
    const obs = buildObservation({
      snapshot: snap,
      decoded,
      previousDecoded: previousDecodedRef.current,
      inputsSinceAttempt: inputsScoped,
      channelsSincePrev: channels,
      provenance: provenanceRef.current,
      tickIndex,
      missionTimeUs,
      // Use the singleChannel eventId (or best-known) as the cursor so the
      // engine sees strictly-monotone progress even between snapshots.
      eventLogCursor: singleChannel?.eventId ?? snap?.channelEventCount ?? 0,
    });
    previousDecodedRef.current = decoded;

    const next = stepLesson(def, cur, { kind: "observe", observation: obs });
    if (next !== cur) onStateChange(next);
  }, [onStateChange]);

  // Attach supplementary listener to the shared client. Re-run only when the
  // client identity changes.
  useEffect(() => {
    if (!client) return;
    const existing = client.ready();
    if (existing) setReady(existing);
    const unsub = client.addListener({
      onReady: (r) => { setReady(r); props.onReady?.(r); },
      onSnapshot: (snap) => {
        latestSnapshotRef.current = snap;
        pushBounded(diagRef.current.publishedSnapshots, {
          tickIndex: snap.tickIndex,
          checksum: decodedDskyCanonical(snap.decodedDsky),
          latestEventId: snap.latestEventId,
        });
        publishDiag();
      },
      onChannelUpdate: (ev) => {
        pushBounded(diagRef.current.rawChannels, {
          eventId: ev.eventId,
          tickIndex: ev.tickIndex,
          channel: ev.channel,
          value: ev.value,
        });
        // Only apply channel events that belong to the active attempt window.
        // Events with eventId <= boundaryEventId happened before the attempt
        // handshake and MUST NOT touch the shadow (they would corrupt the
        // baseline). Between attempts (no attempt active) we simply skip
        // application; the next attempt reseeds from a fresh boundary.
        const cur = stateRef.current;
        if (!cur.attempt) {
          // Still buffer for the next observation cycle within a future attempt? No —
          // we drop, because those events pre-date any attempt handshake.
          publishDiag();
          return;
        }
        if (ev.eventId <= boundaryEventIdRef.current) {
          publishDiag();
          return;
        }
        const consumed = applyDskyChannelEvent(shadowRef.current, ev.channel, ev.value);
        if (!consumed) {
          // Non-DSKY channel — record the raw event but skip observation
          // (predicate would just see the same decoded state).
          channelBufRef.current.push(ev);
          publishDiag();
          return;
        }
        const cloned = cloneDecoded(shadowRef.current);
        pushBounded(diagRef.current.transitions, {
          eventId: ev.eventId,
          tickIndex: ev.tickIndex,
          channel: ev.channel,
          checksum: decodedDskyCanonical(cloned),
        });
        dispatchObservation(cloned, ev, ev.tickIndex, ev.missionTimeUs);
        publishDiag();
      },
      onInputAccepted: (ev: InputAcceptedEvent) => {
        inputsRef.current.push({
          eventId: ev.eventId,
          tickIndex: ev.tickIndex,
          missionTimeUs: ev.missionTimeUs,
          kind: ev.kind,
          keyCode: ev.keyCode,
          pressed: ev.pressed,
        });
        if (inputsRef.current.length > MAX_INPUTS) {
          inputsRef.current.splice(0, inputsRef.current.length - MAX_INPUTS);
        }
        // Dispatch an observation on input too, so attempt-scoped sequence
        // matching progresses even when the rope has not yet emitted any
        // channel output for the current attempt.
        const cur = stateRef.current;
        if (cur.attempt) {
          const cloned = cloneDecoded(shadowRef.current);
          dispatchObservation(cloned, null, ev.tickIndex, ev.missionTimeUs);
        }
      },
    });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Single lesson-status region — announces only meaningful transitions.
  const statusText = ready
    ? state.status === "completed"
      ? `Lesson ${lesson.title} complete.`
      : `AGC ready. Step ${state.currentStepIndex + 1}: ${lesson.steps[state.currentStepIndex]?.title ?? ""}.`
    : "AGC booting.";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="lesson-host-status"
    >
      {statusText}
    </div>
  );
}
