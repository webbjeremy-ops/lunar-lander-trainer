// SPDX-License-Identifier: GPL-3.0-or-later
//
// LessonHost — bridges the live Worker-hosted AGC (via <Dsky/>) into the
// pure LessonEngine reducer. Owns per-lesson state, an attempt cursor, and
// bounded input/channel-event buffers. Never mutates AGC state directly.
//
// Design notes:
//  - Dsky owns exactly one AgcWorkerClient; LessonHost receives the handle
//    through the onClient callback and attaches a SUPPLEMENTARY listener so
//    it does not displace Dsky's own listener bag.
//  - Input eventIds are authoritative: the worker allocates them from the
//    same monotonic counter that assigns channel eventIds, and echoes them
//    back as `inputAccepted`. Predicates can therefore compare input and
//    channel eventIds in a single ordered namespace.
//  - Attempt boundaries are enforced by the LessonEngine — the host only
//    dispatches beginAttempt when the caller opens an interactive lesson.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Dsky } from "@/ui/dsky/Dsky";
import { ropeById } from "@/sim/agc/roms";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type {
  ChannelEventLite,
  InputAcceptedEvent,
  ReadyPayload,
  StateSnapshot,
} from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import { initialLessonState, stepLesson } from "./LessonEngine";
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
  lesson: LessonDefinition;
  state: LessonState;
  onStateChange: (next: LessonState) => void;
  /** Emitted whenever the host observes the AGC is running with a rope loaded. */
  onReady?: (payload: ReadyPayload) => void;
}

/** Public helper: exported for tests. Turns a live worker snapshot plus
 *  attempt-scoped buffers into a LessonObservation suitable for stepLesson. */
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

export function LessonHost(props: LessonHostProps): JSX.Element {
  const { lesson, state, onStateChange } = props;
  const rope = useMemo(() => ropeById("Luminary099"), []);
  const clientRef = useRef<AgcWorkerClient | null>(null);
  const [readyPayload, setReadyPayload] = useState<ReadyPayload | null>(null);
  const [liveDecoded, setLiveDecoded] = useState<DecodedDsky>(() => makeEmptyDecodedDsky());
  const [latestSnapshot, setLatestSnapshot] = useState<StateSnapshot | null>(null);

  // Attempt-scoped input buffer. We slice by attempt startedAtCursor when
  // constructing observations so restarting a lesson naturally invalidates
  // stale evidence.
  const inputsRef = useRef<LessonInputEvent[]>([]);
  // Channel events accumulated since the last dispatched observation. Reset
  // per observation dispatch so predicates see strictly-new channel events.
  const channelBufRef = useRef<ChannelEventLite[]>([]);
  const previousDecodedRef = useRef<DecodedDsky | null>(null);

  // Keep a ref of the current state so listener callbacks always see the
  // latest reducer output without re-registering listeners.
  const stateRef = useRef<LessonState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const lessonRef = useRef<LessonDefinition>(lesson);
  useEffect(() => { lessonRef.current = lesson; }, [lesson]);

  const provenance = useMemo<LessonProvenance>(() => {
    if (!readyPayload) return FIXTURE_PROVENANCE;
    return {
      ropeSha256: readyPayload.ropeSha256,
      ropeSourceCommit: readyPayload.ropeSourceCommit,
      emulatorCommit: readyPayload.emulatorCommit,
      decoderSchemaVersion: FIXTURE_PROVENANCE.decoderSchemaVersion,
    };
  }, [readyPayload]);
  const provenanceRef = useRef(provenance);
  useEffect(() => { provenanceRef.current = provenance; }, [provenance]);

  const dispatchObservation = useCallback((snapshot: StateSnapshot, decoded: DecodedDsky) => {
    const cur = stateRef.current;
    const def = lessonRef.current;
    const step = def.steps[cur.currentStepIndex];
    if (!step || step.kind !== "interactive") return;
    if (!cur.attempt) return; // interactive step but no open attempt
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

  const handleClient = useCallback((client: AgcWorkerClient | null) => {
    clientRef.current = client;
    if (!client) return;
    const unsub = client.addListener({
      onReady: (r) => { setReadyPayload(r); props.onReady?.(r); },
      onSnapshot: (snap) => { setLatestSnapshot(snap); },
      onDskyDecoded: (d) => {
        setLiveDecoded(d);
        // Dispatch when we have a matching snapshot; otherwise defer.
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
    // We intentionally do not depend on dispatchObservation identity; the
    // listener always reads the latest via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror latest snapshot into a ref so onDskyDecoded can pair with it.
  const latestSnapshotRef = useRef<StateSnapshot | null>(null);
  useEffect(() => { latestSnapshotRef.current = latestSnapshot; }, [latestSnapshot]);

  return (
    <div className="space-y-3">
      <ClientOnly fallback={<div className="text-xs text-neutral-500">Booting AGC worker…</div>}>
        <Dsky
          key={`learn-${lesson.id}`}
          rope={rope}
          onClient={handleClient}
        />
      </ClientOnly>
      <div
        aria-live="polite"
        className="sr-only"
        data-testid="lesson-host-status"
      >
        {readyPayload ? "AGC ready" : "AGC booting"} · step {stateRef.current.currentStepIndex + 1}
        {stateRef.current.status === "completed" ? " · lesson complete" : ""}
      </div>
      {/* Expose latest decoded PROG/VERB/NOUN in an accessible summary so
          screen readers get a stable, non-flashing textual mirror. */}
      <div className="sr-only" aria-live="polite">
        PROG {liveDecoded.prog.raw} VERB {liveDecoded.verb.raw} NOUN {liveDecoded.noun.raw}
      </div>
    </div>
  );
}
