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
import {
  FIXTURE_PROVENANCE,
  V35_PEAK_EVIDENCE_CHECKSUM,
  V35_PEAK_EVIDENCE_PROJECTION,
  diffV35Evidence,
  projectV35PeakEvidence,
  v35EvidenceCanonical,
} from "./fixtureExpectations";
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
  rawChannels: Array<{ eventId: number; tickIndex: number; channel: number; value: number; selector?: number }>;
  transitions: Array<{
    eventId: number;
    tickIndex: number;
    channel: number;
    value: number;
    selector?: number;
    checksum: string;            // full structural
    evidenceChecksum: string;    // authoritative projection
    postEnter: boolean;
    postBoundary: boolean;
    provenanceMatch: boolean;
    withinCompletionWindow: boolean;
    diff: unknown;               // field-level diff vs. expected evidence
    digitsMatch: boolean;
    annunciatorsMatch: boolean;
    fullMatch: boolean;
  }>;
  publishedSnapshots: Array<{ tickIndex: number; checksum: string; latestEventId: number }>;
  enterEventId: number | null;
  enterTick: number | null;
  firstDigitMatchEventId: number | null;
  firstAnnMatchEventId: number | null;
  firstFullMatchEventId: number | null;
  closestTransition: { eventId: number; diffFieldCount: number; diff: unknown } | null;
  keyEventIds: Record<string, number>;
  predicateCalls?: number;
  predicateStateChanges?: number;
  lastPredicateChange?: {
    eventId: number | null;
    tickIndex: number;
    fromStatus: string;
    toStatus: string;
    fromStep: number;
    toStep: number;
  } | null;
}

function makeEmptyDiag(): DiagState {
  return {
    rawChannels: [], transitions: [], publishedSnapshots: [],
    enterEventId: null, enterTick: null,
    firstDigitMatchEventId: null, firstAnnMatchEventId: null, firstFullMatchEventId: null,
    closestTransition: null,
    keyEventIds: {},
  };
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
    const d = diagRef.current;
    (window as unknown as { __learnDiag?: unknown }).__learnDiag = {
      rawChannels: d.rawChannels,
      transitions: d.transitions,
      publishedSnapshots: d.publishedSnapshots,
      shadowChecksum: decodedDskyCanonical(shadowRef.current),
      shadowStructural: v35EvidenceCanonical(projectV35PeakEvidence(shadowRef.current)),
      expectedEvidenceChecksum: V35_PEAK_EVIDENCE_CHECKSUM,
      expectedEvidenceProjection: V35_PEAK_EVIDENCE_PROJECTION,
      currentEvidenceDiff: diffV35Evidence(
        V35_PEAK_EVIDENCE_PROJECTION,
        projectV35PeakEvidence(shadowRef.current),
      ),
      boundaryEventId: boundaryEventIdRef.current,
      attemptId: stateRef.current.attempt?.attemptId ?? null,
      enterEventId: d.enterEventId,
      enterTick: d.enterTick,
      keyEventIds: d.keyEventIds,
      firstDigitMatchEventId: d.firstDigitMatchEventId,
      firstAnnMatchEventId: d.firstAnnMatchEventId,
      firstFullMatchEventId: d.firstFullMatchEventId,
      closestTransition: d.closestTransition,
      predicateCalls: d.predicateCalls ?? 0,
      predicateStateChanges: d.predicateStateChanges ?? 0,
      lastPredicateChange: d.lastPredicateChange ?? null,
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
    // Track predicate observation cadence for post-mortem diagnostics.
    const d = diagRef.current;
    d.predicateCalls = (d.predicateCalls ?? 0) + 1;
    if (next !== cur) {
      d.predicateStateChanges = (d.predicateStateChanges ?? 0) + 1;
      d.lastPredicateChange = {
        eventId: singleChannel?.eventId ?? null,
        tickIndex,
        fromStatus: cur.status,
        toStatus: next.status,
        fromStep: cur.currentStepIndex,
        toStep: next.currentStepIndex,
      };
    }
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
        const selector =
          ev.channel === 0o10 ? ((ev.value >> 11) & 0o17) : undefined;
        pushBounded(diagRef.current.rawChannels, {
          eventId: ev.eventId,
          tickIndex: ev.tickIndex,
          channel: ev.channel,
          value: ev.value,
          selector,
        });
        // Only apply channel events that belong to the active attempt window.
        // Events with eventId <= boundaryEventId happened before the attempt
        // handshake and MUST NOT touch the shadow (they would corrupt the
        // baseline). Between attempts (no attempt active) we simply skip
        // application; the next attempt reseeds from a fresh boundary.
        const cur = stateRef.current;
        if (!cur.attempt) {
          publishDiag();
          return;
        }
        if (ev.eventId <= boundaryEventIdRef.current) {
          publishDiag();
          return;
        }
        const consumed = applyDskyChannelEvent(shadowRef.current, ev.channel, ev.value);
        if (!consumed) {
          channelBufRef.current.push(ev);
          publishDiag();
          return;
        }
        const cloned = cloneDecoded(shadowRef.current);
        // Field-level V35 evidence diagnostics (safe for other lessons: the
        // projection is cheap and unused unless caller inspects it).
        const projection = projectV35PeakEvidence(cloned);
        const evidenceChecksum = v35EvidenceCanonical(projection);
        const diff = diffV35Evidence(V35_PEAK_EVIDENCE_PROJECTION, projection);
        const d = diagRef.current;
        const enterId = d.enterEventId;
        const postEnter = enterId !== null && ev.eventId > enterId;
        const postBoundary = ev.eventId > boundaryEventIdRef.current;
        const provenanceMatch =
          provenanceRef.current.ropeSha256 === FIXTURE_PROVENANCE.ropeSha256 &&
          provenanceRef.current.decoderSchemaVersion === FIXTURE_PROVENANCE.decoderSchemaVersion &&
          provenanceRef.current.emulatorCommit === FIXTURE_PROVENANCE.emulatorCommit;
        const enterTick = d.enterTick ?? 0;
        const withinCompletionWindow =
          postEnter && (ev.tickIndex - enterTick) <= 400;
        const digitsMatch = !diff.program && !diff.verb && !diff.noun && !diff.registers;
        const annunciatorsMatch = !diff.annunciators;
        const fullMatch = digitsMatch && annunciatorsMatch;
        pushBounded(d.transitions, {
          eventId: ev.eventId,
          tickIndex: ev.tickIndex,
          channel: ev.channel,
          value: ev.value,
          selector,
          checksum: decodedDskyCanonical(cloned),
          evidenceChecksum,
          postEnter,
          postBoundary,
          provenanceMatch,
          withinCompletionWindow,
          diff,
          digitsMatch,
          annunciatorsMatch,
          fullMatch,
        });
        if (postEnter) {
          if (digitsMatch && d.firstDigitMatchEventId === null) d.firstDigitMatchEventId = ev.eventId;
          if (annunciatorsMatch && d.firstAnnMatchEventId === null) d.firstAnnMatchEventId = ev.eventId;
          if (fullMatch && d.firstFullMatchEventId === null) d.firstFullMatchEventId = ev.eventId;
        }
        const fieldCount =
          (diff.program ? 1 : 0) +
          (diff.verb ? 1 : 0) +
          (diff.noun ? 1 : 0) +
          (diff.registers ? Object.keys(diff.registers).length : 0) +
          (diff.annunciators ? Object.keys(diff.annunciators).length : 0);
        if (!d.closestTransition || fieldCount < d.closestTransition.diffFieldCount) {
          d.closestTransition = { eventId: ev.eventId, diffFieldCount: fieldCount, diff };
        }
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
        // Record V35 keypad milestones (only meaningful for lesson 3, but
        // cheap otherwise): V=0o21, 3=0o03, 5=0o05, ENTR=0o34.
        const d = diagRef.current;
        if (ev.pressed !== false && typeof ev.keyCode === "number") {
          const label =
            ev.keyCode === 0o21 ? "VERB" :
            ev.keyCode === 0o03 ? "3" :
            ev.keyCode === 0o05 ? "5" :
            ev.keyCode === 0o34 ? "ENTR" :
            null;
          if (label && d.keyEventIds[label] === undefined) {
            d.keyEventIds[label] = ev.eventId;
          }
          if (ev.keyCode === 0o34 && d.enterEventId === null) {
            d.enterEventId = ev.eventId;
            d.enterTick = ev.tickIndex;
          }
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
