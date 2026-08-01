// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — /learn reading-lesson acceptance.
//
// Scope: navigation across reading-only lessons and the invariant that
// lesson navigation never disturbs the shared AGC session. No DSKY input.

import { test, expect } from "@playwright/test";
import {
  ackUntilSettled,
  attachRecorder,
  expectNoRelevantErrors,
  readAgc,
  readLearn,
  selectLessonByIndex,
  waitForReady,
  type LearnRecorder,
} from "./support/learn";

test.describe("/learn reading lessons", () => {
  let rec: LearnRecorder;

  test.beforeEach(async ({ page, context }) => {
    rec = attachRecorder(page, context);
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);
  });

  test("reading lessons complete by acknowledgement alone", async ({ page }) => {
    await selectLessonByIndex(page, 1);
    await ackUntilSettled(page);
    expect((await readLearn(page)).state.status).toBe("completed");

    await selectLessonByIndex(page, 2);
    await ackUntilSettled(page);
    expect((await readLearn(page)).state.status).toBe("completed");
  });

  test("navigating lessons never restarts the AGC or rewinds mission time", async ({ page }) => {
    const baseline = (await readAgc(page)).snapshot!;

    await selectLessonByIndex(page, 1);
    await ackUntilSettled(page);
    await selectLessonByIndex(page, 2);
    await ackUntilSettled(page);

    const after = await readAgc(page);
    expect(rec.agcWorkers().length).toBe(1);
    expect(after.workerBoots).toBe(1);
    expect(after.snapshot!.tickIndex).toBeGreaterThanOrEqual(baseline.tickIndex);
    expect(after.snapshot!.totalAgcSteps).toBeGreaterThanOrEqual(baseline.totalAgcSteps);
    expect(after.snapshot!.channelEventCount).toBeGreaterThanOrEqual(baseline.channelEventCount);

    expectNoRelevantErrors(rec);
  });
});
