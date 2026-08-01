// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5 — /learn interactive DSKY acceptance.
//
// Scope: the two authentic-emulator lessons (V35 lamp test, V16 N65 mission
// time). Each is its own test with its own page, so a failure names the
// lesson that broke and neither can starve the other of time budget.
//
// Every DSKY input goes through the rendered keypad — the only path that
// produces real input events — and every completion is gated on the M4.5
// readiness contract, never on a sleep.

import { test, expect } from "@playwright/test";
import {
  advanceToInteractive,
  attachRecorder,
  diagnostics,
  expectNoRelevantErrors,
  readAgc,
  readLearn,
  selectLessonByIndex,
  tapSequence,
  waitForReady,
  waitUntilLessonComplete,
  type LearnRecorder,
} from "./support/learn";

const L3 = "lesson-03-v35-lamp-test";
const L4 = "lesson-04-v16-n65-mission-time";

test.describe("/learn interactive DSKY lessons", () => {
  let rec: LearnRecorder;

  test.beforeEach(async ({ page, context }) => {
    rec = attachRecorder(page, context);
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await waitForReady(page);
  });

  test("Lesson 3 — V35E lamp test completes from authentic emulator output", async ({ page }) => {
    await selectLessonByIndex(page, 3);
    const start = await advanceToInteractive(page, L3);

    const attempt = start.state.attempt!;
    const ready = start.attemptReady!;
    const boundary = ready.boundaryEventId;
    expect(attempt.attemptId).toMatch(/^att-lesson-03/);
    // Contract identity must match the engine attempt exactly.
    expect(ready.lessonId).toBe(L3);
    expect(ready.attemptId).toBe(attempt.attemptId);
    expect(boundary, `diag=${await diagnostics(page)}`).toBeGreaterThan(0);
    expect(attempt.startedAtCursor).toBe(boundary + 1);

    await tapSequence(page, ["dsky-key-VERB", "dsky-key-3", "dsky-key-5", "dsky-key-ENTR"]);
    await waitUntilLessonComplete(page, L3);

    const done = await readLearn(page);
    const ev = done.state.evidence[done.state.evidence.length - 1];
    expect(ev, `diag=${await diagnostics(page)}`).toBeTruthy();
    expect(ev.attemptId).toBe(attempt.attemptId);
    expect(ev.classification).toBe("authentic-emulator");

    // Every input event must strictly post-date the barrier.
    expect(ev.inputEventIds.length).toBeGreaterThanOrEqual(4);
    for (const id of ev.inputEventIds) expect(id).toBeGreaterThan(boundary);
    const maxInput = Math.max(...ev.inputEventIds);
    expect(ev.channelEventIds.length).toBeGreaterThan(0);
    for (const id of ev.channelEventIds) expect(id).toBeGreaterThan(maxInput);

    // Focus must remain on a real control after auto-completion.
    expect(await page.evaluate(() => document.activeElement?.tagName ?? "BODY")).not.toBe("BODY");
    expectNoRelevantErrors(rec);
  });

  test("Lesson 3 — visible DSKY always describes one published snapshot", async ({ page }) => {
    await selectLessonByIndex(page, 3);
    await advanceToInteractive(page, L3);
    await tapSequence(page, ["dsky-key-VERB", "dsky-key-3", "dsky-key-5", "dsky-key-ENTR"]);
    await waitUntilLessonComplete(page, L3);

    // The visible DSKY is the LATEST published snapshot, not a frozen peak —
    // Luminary tears the lamp test down as soon as it finishes. We assert
    // internal consistency: digits and aria-live text describe the same
    // published sequence.
    const sample = await (async () => {
      for (let i = 0; i < 20; i++) {
        const s = await page.evaluate(() => {
          const digitsOf = (id: string) =>
            Array.from(document.querySelectorAll(`[data-testid="${id}"] svg`)).map((svg) => {
              const p = svg.querySelector("path") as SVGPathElement | null;
              return p?.getAttribute("fill") === "#8fff8f";
            });
          const root = document.querySelector('[data-testid="agc-dsky"]');
          const seqBefore = root?.getAttribute("data-snapshot-seq") ?? null;
          const liveText = document.querySelector('[data-testid="dsky-live"]')?.textContent ?? "";
          const litMask = {
            prog: digitsOf("reg-prog"), verb: digitsOf("reg-verb"), noun: digitsOf("reg-noun"),
            r1: digitsOf("reg-r1"), r2: digitsOf("reg-r2"), r3: digitsOf("reg-r3"),
          };
          const seqAfter = root?.getAttribute("data-snapshot-seq") ?? null;
          const pub = (window as unknown as {
            __agcTest?: { publishedDsky?: { sequence: number; decodedDsky: unknown } };
          }).__agcTest?.publishedDsky;
          return { seqBefore, seqAfter, liveText, litMask, pub };
        });
        if (s.seqBefore !== null && s.seqBefore === s.seqAfter) return s;
      }
      throw new Error("visible DSKY never stabilised for one snapshot sequence");
    })();

    expect(sample.pub, `diag=${await diagnostics(page)}`).toBeTruthy();
    expect(String(sample.pub!.sequence)).toBe(sample.seqBefore);

    type Reg = { digits: Array<{ value: number | null }>; sign?: { plus?: boolean; minus?: boolean } | null };
    type Dec = { program: Reg; verb: Reg; noun: Reg; r1: Reg; r2: Reg; r3: Reg; annunciators: Record<string, boolean> };
    const d = sample.pub!.decodedDsky as Dec;
    const digitsStr = (r: Reg) => r.digits.map((x) => (x.value === null ? "_" : String(x.value))).join("");
    const signStr = (r: Reg) =>
      r.sign?.plus && r.sign?.minus ? "±" : r.sign?.plus ? "+" : r.sign?.minus ? "-" : "";
    const onList = Object.entries(d.annunciators).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
    expect(sample.liveText).toBe(
      `Program ${digitsStr(d.program)}, Verb ${digitsStr(d.verb)}, Noun ${digitsStr(d.noun)}. ` +
        `R1 ${signStr(d.r1)}${digitsStr(d.r1)}. R2 ${signStr(d.r2)}${digitsStr(d.r2)}. R3 ${signStr(d.r3)}${digitsStr(d.r3)}. ` +
        `Indicators: ${onList}.`,
    );

    const maskOf = (r: Reg) => r.digits.map((x) => x.value !== null);
    expect(sample.litMask.prog).toEqual(maskOf(d.program));
    expect(sample.litMask.verb).toEqual(maskOf(d.verb));
    expect(sample.litMask.noun).toEqual(maskOf(d.noun));
    expect(sample.litMask.r1).toEqual(maskOf(d.r1));
    expect(sample.litMask.r2).toEqual(maskOf(d.r2));
    expect(sample.litMask.r3).toEqual(maskOf(d.r3));
  });

  test("Lesson 4 — V16 N65 completes on a fresh barrier without a Worker restart", async ({ page }) => {
    const bootsBefore = (await readAgc(page)).workerBoots;

    await selectLessonByIndex(page, 4);
    const start = await advanceToInteractive(page, L4);
    expect((await readAgc(page)).workerBoots).toBe(bootsBefore);
    expect(rec.agcWorkers().length).toBe(1);

    const attempt = start.state.attempt!;
    const boundary = start.attemptReady!.boundaryEventId;
    expect(attempt.attemptId).toMatch(/^att-lesson-04/);
    expect(attempt.startedAtCursor).toBe(boundary + 1);

    await tapSequence(page, [
      "dsky-key-VERB", "dsky-key-1", "dsky-key-6",
      "dsky-key-NOUN", "dsky-key-6", "dsky-key-5",
      "dsky-key-ENTR",
    ]);
    await waitUntilLessonComplete(page, L4);

    const done = await readLearn(page);
    const ev = done.state.evidence[done.state.evidence.length - 1];
    expect(ev.classification).toBe("authentic-emulator");
    expect(ev.attemptId).toBe(attempt.attemptId);
    for (const id of ev.inputEventIds) expect(id).toBeGreaterThanOrEqual(attempt.startedAtCursor);

    const live = (await page.getByTestId("dsky-live").textContent()) ?? "";
    expect(live).toMatch(/Verb 16/);
    expect(live).toMatch(/Noun 65/);

    // Event IDs remain monotonic against the live snapshot counter.
    const finalAgc = await readAgc(page);
    const maxRecorded = Math.max(0, ...ev.channelEventIds, ...ev.inputEventIds);
    expect(finalAgc.snapshot!.channelEventCount).toBeGreaterThanOrEqual(maxRecorded);

    expectNoRelevantErrors(rec);
  });
});
