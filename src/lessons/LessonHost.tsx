// SPDX-License-Identifier: GPL-3.0-or-later
//
// LessonHost — attaches to a *shared* AgcWorkerClient owned by the /learn
// route and observes it. Does NOT create its own Worker, does NOT render a
// DSKY, and does NOT mirror PROG/VERB/NOUN in an aria-live region (the
// authentic DSKY already owns the DSKY consolidated live region — a second
// mirror would double-announce every display change).
//
// LessonHost is responsible for:
//   - subscribing supplementary listeners on the shared client
//   - buffering inputAccepted / channelUpdate events since the last dispatch
//   - dispatching `observe` actions into the pure LessonEngine reducer
//   - a single lesson-status aria-live region that announces only readiness,
//     step transitions, completion, and errors (never per-snapshot data)

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type {
  ChannelEventLite,
  InputAcceptedEvent,
  ReadyPayload,
  StateSnapshot,
} from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
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

export interface LessonHostProps {
  /** Shared client owned by the /learn route. May be null while booting. */
  client: AgcWorkerClient | null;
  lesson: LessonDefinition;
  state: LessonState;
  onStateChange: (next: LessonState) => void;
  /** Optional: propagate ready payload up (readiness banner). */
  onReady?: (payload: ReadyPayload) => void;
}

/** Public helper: exported for tests. */
export function buildObservation(args: {
  snapshot: StateSnapshot;
  decoded: DecodedDsky;
  previousDecoded: DecodedDsky | null;
  inputsSinceAttempt: readonly LessonInputEvent[];
  channelsSincePrev: readonly ChannelEventLite[];
  provenance: LessonProvenance;
}): LessonObservation {
  return {
    decoded: args.decoded,
    previousDecoded: args.previousDecoded,
    snapshot: args.snapshot,
    recentInputs: args.inputsSinceAttempt,
    recentChannelEvents: args.channelsSincePrev,
    eventLogCursor: args.snapshot.channelEventCount,
    tickIndex: args.snapshot.tickIndex,
    missionTimeUs: args.snapshot.missionTimeUs,
    provenance: args.provenance,
  };
}

export function LessonHost(props: LessonHostProps): React.ReactElement {
  const { client, lesson, state, onStateChange } = props;
  const [ready, setReady] = useState<ReadyPayload | null>(() => client?.ready() ?? null);
  const [liveDecoded, setLiveDecoded] = useState<DecodedDsky>(() => makeEmptyDecodedDsky());
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);

  // Attempt-scoped input buffer. Attempt filter scopes by eventId >= startedAtCursor.
  const inputsRef = useRef<LessonInputEvent[]>([]);
  const channelBufRef = useRef<ChannelEventLite[]>([]);
  const previousDecodedRef = useRef<DecodedDsky | null>(null);

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

  const dispatchObservation = useCallback((snapshot: StateSnapshot, decoded: DecodedDsky) => {
    const cur = stateRef.current;
    const def = lessonRef.current;
    const step = def.steps[cur.currentStepIndex];
    if (!step || step.kind !== "interactive") return;
    if (!cur.attempt) return;
    if (cur.status === "completed") return;

    const inputsScoped = inputsRef.current.filter(
      (i) => i.eventId >= cur.attempt!.startedAtCursor && i.tickIndex >= cur.attempt!.startedAtTick,
    );
    const channelsSincePrev = channelBufRef.current.slice();
    channelBufRef.current.length = 0;

    const obs = buildObservation({
      snapshot,
      decoded,
      previousDecoded: previousDecodedRef.current,
      inputsSinceAttempt: inputsScoped,
      channelsSincePrev,
      provenance: provenanceRef.current,
    });
    previousDecodedRef.current = decoded;

    const next = stepLesson(def, cur, { kind: "observe", observation: obs });
    if (next !== cur) onStateChange(next);
  }, [onStateChange]);

  // Attach supplementary listener to the shared client. Re-run only when the
  // client identity changes — swapping listener bags on lesson change would
  // race with in-flight events.
  useEffect(() => {
    if (!client) return;
    const existing = client.ready();
    if (existing) setReady(existing);
    const unsub = client.addListener({
      onReady: (r) => { setReady(r); props.onReady?.(r); },
      onSnapshot: (snap) => { latestSnapshotRef.current = snap; },
      onDskyDecoded: (d) => {
        setLiveDecoded(d);
        const snap = latestSnapshotRef.current;
        if (snap) dispatchObservation(snap, d);
      },
      onChannelUpdate: (ev) => { channelBufRef.current.push(ev); },
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
  void liveDecoded; // retained for tests that may probe decoded state via refs

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
