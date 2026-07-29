// SPDX-License-Identifier: GPL-3.0-or-later
//
// M2.2 Step 5 regression suite — LessonHost invariants.
//
// The tests below pin the invariants exposed by the two subtle bugs we
// hunted in Step 5:
//
//   - Attempt bootstrap: exactly one seed per semantic attempt-key;
//     channelUpdate events that arrive before the boundary land in the
//     pre-seed buffer and are drained on seed in strict eventId order;
//     duplicates and out-of-order events are rejected, not applied.
//
//   - Terminal completion: once a predicate completes an interactive
//     step, further channel events must not re-enter dispatchObservation
//     (the completion latch), and delayed / stale in-progress prop
//     commits from the parent must not overwrite the ref (propOverwrite
//     counter must increment while the observed state stays completed).
//
//   - React-microtask batching: several channel events pushed in a
//     single microtask each still get processed, and the one that
//     triggers completion latches — no batching-driven drops.
//
//   - Correct lesson routing: the `state` object handed to
//     onStateChange always carries its own lessonId, so the parent
//     committer (applyLessonStateUpdate) can route by that id.
//
// These tests do not run the real yaAGC WASM. They drive the
// AgcWorkerClient with a fake Worker (already used by
// LessonHost.integration.test.ts) and assert diagnostics published
// under window.__learnDiag as well as onStateChange call shapes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AgcWorkerClient, type AgcWorkerLike } from "@/agc/AgcWorkerClient";
import {
  PROTOCOL_VERSION,
  makeEnvelope,
  type ChannelEventLite,
  type EventBoundaryPayload,
  type ReadyPayload,
  type W2CEnvelope,
} from "@/agc/protocol";
import { LessonHost } from "@/lessons/LessonHost";
import { makeEmptyDecodedDsky, decodedDskyCanonical } from "@/agc/dsky/DskyDecoder";
import type {
  LessonAttempt,
  LessonDefinition,
  LessonState,
  StepPredicate,
} from "@/lessons/types";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";

// -------- fake worker plumbing (mirrors LessonHost.integration.test.ts).

function makeFakeWorker(): {
  worker: AgcWorkerLike;
  push: (env: W2CEnvelope) => void;
  posted: unknown[];
} {
  let messageHandler: ((ev: MessageEvent<W2CEnvelope>) => void) | null = null;
  const posted: unknown[] = [];
  const worker: AgcWorkerLike = {
    postMessage: (msg) => { posted.push(msg); },
    addEventListener: (type: string, handler: unknown) => {
      if (type === "message") {
        messageHandler = handler as (ev: MessageEvent<W2CEnvelope>) => void;
      }
    },
    terminate: () => {},
  };
  return {
    worker,
    posted,
    push: (env) => messageHandler?.({ data: env } as MessageEvent<W2CEnvelope>),
  };
}

let workerSeq = 0;
function envReady(payload: ReadyPayload): W2CEnvelope {
  return makeEnvelope("w2c", ++workerSeq, {
    type: "ready",
    payload,
  }) as W2CEnvelope;
}
function envChannel(ev: ChannelEventLite): W2CEnvelope {
  return makeEnvelope("w2c", ++workerSeq, {
    type: "channelUpdate",
    payload: ev,
  }) as W2CEnvelope;
}

function makeReady(): ReadyPayload {
  return {
    emulatorRepo: "michaelfranzl/webAGC",
    emulatorCommit: "0575ea7",
    emulatorVersionString: "test",
    ropeId: "Luminary099",
    ropeSha256: "0".repeat(64),
    ropeSourceCommit: "911e5c0",
    ropeByteLength: 0,
    wasmSha256: "0".repeat(64),
    protocolVersion: PROTOCOL_VERSION,
    initialResetPerformed: true,
    resetCount: 1,
    sessionEpoch: 0,
    canonicalInit: {
      cpuResetPerformed: true,
      cpuResetCount: 1,
      startupRsetSent: true,
      startupRsetCode: 0o22,
      startupRsetAccepted: true,
      startupRsetCount: 1,
      restartObservedBeforeRset: true,
      restartClearedAfterRset: true,
      settledAtTick: 20,
    },
  };
}

function makeChannel(eventId: number, tickIndex: number, channel = 0o11, value = 0): ChannelEventLite {
  return { eventId, tickIndex, missionTimeUs: tickIndex * 20000, channel, value, seq: eventId };
}

// -------- fake lesson (single interactive step, trivial predicate).

const alwaysCompleteOnFirstChannel: StepPredicate = ({ observation, attempt }) => {
  if (observation.recentChannelEvents.length === 0) {
    return { completed: false, internal: null };
  }
  return {
    completed: true,
    internal: null,
    evidence: {
      satisfiedAtTick: observation.tickIndex,
      satisfiedAtMissionTimeUs: observation.missionTimeUs,
      inputEventIds: [],
      channelEventIds: observation.recentChannelEvents.map((c) => c.eventId),
      decodedStateChecksum: decodedDskyCanonical(observation.decoded),
      fixtureId: null,
      classification: "authentic-emulator",
      educationalInteractionOnly: false,
    },
  };
};

const FAKE_LESSON: LessonDefinition = {
  id: "regression-fake-lesson",
  title: "regression",
  summary: "",
  steps: [
    {
      id: "act",
      kind: "interactive",
      title: "act",
      body: "",
      predicate: alwaysCompleteOnFirstChannel,
      sources: [],
      classification: "authentic-emulator",
    },
  ],
};

function inProgressState(attemptId: string, boundaryEventId: number): LessonState {
  const attempt: LessonAttempt = {
    attemptId,
    startedAtTick: 0,
    startedAtCursor: boundaryEventId + 1,
    startedAtMissionTimeUs: 0,
    startDecodedChecksum: decodedDskyCanonical(makeEmptyDecodedDsky()),
  };
  return {
    lessonId: FAKE_LESSON.id,
    status: "in-progress",
    attempt,
    currentStepIndex: 0,
    completedStepIds: [],
    evidence: [],
    internal: {},
    lastObservationTick: 0,
  };
}

function makeBoundary(boundaryEventId: number): EventBoundaryPayload {
  const d = makeEmptyDecodedDsky();
  return {
    boundaryEventId,
    tickIndex: 100,
    missionTimeUs: 100 * 20000,
    totalAgcSteps: 0,
    decodedDsky: d,
    decodedDskyChecksum: decodedDskyCanonical(d),
  };
}

// -------- harness

interface Harness {
  root: Root;
  container: HTMLDivElement;
  client: AgcWorkerClient;
  push: (env: W2CEnvelope) => void;
  onStateChange: ReturnType<typeof vi.fn>;
  render: (props: {
    state: LessonState;
    boundary: EventBoundaryPayload | null;
  }) => Promise<void>;
  diag: () => Record<string, unknown> | undefined;
  states: LessonState[];
}

async function mountHarness(): Promise<Harness> {
  const { worker, push } = makeFakeWorker();
  const client = new AgcWorkerClient({ workerFactory: () => worker });
  const states: LessonState[] = [];
  const onStateChange = vi.fn((s: LessonState) => { states.push(s); });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = async (props: { state: LessonState; boundary: EventBoundaryPayload | null }) => {
    await act(async () => {
      root.render(
        React.createElement(LessonHost, {
          client,
          lesson: FAKE_LESSON,
          state: props.state,
          onStateChange,
          boundary: props.boundary,
        }),
      );
    });
  };

  // Push ready so LessonHost's onReady wiring settles.
  await act(async () => {
    push(envReady(makeReady()));
  });

  return {
    root,
    container,
    client,
    push: (env) => push(env),
    onStateChange,
    render,
    diag: () => (window as unknown as { __learnDiag?: Record<string, unknown> }).__learnDiag,
    states,
  };
}

let harness: Harness | null = null;
beforeEach(() => {
  workerSeq = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__learnDiag;
});
afterEach(async () => {
  if (harness) {
    await act(async () => { harness!.root.unmount(); });
    harness.container.remove();
    harness.client.dispose();
    harness = null;
  }
});

// ============================================================================

describe("LessonHost — attempt bootstrap (seed, buffer, dedupe, ordering)", () => {
  it("buffers channel events that arrive before boundary and replays them in eventId order on seed", async () => {
    harness = await mountHarness();
    const state = inProgressState("att-boot", 500);

    // Mount with the attempt open but NO boundary yet.
    await harness.render({ state, boundary: null });

    // Fire out-of-order pre-seed events. The reducer must buffer, not apply.
    await act(async () => {
      harness!.push(envChannel(makeChannel(503, 101)));
      harness!.push(envChannel(makeChannel(501, 101)));
      harness!.push(envChannel(makeChannel(499, 99))); // <= boundary → discarded on drain
      harness!.push(envChannel(makeChannel(502, 101)));
    });

    // Diag should reflect: no seed, but rawChannels captured 4 events.
    let d = harness.diag();
    expect(d?.seedCount ?? 0).toBe(0);
    expect((d?.rawChannels as unknown[])?.length ?? 0).toBe(4);

    // Now deliver the boundary.
    await harness.render({ state, boundary: makeBoundary(500) });

    d = harness.diag();
    expect(d?.seedCount).toBe(1);
    expect(d?.seedSource).toBe("attempt-key-change");
    // 4 buffered → 3 above the boundary (501, 502, 503) drained; 499 dropped.
    expect(d?.bufferedPreSeedCount).toBe(3);
    expect(d?.replayedPostSeedCount).toBe(3);
    expect(d?.firstReplayedEventId).toBe(501);
    expect(d?.lastProcessedEventId).toBe(503);
  });

  it("rejects duplicate and out-of-order channel events after seed (counters advance, shadow does not)", async () => {
    harness = await mountHarness();
    const state = inProgressState("att-mono", 600);

    await harness.render({ state, boundary: makeBoundary(600) });

    // First a legitimate event moves lastProcessedEventId to 605.
    await act(async () => {
      harness!.push(envChannel(makeChannel(605, 102, 0o11, 0)));
    });
    let d = harness.diag();
    expect(d?.lastProcessedEventId).toBe(605);
    expect(d?.duplicateEventCount ?? 0).toBe(0);

    // Duplicate id (605): duplicateEventCount++.
    await act(async () => {
      harness!.push(envChannel(makeChannel(605, 102, 0o11, 0)));
    });
    d = harness.diag();
    expect(d?.duplicateEventCount).toBe(1);
    expect(d?.outOfOrderEventCount ?? 0).toBe(0);
    expect(d?.lastProcessedEventId).toBe(605);

    // Out-of-order (604 < 605): outOfOrderEventCount++.
    await act(async () => {
      harness!.push(envChannel(makeChannel(604, 102, 0o11, 0)));
    });
    d = harness.diag();
    expect(d?.outOfOrderEventCount).toBe(1);
    expect(d?.lastProcessedEventId).toBe(605);
  });

  it("seeds exactly once per semantic attempt-key", async () => {
    harness = await mountHarness();
    const state = inProgressState("att-once", 700);
    const boundary = makeBoundary(700);

    await harness.render({ state, boundary });
    // Rerender with the SAME attempt + boundary: seed effect must not re-run.
    await harness.render({ state, boundary });
    await harness.render({ state, boundary });

    const d = harness.diag();
    expect(d?.seedCount).toBe(1);
  });
});

describe("LessonHost — terminal completion latching", () => {
  it("does not dispatch further observations after completion, even under a burst", async () => {
    harness = await mountHarness();
    const state = inProgressState("att-latch", 800);
    await harness.render({ state, boundary: makeBoundary(800) });

    // Single channel event completes the fake lesson.
    await act(async () => {
      harness!.push(envChannel(makeChannel(801, 200, 0o11, 0o1)));
    });

    // The predicate should have fired completion in a single onStateChange.
    const completed = harness.states.filter((s) => s.status === "completed");
    expect(completed.length).toBeGreaterThanOrEqual(1);
    // Correct lesson routing: the state carries its own lessonId.
    expect(completed[0].lessonId).toBe(FAKE_LESSON.id);

    const countBefore = harness.states.length;

    // Burst of further events post-completion — must NOT enter dispatch.
    await act(async () => {
      harness!.push(envChannel(makeChannel(802, 201, 0o11, 0o2)));
      harness!.push(envChannel(makeChannel(803, 202, 0o11, 0o4)));
      harness!.push(envChannel(makeChannel(804, 203, 0o11, 0o10)));
    });

    // No new state emissions.
    expect(harness.states.length).toBe(countBefore);
    // Every state ever emitted for this attempt is `completed` from
    // the completion event onward (no downgrade at the ref boundary).
    const post = harness.states.slice(harness.states.findIndex((s) => s.status === "completed"));
    expect(post.every((s) => s.status === "completed")).toBe(true);
  });

  it("rejects delayed in-progress prop reflection after synchronous completion", async () => {
    harness = await mountHarness();
    const attemptId = "att-delayed";
    const state = inProgressState(attemptId, 900);
    await harness.render({ state, boundary: makeBoundary(900) });

    // Complete synchronously.
    await act(async () => {
      harness!.push(envChannel(makeChannel(901, 300, 0o11, 0o1)));
    });
    expect(harness.states.at(-1)?.status).toBe("completed");

    // Parent now re-renders with a stale IN-PROGRESS prop for the SAME
    // attempt (delayed reflection). The Case-D guard must reject it and
    // increment propOverwriteAttempts.
    // Fresh object identity (same attemptId, still in-progress) so React
    // actually re-runs the prop effect that hosts the Case-D guard.
    const staleReflection: LessonState = { ...state };
    await harness.render({ state: staleReflection, boundary: makeBoundary(900) });

    let d = harness.diag();
    expect((d?.propOverwriteAttempts as number) ?? 0).toBeGreaterThanOrEqual(1);

    // Another burst — still no downgrade, no new onStateChange.
    const before = harness.states.length;
    await act(async () => {
      harness!.push(envChannel(makeChannel(902, 301, 0o11, 0o2)));
      harness!.push(envChannel(makeChannel(903, 302, 0o11, 0o4)));
    });
    d = harness.diag();
    expect(harness.states.length).toBe(before);
    expect((d?.downgradeAttempts as number) ?? 0).toBe(0);
    expect(harness.states.at(-1)?.status).toBe("completed");
  });
});

describe("LessonHost — React-microtask batching", () => {
  it("a burst of channel events in one microtask still latches the completing event", async () => {
    harness = await mountHarness();
    const state = inProgressState("att-batch", 1000);
    await harness.render({ state, boundary: makeBoundary(1000) });

    // Predicate completes on ANY channel event. Push three in one tick to
    // verify per-event dispatch, not per-render batching, drives completion.
    await act(async () => {
      harness!.push(envChannel(makeChannel(1001, 400, 0o11, 0o1)));
      harness!.push(envChannel(makeChannel(1002, 400, 0o11, 0o2)));
      harness!.push(envChannel(makeChannel(1003, 400, 0o11, 0o4)));
    });

    // Exactly one completion state must be present; subsequent events must
    // be short-circuited by the completion guard (cur.status === completed).
    const completed = harness.states.filter((s) => s.status === "completed");
    expect(completed.length).toBe(1);
    // Completion evidence must cite the FIRST event in the burst.
    const ev = completed[0].evidence[0];
    expect(ev?.channelEventIds).toEqual([1001]);
  });
});
