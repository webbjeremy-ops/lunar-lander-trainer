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
  // Attempt-bootstrap diagnostics.
  attemptKey?: string | null;
  seedCount?: number;
  seedSource?: string | null;
  listenerAttachedEventId?: number | null;
  bufferedPreSeedCount?: number;
  replayedPostSeedCount?: number;
  firstReplayedEventId?: number | null;
  lastProcessedEventId?: number | null;
  duplicateEventCount?: number;
  outOfOrderEventCount?: number;
  staleAttemptEventCount?: number;
  downgradeAttempts?: number;
  propOverwriteAttempts?: number;
}

function makeEmptyDiag(): DiagState {
  return {
    rawChannels: [], transitions: [], publishedSnapshots: [],
    enterEventId: null, enterTick: null,
    firstDigitMatchEventId: null, firstAnnMatchEventId: null, firstFullMatchEventId: null,
    closestTransition: null,
    keyEventIds: {},
    seedCount: 0,
    bufferedPreSeedCount: 0,
    replayedPostSeedCount: 0,
    duplicateEventCount: 0,
    outOfOrderEventCount: 0,
    staleAttemptEventCount: 0,
    downgradeAttempts: 0,
    propOverwriteAttempts: 0,
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

  // AUTHORITATIVE synchronous LessonEngine state.
  //
  // We deliberately DO NOT continuously mirror `state` (prop) into stateRef.
  // React's setState is asynchronous; a prop commit from a stale reducer
  // path can arrive AFTER a synchronous transition to `completed`, and if
  // we blindly reseed the ref we'd erase the latch. During an active
  // attempt, stateRef.current is the source of truth; parent-prop commits
  // must not overwrite a newer ref state.
  //
  // The ref is seeded exactly once per attempt when the attempt-key changes.
  const stateRef = useRef<LessonState>(state);

  const lessonRef = useRef<LessonDefinition>(lesson);
  useEffect(() => { lessonRef.current = lesson; }, [lesson]);

  // Pre-seed channel buffer: events that arrived after we opened an attempt
  // but before the boundary/shadow was seeded. Drained on seed.
  const pendingPreSeedRef = useRef<ChannelEventLite[]>([]);
  // Highest eventId processed against the shadow — used to reject
  // out-of-order / duplicate events (attempt-scoped).
  const lastProcessedEventIdRef = useRef<number>(-1);

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
      attemptKey: d.attemptKey ?? null,
      seedCount: d.seedCount ?? 0,
      seedSource: d.seedSource ?? null,
      listenerAttachedEventId: d.listenerAttachedEventId ?? null,
      bufferedPreSeedCount: d.bufferedPreSeedCount ?? 0,
      replayedPostSeedCount: d.replayedPostSeedCount ?? 0,
      firstReplayedEventId: d.firstReplayedEventId ?? null,
      lastProcessedEventId: d.lastProcessedEventId ?? null,
      duplicateEventCount: d.duplicateEventCount ?? 0,
      outOfOrderEventCount: d.outOfOrderEventCount ?? 0,
      staleAttemptEventCount: d.staleAttemptEventCount ?? 0,
      downgradeAttempts: d.downgradeAttempts ?? 0,
      propOverwriteAttempts: d.propOverwriteAttempts ?? 0,
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
      peakDispatch: (d as unknown as Record<string, unknown>).peakDispatch ?? null,
      firstCompletionEventId: (d as unknown as Record<string, unknown>).firstCompletionEventId ?? null,
      firstCompletionEvidenceCount: (d as unknown as Record<string, unknown>).firstCompletionEvidenceCount ?? null,
    };
  }, []);

  // Detect meaningful prop-driven state changes that are NOT ours (i.e.
  // parent reset, lesson/step navigation, restartInteractive). These are the
  // only legitimate reasons to reseed stateRef mid-mount.
  useEffect(() => {
    const ref = stateRef.current;
    const nextAttemptId = state.attempt?.attemptId ?? null;
    const refAttemptId = ref.attempt?.attemptId ?? null;
    // Case A: parent cleared the attempt (teardown / navigation).
    if (nextAttemptId === null && refAttemptId !== null) {
      stateRef.current = state;
      shadowSeededAttemptIdRef.current = null;
      lastProcessedEventIdRef.current = -1;
      pendingPreSeedRef.current.length = 0;
      return;
    }
    // Case B: parent switched lesson entirely (different lessonId is implied
    // by remount; if same host receives different lesson.id, treat as reset).
    if (state.lessonId !== ref.lessonId) {
      stateRef.current = state;
      shadowSeededAttemptIdRef.current = null;
      lastProcessedEventIdRef.current = -1;
      pendingPreSeedRef.current.length = 0;
      return;
    }
    // Case C: parent's status/step changed while NO attempt is active
    // (e.g. reading-only step advance). Safe to mirror.
    if (nextAttemptId === null && refAttemptId === null) {
      if (state !== ref) stateRef.current = state;
      return;
    }
    // Case D: parent commit for the SAME attempt as our ref. If the ref
    // has already advanced past prop (e.g. we synchronously latched
    // completed and this prop is the delayed reflection or an older
    // reflection), do NOT overwrite. Count it for diagnostics.
    if (nextAttemptId === refAttemptId) {
      // Never downgrade completed → in-progress via prop.
      if (ref.status === "completed" && state.status !== "completed") {
        diagRef.current.propOverwriteAttempts =
          (diagRef.current.propOverwriteAttempts ?? 0) + 1;
        return;
      }
      // If prop carries strictly newer information (more evidence), accept.
      if (state.evidence.length > ref.evidence.length) {
        stateRef.current = state;
      }
      return;
    }
    // Case E: attempt IDs differ — parent opened a NEW attempt. Seed once
    // via the attempt-key effect below (do nothing here to avoid double
    // seeding).
  }, [state]);

  // Reseed the shadow AND stateRef when a new attempt begins with a fresh
  // boundary. This is the ONLY place stateRef is seeded for an attempt.
  useEffect(() => {
    const cur = state.attempt;
    if (!cur) {
      shadowSeededAttemptIdRef.current = null;
      return;
    }
    if (shadowSeededAttemptIdRef.current === cur.attemptId) return;
    if (!boundary) return;
    // Attempt-key: sessionEpoch is implied by boundary.boundaryEventId
    // monotonically resetting on worker epoch changes.
    const attemptKey = `${boundary.boundaryEventId}:${state.lessonId}:${cur.attemptId}`;

    // Seed shadow strictly from worker-authoritative baseline.
    shadowRef.current = cloneDecoded(boundary.decodedDsky);
    boundaryEventIdRef.current = boundary.boundaryEventId;
    shadowSeededAttemptIdRef.current = cur.attemptId;
    previousDecodedRef.current = null;
    channelBufRef.current.length = 0;
    lastProcessedEventIdRef.current = boundary.boundaryEventId;

    // Seed stateRef from parent's initial attempt state (exactly once).
    stateRef.current = state;

    // Fresh diagnostic slate per attempt.
    const nextDiag = makeEmptyDiag();
    nextDiag.attemptKey = attemptKey;
    nextDiag.seedCount = 1;
    nextDiag.seedSource = "attempt-key-change";
    diagRef.current = nextDiag;

    // Drain any pre-seed channel events that arrived while we were waiting
    // for the boundary. Discard <= boundary; replay > boundary in eventId
    // order.
    const pending = pendingPreSeedRef.current
      .filter((e) => e.eventId > boundary.boundaryEventId)
      .sort((a, b) => a.eventId - b.eventId);
    pendingPreSeedRef.current.length = 0;
    diagRef.current.bufferedPreSeedCount = pending.length;
    if (pending.length > 0) {
      diagRef.current.firstReplayedEventId = pending[0].eventId;
      for (const ev of pending) {
        applyDskyChannelEvent(shadowRef.current, ev.channel, ev.value);
        lastProcessedEventIdRef.current = ev.eventId;
        diagRef.current.replayedPostSeedCount =
          (diagRef.current.replayedPostSeedCount ?? 0) + 1;
      }
    }
    diagRef.current.lastProcessedEventId = lastProcessedEventIdRef.current;
    publishDiag();
  }, [state, state.attempt, boundary, publishDiag]);

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
    const statusChanged = next.status !== cur.status;
    const evidenceGrew = next.evidence.length > cur.evidence.length;
    if (statusChanged || evidenceGrew) {
      d.predicateStateChanges = (d.predicateStateChanges ?? 0) + 1;
      d.lastPredicateChange = {
        eventId: singleChannel?.eventId ?? null,
        tickIndex,
        fromStatus: cur.status,
        toStatus: next.status,
        fromStep: cur.currentStepIndex,
        toStep: next.currentStepIndex,
      };
      const dAnyC = d as unknown as Record<string, unknown>;
      if (next.status === "completed" && dAnyC.firstCompletionEventId === undefined) {
        dAnyC.firstCompletionEventId = singleChannel?.eventId ?? null;
        dAnyC.firstCompletionEvidenceCount = next.evidence.length;
      }
    }
    // Probe: capture the predicate outcome for the exact full-match transition.
    if (
      singleChannel &&
      d.firstFullMatchEventId !== null &&
      singleChannel.eventId === d.firstFullMatchEventId
    ) {
      const dAny = d as unknown as Record<string, unknown>;
      dAny.peakDispatch = {
        eventId: singleChannel.eventId,
        tickIndex,
        curStatus: cur.status,
        curStep: cur.currentStepIndex,
        curEvidenceLen: cur.evidence.length,
        curAttemptId: cur.attempt?.attemptId ?? null,
        nextStatus: next.status,
        nextStep: next.currentStepIndex,
        nextEvidenceLen: next.evidence.length,
        observedEvidenceChecksum: v35EvidenceCanonical(
          projectV35PeakEvidence(obs.decoded),
        ),
        expectedEvidenceChecksum: V35_PEAK_EVIDENCE_CHECKSUM,
        recentChannelCount: obs.recentChannelEvents.length,
        recentInputCount: obs.recentInputs.length,
        recentChannelIds: obs.recentChannelEvents.map((c) => c.eventId),
        recentInputKeys: obs.recentInputs.map((i) => i.keyCode),
      };
    }
    if (next !== cur) {
      // Never downgrade: once completed, the attempt latch is terminal.
      if (stateRef.current.status === "completed" && next.status !== "completed") {
        diagRef.current.downgradeAttempts =
          (diagRef.current.downgradeAttempts ?? 0) + 1;
        return;
      }
      // Advance ref synchronously so events in the same microtask burst see
      // the latched state and short-circuit on the completed guard above.
      stateRef.current = next;
      onStateChange(next);
    }
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
