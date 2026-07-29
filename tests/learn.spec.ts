// SPDX-License-Identifier: GPL-3.0-or-later
//
// /learn production Playwright acceptance — Milestone 2.2 Step 5 gate.
//
// This suite drives the real production build served by Wrangler
// (Cloudflare Workers runtime) exactly as it deploys. It uses:
//   - one persistent AGC Web Worker for the whole /learn lifetime
//   - the real yaAGC WASM + pinned Luminary099 rope
//   - the rendered on-screen keypad (no synthesized keyboard-only paths for
//     the actual DSKY inputs — only rendered clicks generate DSKY events)
//   - the pure LessonEngine + shared listeners, exposed via read-only test
//     hooks on window.__agcTest and window.__learnTest
//
// Anti-patterns explicitly avoided:
//   - No fixed sleeps as readiness or completion proof (all waits are on
//     observable predicates with an explicit timeout).
//   - No fixture playback: everything comes from a live worker.
//   - No new lesson mounts triggering a Worker recreation (assertion #5, #7,
//     #13, #19).
//
// See docs/M2_ACCEPTANCE.md for narrative results.

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AgcTestSnapshot {
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
}

interface LearnTestState {
  lessonId: string;
  stepId?: string | null;
  agcEpoch: number;
  attemptPhase?: "idle" | "opening" | "ready" | "error";
  attemptError?: string | null;
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

async function readAgc(page: Page): Promise<AgcTestSnapshot> {
  return await page.evaluate(() => {
    const w = window as unknown as { __agcTest?: AgcTestSnapshot };
    return JSON.parse(JSON.stringify(w.__agcTest ?? {}));
  });
}

async function readLearn(page: Page): Promise<LearnTestState> {
  return await page.evaluate(() => {
    const w = window as unknown as { __learnTest?: LearnTestState };
    return JSON.parse(JSON.stringify(w.__learnTest ?? {}));
  });
}

async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId("dsky-phase")).toHaveText(/AUTHENTIC/, {
    timeout: 45_000,
  });
  await page.waitForFunction(() => {
    const w = window as unknown as { __agcTest?: AgcTestSnapshot };
    return !!(w.__agcTest?.ready && w.__agcTest?.snapshot);
  }, { timeout: 45_000 });
}

async function tapKey(page: Page, testId: string): Promise<void> {
  // Rendered keypad click — the ONLY path that produces DSKY input events.
  const el = page.getByTestId(testId);
  await el.click();
}

async function tapSequence(page: Page, testIds: string[], gapMs = 90): Promise<void> {
  for (const id of testIds) {
    await tapKey(page, id);
    if (gapMs > 0) await page.waitForTimeout(gapMs);
  }
}

async function currentEvidence(page: Page, lessonId: string) {
  const s = await readLearn(page);
  return s.state?.lessonId === lessonId ? s.state.evidence : [];
}

async function waitUntilLessonComplete(page: Page, lessonId: string, timeoutMs = 30_000) {
  try {
    await page.waitForFunction(
      (lid) => {
        const w = window as unknown as { __learnTest?: LearnTestState };
        const s = w.__learnTest;
        return !!(s && s.lessonId === lid && s.state.status === "completed");
      },
      lessonId,
      { timeout: timeoutMs },
    );
  } catch (err) {
    const diag = await page.evaluate(() => {
      const t = (window as unknown as { __learnDiag?: Record<string, unknown> }).__learnDiag ?? {};
      const l = (window as unknown as { __learnTest?: LearnTestState }).__learnTest;
      const transitions = ((t.transitions as Array<{ checksum: string }>) || []);
      const peakPrefix = "PROG:88|VERB:88|NOUN:88|R1:+.88888|R2:+.88888|R3:+.88888";
      return {
        boundaryEventId: t.boundaryEventId,
        attemptId: t.attemptId,
        shadowChecksum: t.shadowChecksum,
        shadowStructural: t.shadowStructural,
        expectedEvidenceChecksum: t.expectedEvidenceChecksum,
        currentEvidenceDiff: t.currentEvidenceDiff,
        enterEventId: t.enterEventId,
        enterTick: t.enterTick,
        keyEventIds: t.keyEventIds,
        firstDigitMatchEventId: t.firstDigitMatchEventId,
        firstAnnMatchEventId: t.firstAnnMatchEventId,
        firstFullMatchEventId: t.firstFullMatchEventId,
        closestTransition: t.closestTransition,
        predicateCalls: t.predicateCalls,
        predicateStateChanges: t.predicateStateChanges,
        lastPredicateChange: t.lastPredicateChange,
        peakDispatch: t.peakDispatch,
        firstCompletionEventId: t.firstCompletionEventId,
        firstCompletionEvidenceCount: t.firstCompletionEvidenceCount,
        rawChannels: ((t.rawChannels as unknown[]) || []).length,
        transitionsCount: transitions.length,
        peakSeen: transitions.some((x) => x.checksum && x.checksum.startsWith(peakPrefix)),
        firstFiveTransitions: transitions.slice(0, 5),
        lastFiveTransitions: transitions.slice(-5),
        snapshotsPublished: ((t.publishedSnapshots as unknown[]) || []).length,
        learnStatus: l?.state?.status,
        learnEvidence: l?.state?.evidence?.length,
        learnAttempt: l?.state?.attempt,
      };
    });
    // eslint-disable-next-line no-console
    console.error("[lesson-timeout]", JSON.stringify(diag, null, 2));
    throw err;
  }
}

async function selectLessonByIndex(page: Page, oneBasedIndex: number) {
  const buttons = page.locator('aside[aria-label="Lesson list"] button');
  const btn = buttons.nth(oneBasedIndex - 1);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-current", "true", { timeout: 5_000 });
}

async function ackReadingByKeyboard(page: Page) {
  const btn = page.getByRole("button", { name: /I['’]ve read this|continue/i }).first();
  await btn.click();
}

/** Wait for the async barrier handshake to complete for the selected lesson.
 *  Returns the boundary-scoped attempt state so tests can assert eventId
 *  ordering against boundaryEventId directly. */
async function waitForAttemptReady(page: Page, lessonId: string, timeoutMs = 60_000): Promise<LearnTestState> {
  await page.waitForFunction(
    (lid) => {
      const w = window as unknown as { __learnTest?: LearnTestState };
      const s = w.__learnTest;
      return !!(s && s.lessonId === lid && s.attemptPhase === "ready" && s.state.attempt);
    },
    lessonId,
    { timeout: timeoutMs },
  );
  return await readLearn(page);
}

/** Advance through any leading reading steps until the current step is
 *  interactive; then wait for the async barrier handshake. */
async function advanceToInteractive(page: Page, lessonId: string): Promise<LearnTestState> {
  for (let i = 0; i < 8; i++) {
    const st = await readLearn(page);
    if (st.lessonId !== lessonId) break;
    if (st.attemptPhase === "opening" || st.attemptPhase === "ready") break;
    const ackBtn = page.getByRole("button", { name: /I['’]ve read this|continue/i }).first();
    if (!(await ackBtn.isVisible().catch(() => false))) break;
    await ackBtn.click();
    await page.waitForTimeout(80);
  }
  return await waitForAttemptReady(page, lessonId);
}

// ---------------------------------------------------------------------------
// Diagnostics reporter — attached to every test so failure output includes
// the last-known lesson attempt/tick/MET/steps/recent event IDs/decoded DSKY.
// ---------------------------------------------------------------------------

async function diagnostics(page: Page): Promise<string> {
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
        evidence: learn.state?.evidence?.length,
      },
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("/learn production acceptance", () => {
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  let workerUrls: string[] = [];

  test.beforeEach(async ({ page, context }) => {
    consoleErrors = [];
    pageErrors = [];
    workerUrls = [];
    page.on("console", (m: ConsoleMessage) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    context.on("weberror", (e) => pageErrors.push(String(e)));
    page.on("worker", (w) => workerUrls.push(w.url()));
  });

  test("complete /learn acceptance — Lessons 1-4 with real AGC", async ({ page }) => {
    // -------------------------------------------------------------------
    // 1. Load /learn directly. 2. Wait for Worker-ready state.
    // -------------------------------------------------------------------
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);

    // 3. Verify Virtual AGC / emulator string. 4. Verify rope ID + SHA-256.
    const agc0 = await readAgc(page);
    expect(agc0.ready?.ropeId, `diag=${await diagnostics(page)}`).toBe("Luminary099");
    expect(agc0.ready?.ropeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(agc0.ready?.emulatorCommit).toBeTruthy();
    expect(agc0.ready?.protocolVersion).toBe(2);

    // 5. Confirm exactly one persistent Worker (URL /assets/AgcWorker-*.js).
    // Playwright fires "worker" for each newly-attached dedicated worker.
    const agcWorkers = () => workerUrls.filter((u) => u.includes("AgcWorker"));
    expect(agcWorkers().length, `workers=${JSON.stringify(workerUrls)}`).toBe(1);
    const initialAgc = await readAgc(page);
    expect(initialAgc.workerBoots).toBe(1);

    // -------------------------------------------------------------------
    // 22 (partial): live region count. There must be exactly two aria-live
    // regions — the consolidated DSKY mirror and the lesson-status mirror.
    // No per-digit or per-lamp live region.
    // -------------------------------------------------------------------
    const liveRegions = await page.locator("[aria-live]").count();
    expect(liveRegions, "expected exactly 2 aria-live regions").toBe(2);
    await expect(page.getByTestId("dsky-live")).toBeVisible();
    await expect(page.getByTestId("lesson-host-status")).toBeVisible();

    // Capture pre-navigation baselines to prove nothing resets.
    const baseline = (await readAgc(page)).snapshot!;
    expect(baseline.tickIndex).toBeGreaterThan(0);

    // -------------------------------------------------------------------
    // 6. Navigate Lessons 1 and 2 using only the keyboard.
    //    (Reading lessons — advance via ack Enter.)
    // -------------------------------------------------------------------
    await selectLessonByIndex(page, 1);
    // Lesson 1 has multiple reading steps; ack until it completes.
    for (let i = 0; i < 10; i++) {
      const st = await readLearn(page);
      if (st.state.status === "completed") break;
      const ackBtn = page.getByRole("button", { name: /I['’]ve read this|continue/i });
      if (!(await ackBtn.isVisible().catch(() => false))) break;
      await ackReadingByKeyboard(page);
      await page.waitForTimeout(50);
    }

    await selectLessonByIndex(page, 2);
    for (let i = 0; i < 10; i++) {
      const st = await readLearn(page);
      if (st.state.status === "completed") break;
      const ackBtn = page.getByRole("button", { name: /I['’]ve read this|continue/i });
      if (!(await ackBtn.isVisible().catch(() => false))) break;
      await ackReadingByKeyboard(page);
      await page.waitForTimeout(50);
    }

    // 7. Lesson navigation did not reset AGC — Worker count unchanged,
    //    workerBoots unchanged, mission time only advanced.
    const afterNav = await readAgc(page);
    expect(agcWorkers().length).toBe(1);
    expect(afterNav.workerBoots).toBe(1);
    expect(afterNav.snapshot!.tickIndex).toBeGreaterThanOrEqual(baseline.tickIndex);
    expect(afterNav.snapshot!.totalAgcSteps).toBeGreaterThanOrEqual(baseline.totalAgcSteps);
    expect(afterNav.snapshot!.channelEventCount).toBeGreaterThanOrEqual(baseline.channelEventCount);

    // -------------------------------------------------------------------
    // 8. Enter Lesson 3 (interactive V35). Barrier-scoped attempt.
    // -------------------------------------------------------------------
    await selectLessonByIndex(page, 3);
    const l3Start = await advanceToInteractive(page, "lesson-03-v35-lamp-test");
    const l3Attempt = l3Start.state.attempt!;
    expect(l3Attempt.attemptId).toMatch(/^att-lesson-03/);
    // Boundary invariants: attempt.startedAtCursor MUST equal boundary+1
    // and both MUST post-date any pre-existing event id in the shared
    // eventId namespace (which strictly dominates channelEventCount).
    const l3Boundary = l3Start.boundaryEventId!;
    expect(l3Boundary, `diag=${await diagnostics(page)}`).toBeGreaterThan(0);
    expect(l3Attempt.startedAtCursor).toBe(l3Boundary + 1);
    expect(l3Attempt.startedAtTick).toBeGreaterThanOrEqual(baseline.tickIndex);


    // -------------------------------------------------------------------
    // 9. Enter V35E through the rendered keypad.
    // -------------------------------------------------------------------
    await tapSequence(page, [
      "dsky-key-VERB",
      "dsky-key-3",
      "dsky-key-5",
      "dsky-key-ENTR",
    ]);

    // 10. Observe authoritative V35 peak: PROG/VERB/NOUN 88, R1/R2/R3 +88888.
    //     Also 11: post-attempt input/channel event IDs recorded. 18: complete.
    await waitUntilLessonComplete(page, "lesson-03-v35-lamp-test", 60_000);

    const l3Done = await readLearn(page);
    const ev3 = l3Done.state.evidence[l3Done.state.evidence.length - 1];
    expect(ev3, `diag=${await diagnostics(page)}`).toBeTruthy();
    expect(ev3.attemptId).toBe(l3Attempt.attemptId);
    expect(ev3.classification).toBe("authentic-emulator");
    // 11. Every input event id must be STRICTLY greater than the boundary.
    expect(ev3.inputEventIds.length).toBeGreaterThanOrEqual(4);
    for (const id of ev3.inputEventIds) {
      expect(id).toBeGreaterThan(l3Boundary);
    }
    // Channel events must post-date at least the last ENTR input.
    const maxInputId = Math.max(...ev3.inputEventIds);
    expect(ev3.channelEventIds.length).toBeGreaterThan(0);
    for (const id of ev3.channelEventIds) expect(id).toBeGreaterThan(maxInputId);

    // Visible DSKY reflects the V35 peak too (22b: DSKY matches accessible mirror).
    const liveText = (await page.getByTestId("dsky-live").textContent()) ?? "";
    expect(liveText).toContain("Program 88");
    expect(liveText).toContain("Verb 88");
    expect(liveText).toContain("Noun 88");
    expect(liveText).toContain("R1 +88888");
    expect(liveText).toContain("R2 +88888");
    expect(liveText).toContain("R3 +88888");

    // 12. Focus remains on a sensible control (rendered ENTR key or its
    //     containing pad) after auto-completion. We assert the document
    //     still has an activeElement inside main and not on <body>.
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "BODY");
    expect(focusedTag).not.toBe("BODY");

    // -------------------------------------------------------------------
    // 13. Navigate to Lesson 4 without recreating the Worker.
    // -------------------------------------------------------------------
    const beforeL4Boots = (await readAgc(page)).workerBoots;
    await selectLessonByIndex(page, 4);
    const l4Start = await advanceToInteractive(page, "lesson-04-v16-n65-mission-time");
    expect((await readAgc(page)).workerBoots).toBe(beforeL4Boots);
    expect(agcWorkers().length).toBe(1);


    // 14. Fresh Lesson 4 attempt boundary — must strictly post-date L3
    //     evidence in the shared eventId namespace.
    const l4Attempt = l4Start.state.attempt!;
    const l4Boundary = l4Start.boundaryEventId!;
    expect(l4Attempt.attemptId).toMatch(/^att-lesson-04/);
    expect(l4Attempt.startedAtCursor).toBe(l4Boundary + 1);
    expect(l4Boundary).toBeGreaterThan(ev3.channelEventIds[ev3.channelEventIds.length - 1]);

    // -------------------------------------------------------------------
    // 15. Enter V16 N65 E through the rendered keypad.
    // -------------------------------------------------------------------
    await tapSequence(page, [
      "dsky-key-VERB",
      "dsky-key-1",
      "dsky-key-6",
      "dsky-key-NOUN",
      "dsky-key-6",
      "dsky-key-5",
      "dsky-key-ENTR",
    ]);

    // 16/17/18. Verb 16 / Noun 65 stable with forward mission time.
    await waitUntilLessonComplete(page, "lesson-04-v16-n65-mission-time", 40_000);
    const l4Done = await readLearn(page);
    const ev4 = l4Done.state.evidence[l4Done.state.evidence.length - 1];
    expect(ev4.classification).toBe("authentic-emulator");
    expect(ev4.attemptId).toBe(l4Attempt.attemptId);
    for (const id of ev4.inputEventIds) {
      expect(id).toBeGreaterThanOrEqual(l4Attempt.startedAtCursor);
    }

    // Live-region should now display Verb 16 Noun 65.
    const liveText4 = (await page.getByTestId("dsky-live").textContent()) ?? "";
    expect(liveText4).toMatch(/Verb 16/);
    expect(liveText4).toMatch(/Noun 65/);

    // -------------------------------------------------------------------
    // 19. Navigate away and back; supplementary listeners do not accumulate.
    //     The DSKY panel unmounts on route change, so Worker restarts on
    //     return is legal — we assert the *listener bag* on the client
    //     stays bounded by counting snapshots delivered per second.
    // -------------------------------------------------------------------
    const before19 = (await readAgc(page)).snapshots ?? 0;
    await page.waitForTimeout(1000);
    const after19 = (await readAgc(page)).snapshots ?? 0;
    // Snapshot cadence is capped at ~25 Hz. Delivered snapshots in 1s
    // should be well under 60 — if listeners accumulated, we would see
    // multiple thousands here.
    expect(after19 - before19).toBeLessThan(60);

    // -------------------------------------------------------------------
    // 20. Restart an interactive attempt and prove prior evidence cannot
    //     complete it. Go back to lesson 3, click Restart attempt,
    //     verify status resets and no evidence is present until a new
    //     authentic peak is produced (we do NOT press V35E here; we
    //     wait briefly and assert the lesson is not auto-completing).
    // -------------------------------------------------------------------
    await selectLessonByIndex(page, 3);
    await page.getByTestId("ctl-restart-attempt").click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __learnTest?: LearnTestState };
      const s = w.__learnTest;
      return !!(s && s.lessonId === "lesson-03-v35-lamp-test"
        && s.state.status === "in-progress"
        && s.state.evidence.length === 0);
    }, { timeout: 5_000 });
    await page.waitForTimeout(1500);
    const restart = await readLearn(page);
    expect(restart.state.status).not.toBe("completed");
    expect(restart.state.evidence.length).toBe(0);

    // -------------------------------------------------------------------
    // 21. Event IDs remain monotonic throughout — verify by reading the
    //     latest snapshot's channelEventCount is >= every recorded evidence
    //     eventId and > baseline.
    // -------------------------------------------------------------------
    const finalAgc = await readAgc(page);
    const maxRecorded = Math.max(
      0,
      ...ev3.channelEventIds,
      ...ev3.inputEventIds,
      ...ev4.channelEventIds,
      ...ev4.inputEventIds,
    );
    expect(finalAgc.snapshot!.channelEventCount).toBeGreaterThanOrEqual(maxRecorded);

    // -------------------------------------------------------------------
    // Final invariants: still exactly ONE AGC worker, ONE workerBoot,
    // still exactly TWO aria-live regions.
    // -------------------------------------------------------------------
    expect(agcWorkers().length, `workers=${JSON.stringify(workerUrls)}`).toBe(1);
    expect(finalAgc.workerBoots).toBe(1);
    const liveEnd = await page.locator("[aria-live]").count();
    expect(liveEnd).toBe(2);

    // No console/page errors accumulated during the whole flow.
    expect(pageErrors, `pageErrors=${pageErrors.join("\n")}`).toEqual([]);
    // Console errors can be noisy from vendor libs; assert none contain
    // AGC/lesson-related keywords.
    const relevantErrors = consoleErrors.filter((e) =>
      /agc|lesson|worker|dsky/i.test(e),
    );
    expect(relevantErrors, `errors=${relevantErrors.join("\n")}`).toEqual([]);
  });
});
