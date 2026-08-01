// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — shared helpers for the split /learn browser acceptance specs.
//
// The former monolithic `tests/learn.spec.ts` drove boot verification,
// reading navigation, two interactive DSKY lessons and session invariants
// inside ONE test. A single ~3-minute test against a real yaAGC worker has
// no useful failure attribution and is the reason the suite was flaky: any
// slow step anywhere consumed the budget for every later step.
//
// The helpers below are extracted verbatim in behaviour. The one semantic
// change is `waitForAttemptReady`, which now waits on the monotonic
// `LessonAttemptReadyV1` contract instead of polling a bare phase string.

import { expect, type Page, type ConsoleMessage, type BrowserContext } from "@playwright/test";

export interface AgcTestSnapshot {
  workerBoots?: number;
  snapshots?: number;
  ready?: {
    ropeId: string;
    ropeSha256: string;
    emulatorVersionString: string;
    emulatorCommit: string;
    protocolVersion: number;
  };
  snapshot?: {
    tickIndex: number;
    missionTimeUs: number;
    totalAgcSteps: number;
    channelEventCount: number;
    running: boolean;
    lamps: number;
    decodedDsky: unknown;
  };
  publishedDsky?: { sequence: number; decodedDsky: unknown };
}

/** Mirror of `LessonAttemptReadyV1` as seen through `window.__learnTest`. */
export interface AttemptReadyV1 {
  version: 1;
  lessonId: string;
  stepId: string;
  attemptId: string;
  agcEpoch: number;
  boundaryEventId: number;
  boundaryTick: number;
  listenerAttachedEventId: number | null;
  phase: "ready";
}

export interface LearnTestState {
  lessonId: string;
  stepId?: string | null;
  agcEpoch: number;
  attemptPhase?: "idle" | "gating" | "opening" | "ready" | "error";
  attemptError?: string | null;
  attemptReady?: AttemptReadyV1 | null;
  readinessContract?: {
    token: number;
    phase: string;
    ready: AttemptReadyV1 | null;
    error: string | null;
    staleWrites: number;
    downgradeAttempts: number;
    lastInvalidationReason: string | null;
  } | null;
  boundaryEventId?: number | null;
  boundaryTick?: number | null;
  latestEventId?: number | null;
  state: {
    lessonId: string;
    status: string;
    currentStepIndex: number;
    attempt: null | {
      attemptId: string;
      startedAtCursor: number;
      startedAtTick: number;
      startedAtMissionTimeUs: number;
    };
    evidence: Array<{
      lessonId: string;
      stepId: string;
      attemptId: string;
      satisfiedAtTick: number;
      inputEventIds: number[];
      channelEventIds: number[];
      decodedStateChecksum: string;
      classification: string;
    }>;
  };
}

export async function readAgc(page: Page): Promise<AgcTestSnapshot> {
  return await page.evaluate(() => {
    const w = window as unknown as { __agcTest?: unknown };
    return JSON.parse(JSON.stringify(w.__agcTest ?? {}));
  });
}

export async function readLearn(page: Page): Promise<LearnTestState> {
  return await page.evaluate(() => {
    const w = window as unknown as { __learnTest?: unknown };
    return JSON.parse(JSON.stringify(w.__learnTest ?? {}));
  });
}

export async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC/, { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __agcTest?: { ready?: unknown; snapshot?: unknown } };
      return !!(w.__agcTest?.ready && w.__agcTest?.snapshot);
    },
    { timeout: 60_000 },
  );
}

export async function tapKey(page: Page, testId: string): Promise<void> {
  // Rendered keypad click — the ONLY path that produces DSKY input events.
  await page.getByTestId(testId).click();
}

export async function tapSequence(page: Page, testIds: string[], gapMs = 90): Promise<void> {
  for (const id of testIds) {
    await tapKey(page, id);
    if (gapMs > 0) await page.waitForTimeout(gapMs);
  }
}

/**
 * Select a lesson by its stable lesson id.
 *
 * The sidebar is grouped into learning tracks (M4.2), so ordinal position is
 * NOT stable — an ordinal selector silently picks a different lesson whenever
 * tracks are re-ordered. Always address the lesson by id.
 */
export async function selectLesson(page: Page, lessonId: string): Promise<void> {
  const btn = page.getByTestId(`lesson-nav-${lessonId}`);
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-current", "true", { timeout: 10_000 });
  await page.waitForFunction(
    (lid) => (window as unknown as { __learnTest?: { lessonId?: string } }).__learnTest?.lessonId === lid,
    lessonId,
    { timeout: 10_000 },
  );
}

export async function ackReading(page: Page): Promise<void> {
  await page.getByRole("button", { name: /I['’]ve read this|continue/i }).first().click();
}

/** Acknowledge reading steps until the lesson completes or stops offering an
 *  ack control. Bounded, predicate-driven — never a fixed sleep. */
export async function ackUntilSettled(page: Page, max = 10): Promise<void> {
  for (let i = 0; i < max; i++) {
    const st = await readLearn(page);
    if (st.state?.status === "completed") return;
    const ackBtn = page.getByRole("button", { name: /I['’]ve read this|continue/i }).first();
    if (!(await ackBtn.isVisible().catch(() => false))) return;
    await ackBtn.click();
    await page.waitForTimeout(50);
  }
}

/**
 * M4.5 readiness contract barrier.
 *
 * Waits until the page has published a `LessonAttemptReadyV1` whose identity
 * matches the lesson under test AND the engine holds the same attempt. The
 * old barrier polled `attemptPhase === "ready"`, which could be satisfied by
 * a previous step's workflow, or never satisfied at all when a cancelled
 * workflow left the phase pinned at "idle".
 */
export async function waitForAttemptReady(
  page: Page,
  lessonId: string,
  timeoutMs = 90_000,
): Promise<LearnTestState> {
  await page.waitForFunction(
    (lid) => {
      const s = (window as unknown as { __learnTest?: LearnTestState }).__learnTest;
      if (!s || s.lessonId !== lid) return false;
      const ready = s.attemptReady;
      const attempt = s.state?.attempt;
      return !!(
        ready &&
        ready.phase === "ready" &&
        ready.lessonId === lid &&
        ready.agcEpoch === s.agcEpoch &&
        attempt &&
        attempt.attemptId === ready.attemptId
      );
    },
    lessonId,
    { timeout: timeoutMs },
  );
  return await readLearn(page);
}

/** Advance past leading reading steps, then wait on the readiness contract. */
export async function advanceToInteractive(page: Page, lessonId: string): Promise<LearnTestState> {
  for (let i = 0; i < 8; i++) {
    const st = await readLearn(page);
    if (st.lessonId !== lessonId) break;
    if (st.attemptPhase === "gating" || st.attemptPhase === "opening" || st.attemptPhase === "ready") break;
    const ackBtn = page.getByRole("button", { name: /I['’]ve read this|continue/i }).first();
    if (!(await ackBtn.isVisible().catch(() => false))) break;
    await ackBtn.click();
    await page.waitForTimeout(80);
  }
  return await waitForAttemptReady(page, lessonId);
}

export async function waitUntilLessonComplete(
  page: Page,
  lessonId: string,
  timeoutMs = 60_000,
): Promise<void> {
  try {
    await page.waitForFunction(
      (lid) => {
        const s = (window as unknown as { __learnTest?: LearnTestState }).__learnTest;
        return !!(s && s.lessonId === lid && s.state.status === "completed");
      },
      lessonId,
      { timeout: timeoutMs },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lesson-timeout]", await diagnostics(page));
    throw err;
  }
}

export async function diagnostics(page: Page): Promise<string> {
  const [agc, learn] = await Promise.all([readAgc(page), readLearn(page)]);
  return JSON.stringify(
    {
      workerBoots: agc.workerBoots,
      snapshots: agc.snapshots,
      ready: agc.ready
        ? { ropeId: agc.ready.ropeId, sha: agc.ready.ropeSha256.slice(0, 16), ver: agc.ready.emulatorVersionString }
        : null,
      snap: agc.snapshot && {
        tickIndex: agc.snapshot.tickIndex,
        missionTimeUs: agc.snapshot.missionTimeUs,
        totalAgcSteps: agc.snapshot.totalAgcSteps,
        channelEventCount: agc.snapshot.channelEventCount,
      },
      learn: learn && {
        lessonId: learn.lessonId,
        agcEpoch: learn.agcEpoch,
        status: learn.state?.status,
        step: learn.state?.currentStepIndex,
        attempt: learn.state?.attempt,
        attemptPhase: learn.attemptPhase,
        attemptReady: learn.attemptReady,
        contract: learn.readinessContract,
        evidence: learn.state?.evidence?.length,
      },
    },
    null,
    2,
  );
}

/** Per-test error/worker recorder shared by every split spec. */
export interface LearnRecorder {
  consoleErrors: string[];
  pageErrors: string[];
  workerUrls: string[];
  agcWorkers(): string[];
}

export function attachRecorder(page: Page, context: BrowserContext): LearnRecorder {
  const rec: LearnRecorder = {
    consoleErrors: [],
    pageErrors: [],
    workerUrls: [],
    agcWorkers: () => rec.workerUrls.filter((u) => u.includes("AgcWorker")),
  };
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") rec.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => rec.pageErrors.push(String(e)));
  context.on("weberror", (e) => rec.pageErrors.push(String(e)));
  page.on("worker", (w) => rec.workerUrls.push(w.url()));
  return rec;
}

/** Assert no AGC-relevant console or page errors accumulated. */
export function expectNoRelevantErrors(rec: LearnRecorder): void {
  expect(rec.pageErrors, `pageErrors=${rec.pageErrors.join("\n")}`).toEqual([]);
  const relevant = rec.consoleErrors.filter((e) => /agc|lesson|worker|dsky/i.test(e));
  expect(relevant, `errors=${relevant.join("\n")}`).toEqual([]);
}
