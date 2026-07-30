// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C §6 — Channel 13 radar-request decoder tests.

import { describe, expect, it } from "vitest";
import {
  ANSWERABLE_SELECTION,
  CHAN13,
  CHAN13_ALL_RADAR_BITS,
  RADAR_SELECTION_BY_CODE,
  completeOutstandingRequest,
  createChan13ObserverState,
  observeChan13Write,
  refusalFor,
  type Chan13ObserverState,
} from "../chan13Requests";

const write = (word: number, agcCycle = 1) => ({
  channel: CHAN13,
  word,
  agcCycle,
  missionTimeUs: agcCycle * 12,
});

/** INITREAD: `CS ALLREAD / WAND CHAN13` then `WOR CHAN13` with the lead-in. */
function initread(state: Chan13ObserverState, leadIn: number, cycle: number) {
  const cleared = observeChan13Write(state, write(0, cycle));
  return observeChan13Write(cleared.nextState, write(leadIn, cycle + 1));
}

describe("CHAN13 decoding", () => {
  it("maps every documented select code", () => {
    expect(RADAR_SELECTION_BY_CODE[7]).toBe("lr-altitude");
    expect(RADAR_SELECTION_BY_CODE[6]).toBe("lr-velocity-z");
    expect(RADAR_SELECTION_BY_CODE[5]).toBe("lr-velocity-y");
    expect(RADAR_SELECTION_BY_CODE[4]).toBe("lr-velocity-x");
    expect(RADAR_SELECTION_BY_CODE[2]).toBe("rr-range-rate");
    expect(RADAR_SELECTION_BY_CODE[1]).toBe("rr-range");
    expect(RADAR_SELECTION_BY_CODE[0]).toBe("none");
    expect(CHAN13_ALL_RADAR_BITS).toBe(0o17);
  });

  it("answers only the landing-radar altitude selection", () => {
    expect(ANSWERABLE_SELECTION).toBe("lr-altitude");
    expect(refusalFor("lr-altitude")).toBeNull();
    expect(refusalFor("lr-velocity-x")).toBe("selection-not-implemented-lr-velocity");
    expect(refusalFor("rr-range")).toBe("selection-not-implemented-rendezvous-radar");
    expect(refusalFor("unassigned-3")).toBe("selection-unassigned-in-luminary099");
  });
});

describe("CHAN13 solicitation emission", () => {
  it("emits nothing without a CHAN13 write", () => {
    const s = createChan13ObserverState();
    const r = observeChan13Write(s, { channel: 0o12, word: 0o17, agcCycle: 1, missionTimeUs: 0 });
    expect(r.request).toBeNull();
    expect(r.nextState).toBe(s);
  });

  it("emits nothing when RADAR ACTIVITY is clear, even with a select code", () => {
    const s = createChan13ObserverState();
    expect(observeChan13Write(s, write(0o7)).request).toBeNull();
  });

  it("emits nothing when only ACTIVITY is set with no selection", () => {
    const s = createChan13ObserverState();
    expect(observeChan13Write(s, write(0o10)).request).toBeNull();
  });

  it("emits one answerable request for the LRALT lead-in (OCT 17)", () => {
    const r = initread(createChan13ObserverState(), 0o17, 10);
    expect(r.request).not.toBeNull();
    expect(r.request!.selection).toBe("lr-altitude");
    expect(r.request!.rawWordOctal).toBe("0o17");
    expect(r.request!.refusal).toBeNull();
    expect(r.request!.sequence).toBe(1);
    expect(r.request!.agcCycle).toBe(11);
    expect(r.nextState.outstanding?.sequence).toBe(1);
  });

  it("ignores unrelated high bits while decoding bits 1-4", () => {
    const r = initread(createChan13ObserverState(), 0o17 | 0o400, 4);
    expect(r.request!.selection).toBe("lr-altitude");
    expect(r.request!.radarBits).toBe(0o17);
  });

  it("suppresses a retained level: no re-request without a new edge", () => {
    const first = initread(createChan13ObserverState(), 0o17, 10);
    const again = observeChan13Write(first.nextState, write(0o17, 30));
    expect(again.request).toBeNull();
    expect(again.duplicateSuppressed).toBe(true);
    expect(again.nextState.requestCount).toBe(1);
  });

  it("allows exactly one host response per solicitation", () => {
    const first = initread(createChan13ObserverState(), 0o17, 10);
    // A second, DIFFERENT lead-in while the first is unanswered must not
    // stack a second response.
    const second = initread(first.nextState, 0o16, 20);
    expect(second.request).toBeNull();
    expect(second.duplicateSuppressed).toBe(true);

    const cleared = completeOutstandingRequest(second.nextState, 1);
    expect(cleared.outstanding).toBeNull();
    const third = initread(cleared, 0o17, 40);
    expect(third.request?.selection).toBe("lr-altitude");
    expect(third.request?.sequence).toBe(2);
  });

  it("refuses LR velocity and rendezvous requests with an explicit reason and no outstanding transaction", () => {
    let s = createChan13ObserverState();
    for (const [leadIn, reason] of [
      [0o16, "selection-not-implemented-lr-velocity"],
      [0o15, "selection-not-implemented-lr-velocity"],
      [0o14, "selection-not-implemented-lr-velocity"],
      [0o12, "selection-not-implemented-rendezvous-radar"],
      [0o11, "selection-not-implemented-rendezvous-radar"],
      [0o13, "selection-unassigned-in-luminary099"],
    ] as const) {
      const r = initread(s, leadIn, 100);
      expect(r.request?.refusal).toBe(reason);
      expect(r.nextState.outstanding).toBeNull();
      s = r.nextState;
    }
    expect(s.refusedCount).toBe(6);
    expect(s.requestCount).toBe(6);
  });

  it("RADAREAD's ACTIVITY reset does not itself request anything", () => {
    const first = initread(createChan13ObserverState(), 0o17, 10);
    const answered = completeOutstandingRequest(first.nextState, 1);
    // handler clears bit 4, leaving the select code retained
    const reset = observeChan13Write(answered, write(0o7, 60));
    expect(reset.request).toBeNull();
    // the next genuine read re-sets ACTIVITY and IS a new solicitation
    const next = observeChan13Write(reset.nextState, write(0o17, 61));
    expect(next.request?.sequence).toBe(2);
  });

  it("is a pure fold: the input state object is never mutated", () => {
    const s = createChan13ObserverState();
    const frozen = JSON.stringify(s);
    initread(s, 0o17, 1);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it("completing a non-matching sequence is a no-op", () => {
    const first = initread(createChan13ObserverState(), 0o17, 10);
    expect(completeOutstandingRequest(first.nextState, 99)).toBe(first.nextState);
  });
});
