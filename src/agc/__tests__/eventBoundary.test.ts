// SPDX-License-Identifier: GPL-3.0-or-later
// Attempt-boundary handshake tests.
//
// Contract (M2.2 Step 5):
//   1. requestEventBoundary consumes a fresh id from the SAME nextEventId
//      counter used by inputAccepted and channelUpdate.
//   2. Every subsequent input/channel event carries eventId > boundaryEventId.
//   3. Client rejects the promise if the worker replies with a fatalError.

import { describe, expect, it, vi } from "vitest";
import { AgcWorkerClient, type AgcWorkerLike } from "../AgcWorkerClient";
import {
  PROTOCOL_VERSION,
  makeEnvelope,
  type C2WEnvelope,
  type W2CEnvelope,
} from "../protocol";
import { makeEmptyDecodedDsky, decodedDskyCanonical } from "../dsky/DskyDecoder";

interface FakeWorker extends AgcWorkerLike {
  messages: C2WEnvelope[];
  handlers: { message: Array<(ev: MessageEvent<W2CEnvelope>) => void>; error: Array<(ev: unknown) => void> };
  fire(env: W2CEnvelope): void;
}

function makeFakeWorker(): FakeWorker {
  const handlers = {
    message: [] as Array<(ev: MessageEvent<W2CEnvelope>) => void>,
    error: [] as Array<(ev: unknown) => void>,
  };
  const messages: C2WEnvelope[] = [];
  const fw: FakeWorker = {
    messages,
    handlers,
    postMessage(msg: unknown) { messages.push(msg as C2WEnvelope); },
    addEventListener(type: "message" | "error", handler: ((ev: MessageEvent<W2CEnvelope>) => void) | ((ev: unknown) => void)) {
      if (type === "message") handlers.message.push(handler as (ev: MessageEvent<W2CEnvelope>) => void);
      if (type === "error") handlers.error.push(handler as (ev: unknown) => void);
    },
    removeEventListener() { /* noop */ },
    terminate() { /* noop */ },
    fire(env: W2CEnvelope) {
      for (const h of handlers.message) h({ data: env } as MessageEvent<W2CEnvelope>);
    },
  };
  return fw;
}

describe("event-boundary handshake", () => {
  it("client sends requestEventBoundary and resolves with the payload", async () => {
    const fake = makeFakeWorker();
    const client = new AgcWorkerClient({ workerFactory: () => fake });

    const pending = client.requestEventBoundary();
    // Latest c2w envelope should be a requestEventBoundary command with a requestId.
    const sent = fake.messages[fake.messages.length - 1]!;
    expect(sent.message.type).toBe("requestEventBoundary");
    expect(sent.requestId).toBeTruthy();

    // Simulate the worker reply with the SAME requestId.
    const reply: W2CEnvelope = makeEnvelope(
      "w2c",
      1,
      { type: "eventBoundary", payload: { boundaryEventId: 42, tickIndex: 7, missionTimeUs: 140000, totalAgcSteps: 11942 } },
      { requestId: sent.requestId },
    );
    reply.protocol = PROTOCOL_VERSION;
    fake.fire(reply);

    const payload = await pending;
    expect(payload.boundaryEventId).toBe(42);
    expect(payload.tickIndex).toBe(7);
    client.dispose();
  });

  it("multiple sequential boundaries consume strictly-increasing ids", async () => {
    // We simulate the worker allocating ids monotonically.
    const fake = makeFakeWorker();
    const client = new AgcWorkerClient({ workerFactory: () => fake });

    let nextId = 100;
    // Auto-reply to every requestEventBoundary from the fake.
    const originalPost = fake.postMessage;
    fake.postMessage = (msg: unknown) => {
      originalPost.call(fake, msg);
      const env = msg as C2WEnvelope;
      if (env.message.type === "requestEventBoundary") {
        const id = nextId++;
        const reply: W2CEnvelope = makeEnvelope(
          "w2c",
          id,
          { type: "eventBoundary", payload: { boundaryEventId: id, tickIndex: id, missionTimeUs: id * 20000, totalAgcSteps: id * 1706 } },
          { requestId: env.requestId },
        );
        // Fire on microtask so the pending map has the entry.
        queueMicrotask(() => fake.fire(reply));
      }
    };

    const b1 = await client.requestEventBoundary();
    const b2 = await client.requestEventBoundary();
    const b3 = await client.requestEventBoundary();
    expect(b2.boundaryEventId).toBeGreaterThan(b1.boundaryEventId);
    expect(b3.boundaryEventId).toBeGreaterThan(b2.boundaryEventId);
    client.dispose();
  });

  it("fatalError on the reply rejects the pending boundary promise", async () => {
    const fake = makeFakeWorker();
    const client = new AgcWorkerClient({ workerFactory: () => fake });
    const onFatal = vi.fn();
    client.setListeners({ onFatalError: onFatal });

    const pending = client.requestEventBoundary();
    const sent = fake.messages[fake.messages.length - 1]!;
    const reply: W2CEnvelope = makeEnvelope(
      "w2c",
      1,
      { type: "fatalError", payload: { code: "worker", message: "kaboom" } },
      { requestId: sent.requestId },
    );
    fake.fire(reply);

    await expect(pending).rejects.toThrow(/kaboom/);
    expect(onFatal).toHaveBeenCalled();
    client.dispose();
  });
});
