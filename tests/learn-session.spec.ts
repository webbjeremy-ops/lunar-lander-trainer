// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — /learn shared-session acceptance.
//
// Scope: the invariants that only show up over a longer session — listener
// accumulation, attempt restart hygiene, and the readiness contract's
// monotonicity under rapid lesson switching (the exact pattern that used to
// deadlock the attempt handshake).

import { test, expect } from "@playwright/test";
import {
  advanceToInteractive,
  attachRecorder,
  diagnostics,
  expectNoRelevantErrors,
  readAgc,
  readLearn,
  selectLessonByIndex,
  waitForAttemptReady,
  waitForReady,
  type LearnRecorder,
  type LearnTestState,
} from "./support/learn";

const L3 = "lesson-03-v35-lamp-test";

test.describe("/learn shared session", () => {
  let rec: LearnRecorder;

  test.beforeEach(async ({ page, context }) => {
    rec = attachRecorder(page, context);
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);
  });

  test("snapshot listeners do not accumulate over the session", async ({ page }) => {
    await selectLessonByIndex(page, 3);
    await advanceToInteractive(page, L3);

    const before = (await readAgc(page)).snapshots ?? 0;
    await page.waitForTimeout(1000);
    const after = (await readAgc(page)).snapshots ?? 0;
    // Cadence is capped near 25 Hz. Accumulated listeners would show thousands.
    expect(after - before).toBeLessThan(60);
  });

  test("restarting an attempt clears evidence and does not auto-complete", async ({ page }) => {
    await selectLessonByIndex(page, 3);
    await advanceToInteractive(page, L3);

    await page.getByTestId("ctl-restart-attempt").click();
    await page.waitForFunction(
      () => {
        const s = (window as unknown as { __learnTest?: LearnTestState }).__learnTest;
        return !!(s && s.lessonId === "lesson-03-v35-lamp-test"
          && s.state.status === "in-progress"
          && s.state.evidence.length === 0);
      },
      { timeout: 15_000 },
    );
    // A fresh contract must be republished for the restarted attempt.
    const restarted = await waitForAttemptReady(page, L3);
    expect(restarted.state.status).not.toBe("completed");
    expect(restarted.state.evidence.length).toBe(0);
    expect(restarted.attemptReady!.attemptId).toBe(restarted.state.attempt!.attemptId);
  });

  test("rapid lesson switching always converges on a matching readiness contract", async ({ page }) => {
    // REGRESSION GUARD (M4.5). Selecting an interactive lesson used to start
    // an open workflow that the reset effect immediately cancelled, leaving
    // the attempt phase pinned at "idle" with nothing scheduled to retry —
    // the intermittent /learn timeout. Bouncing between lessons exercises
    // that ordering repeatedly.
    for (let round = 0; round < 3; round++) {
      await selectLessonByIndex(page, 3);
      await selectLessonByIndex(page, 4);
      await selectLessonByIndex(page, 3);
      const st = await advanceToInteractive(page, L3);
      expect(st.attemptReady!.lessonId, `round=${round} diag=${await diagnostics(page)}`).toBe(L3);
      expect(st.attemptReady!.agcEpoch).toBe(st.agcEpoch);
      expect(st.attemptReady!.attemptId).toBe(st.state.attempt!.attemptId);
    }

    // The contract must never have downgraded a published "ready".
    const contract = (await readLearn(page)).readinessContract!;
    expect(contract.downgradeAttempts, `contract=${JSON.stringify(contract)}`).toBe(0);

    // Session stayed intact across all the switching.
    expect(rec.agcWorkers().length).toBe(1);
    expect((await readAgc(page)).workerBoots).toBe(1);
    expectNoRelevantErrors(rec);
  });
});
