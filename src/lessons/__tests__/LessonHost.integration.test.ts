// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { AgcWorkerClient, type AgcWorkerLike } from "@/agc/AgcWorkerClient";
import { PROTOCOL_VERSION, makeEnvelope, type W2CEnvelope } from "@/agc/protocol";
import { buildObservation } from "@/lessons/LessonHost";
import { makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";
import { FIXTURE_PROVENANCE } from "@/lessons/fixtureExpectations";

function makeFakeWorker(): { worker: AgcWorkerLike; push: (env: W2CEnvelope) => void } {
  let messageHandler: ((ev: MessageEvent<W2CEnvelope>) => void) | null = null;
  const worker: AgcWorkerLike = {
    postMessage: () => {},
    addEventListener: (type: string, handler: any) => {
      if (type === "message") messageHandler = handler;
    },
    terminate: () => {},
  };
  return {
    worker,
    push: (env) => messageHandler?.({ data: env } as MessageEvent<W2CEnvelope>),
  };
}

describe("AgcWorkerClient.addListener", () => {
  it("fans out inputAccepted and channelUpdate to supplementary listeners without displacing primary", () => {
    const { worker, push } = makeFakeWorker();
    const client = new AgcWorkerClient({ workerFactory: () => worker });

    const primary = { onInputAccepted: vi.fn(), onChannelUpdate: vi.fn(), onSnapshot: vi.fn() };
    const supA = { onInputAccepted: vi.fn(), onChannelUpdate: vi.fn() };
    const supB = { onInputAccepted: vi.fn() };
    client.setListeners(primary);
    const unsubA = client.addListener(supA);
    client.addListener(supB);

    const inputEnv = makeEnvelope("w2c", 1, {
      type: "inputAccepted",
      payload: { eventId: 42, tickIndex: 3, missionTimeUs: 60000, kind: "dskyKeyDown", keyCode: 0o21 },
    });
    push(inputEnv as W2CEnvelope);

    expect(primary.onInputAccepted).toHaveBeenCalledTimes(1);
    expect(supA.onInputAccepted).toHaveBeenCalledTimes(1);
    expect(supB.onInputAccepted).toHaveBeenCalledTimes(1);

    // Unsubscribing supA stops only supA.
    unsubA();
    push(inputEnv as W2CEnvelope);
    expect(primary.onInputAccepted).toHaveBeenCalledTimes(2);
    expect(supA.onInputAccepted).toHaveBeenCalledTimes(1);
    expect(supB.onInputAccepted).toHaveBeenCalledTimes(2);

    client.dispose();
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe("LessonHost.buildObservation", () => {
  it("derives eventLogCursor from snapshot.channelEventCount and carries provenance verbatim", () => {
    const snap = {
      version: 1,
      missionTimeUs: 123_000,
      timingRemainderNs: 0,
      totalAgcSteps: 12345,
      timeScale: 1,
      running: true,
      lamps: 0,
      channels: {},
      channelEventCount: 77,
      recentEvents: [],
      erasableBase: 0,
      erasableWindow: [],
      avgTickMs: 20,
      schedulerOverruns: 0,
      tickIndex: 6,
      decodedDsky: makeEmptyDecodedDsky(),
    } as any;
    const obs = buildObservation({
      snapshot: snap,
      decoded: makeEmptyDecodedDsky(),
      previousDecoded: null,
      inputsSinceAttempt: [],
      channelsSincePrev: [],
      provenance: FIXTURE_PROVENANCE,
    });
    expect(obs.eventLogCursor).toBe(77);
    expect(obs.tickIndex).toBe(6);
    expect(obs.missionTimeUs).toBe(123_000);
    expect(obs.provenance).toBe(FIXTURE_PROVENANCE);
  });
});
