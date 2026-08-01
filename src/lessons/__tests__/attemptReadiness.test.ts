// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — readiness contract unit tests. These encode the guarantees the
// browser acceptance suite relies on, so a regression fails in milliseconds
// rather than as an intermittent 60-second Playwright timeout.

import { describe, expect, it } from "vitest";
import { AttemptReadinessPublisher } from "../attemptReadiness";

function ready(p: AttemptReadinessPublisher, token: number, over: Partial<Record<string, unknown>> = {}) {
  return p.publishReady(token, {
    lessonId: "lesson-03-v35-lamp-test",
    stepId: "step-1",
    attemptId: "att-lesson-03-1",
    agcEpoch: 0,
    boundaryEventId: 41,
    boundaryTick: 7,
    ...(over as object),
  });
}

describe("AttemptReadinessPublisher", () => {
  it("starts idle with no readiness record", () => {
    const p = new AttemptReadinessPublisher();
    expect(p.read().phase).toBe("idle");
    expect(p.read().ready).toBeNull();
  });

  it("publishes a complete, frozen identity", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    const rec = ready(p, t)!;
    expect(rec.phase).toBe("ready");
    expect(rec.version).toBe(1);
    expect(rec.boundaryEventId).toBe(41);
    expect(Object.isFrozen(rec)).toBe(true);
    expect(p.read().phase).toBe("ready");
  });

  it("repeated reads return the identical identity object", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    ready(p, t);
    expect(p.read().ready).toBe(p.read().ready);
    expect(p.read()).toBe(p.read());
  });

  it("publishing twice is idempotent — attempt identity never changes", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    const a = ready(p, t)!;
    const b = ready(p, t, { attemptId: "att-other" })!;
    expect(b).toBe(a);
  });

  it("never downgrades ready to opening or idle", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    ready(p, t);
    expect(p.setPhase(t, "opening")).toBe(false);
    expect(p.setPhase(t, "idle")).toBe(false);
    expect(p.read().phase).toBe("ready");
    expect(p.read().downgradeAttempts).toBe(2);
  });

  it("refuses every mutation from a stale token", () => {
    const p = new AttemptReadinessPublisher();
    const stale = p.begin("first");
    const fresh = p.begin("second");
    expect(p.setPhase(stale, "opening")).toBe(false);
    expect(ready(p, stale)).toBeNull();
    expect(p.fail(stale, "boom")).toBe(false);
    expect(p.read().staleWrites).toBe(3);
    expect(p.read().phase).toBe("idle");
    expect(p.isCurrent(fresh)).toBe(true);
  });

  it("invalidation clears readiness and records the reason", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    ready(p, t);
    p.invalidate("lesson-changed");
    expect(p.read().phase).toBe("idle");
    expect(p.read().ready).toBeNull();
    expect(p.read().lastInvalidationReason).toBe("lesson-changed");
  });

  it("failure is terminal for the token but cannot overwrite ready", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "gating");
    expect(p.fail(t, "readiness timeout")).toBe(true);
    expect(p.read().phase).toBe("error");
    expect(p.read().error).toBe("readiness timeout");

    const t2 = p.begin("retry");
    p.setPhase(t2, "opening");
    ready(p, t2);
    expect(p.fail(t2, "late error")).toBe(false);
    expect(p.read().phase).toBe("ready");
  });

  it("carries the listener-attached event id when supplied", () => {
    const p = new AttemptReadinessPublisher();
    const t = p.begin("open");
    p.setPhase(t, "opening");
    const rec = ready(p, t, { listenerAttachedEventId: 44 })!;
    expect(rec.listenerAttachedEventId).toBe(44);
    expect(rec.boundaryEventId).toBeLessThan(rec.listenerAttachedEventId!);
  });
});
