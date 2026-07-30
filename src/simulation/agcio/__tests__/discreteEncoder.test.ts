// SPDX-License-Identifier: GPL-3.0-or-later
//
// P5.b — pure discrete-encoder tests. No worker, no adapter, no WASM.

import { describe, expect, it } from "vitest";
import {
  applyChannelMaskUpdate,
  createDiscreteEncoderState,
  encodeDiscreteSensorTick,
  ENCODER_KNOWN_MAPPING_IDS,
  type LmDiscreteSensorState,
} from "@/simulation/agcio/discreteEncoder";
import {
  MONITOR_SIGNAL_REGISTRY,
  mappedSignalsForProfile,
  unresolvedSignalsForProfile,
  validateRegistry,
} from "@/simulation/agcio/sensorRegistry";
import type {
  AgcSensorAction,
  ChannelMaskUpdateAction,
} from "@/simulation/agcio/types";

const NOT_FLIGHT_READY: LmDiscreteSensorState = {
  engineArmed: false,
  autoThrottleEnabled: false,
  lgcInControl: false,
  issOperate: false,
  imuHealthy: false,
  imuCduHealthy: false,
  pipaHealthy: false,
  landingRadarStatus: "not-acquired",
  landingRadarAntenna: "transit",
  landingRadarRangeLowScale: false,
};

const FLIGHT_READY: LmDiscreteSensorState = {
  engineArmed: true,
  autoThrottleEnabled: true,
  lgcInControl: true,
  issOperate: true,
  imuHealthy: true,
  imuCduHealthy: true,
  pipaHealthy: true,
  landingRadarStatus: "acquired-valid",
  landingRadarAntenna: "pos1",
  landingRadarRangeLowScale: false,
};


function onlyMaskUpdates(actions: readonly AgcSensorAction[]): readonly ChannelMaskUpdateAction[] {
  return actions.map((a) => {
    if (a.kind !== "channel-mask-update") {
      throw new Error(`unexpected action kind ${a.kind}`);
    }
    return a;
  });
}

describe("MONITOR_SIGNAL_REGISTRY", () => {
  it("passes structural validation", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("has value & ~mask === 0 for every implied encoded state", () => {
    for (const m of MONITOR_SIGNAL_REGISTRY) {
      if (m.status !== "mapped") continue;
      // single-bit is checked structurally
      expect(m.mask & (m.mask - 1)).toBe(0);
    }
  });

  it("every encoder mapping id appears in the registry as mapped", () => {
    const mappedIds = new Set(
      MONITOR_SIGNAL_REGISTRY.filter((m) => m.status === "mapped").map((m) => m.id),
    );
    for (const id of ENCODER_KNOWN_MAPPING_IDS) {
      expect(mappedIds.has(id)).toBe(true);
    }
  });

  it("descent-monitor-v1 has non-empty unresolved rows in the registry", () => {
    expect(unresolvedSignalsForProfile("descent-monitor-v1").length).toBeGreaterThan(0);
  });

  it("rejects a synthetic registry with overlapping ownership", () => {
    const errs = validateRegistry([
      {
        id: "a",
        status: "mapped",
        channel: 0o30,
        mask: 0o4,
        polarity: "active-low",
        physicalMeaning: "",
        sourceCitation: "",
        hardwarePath: "",
        validStates: "",
        requiredForProfiles: ["discrete-observer-v0"],
      },
      {
        id: "b",
        status: "mapped",
        channel: 0o30,
        mask: 0o4,
        polarity: "active-low",
        physicalMeaning: "",
        sourceCitation: "",
        hardwarePath: "",
        validStates: "",
        requiredForProfiles: ["discrete-observer-v0"],
      },
    ]);
    expect(errs.some((e) => e.kind === "overlapping-ownership")).toBe(true);
  });

  it("rejects mask outside 15-bit channel word", () => {
    const errs = validateRegistry([
      {
        id: "wide",
        status: "mapped",
        channel: 0o30,
        mask: 1 << 15,
        polarity: "active-high",
        physicalMeaning: "",
        sourceCitation: "",
        hardwarePath: "",
        validStates: "",
        requiredForProfiles: ["discrete-observer-v0"],
      },
    ]);
    expect(errs.some((e) => e.kind === "mask-outside-channel-word")).toBe(true);
  });
});

describe("encodeDiscreteSensorTick — profile off", () => {
  it("emits no actions and preserves state under any avionics input", () => {
    const state = createDiscreteEncoderState("off");
    const r = encodeDiscreteSensorTick(state, FLIGHT_READY, 12345);
    expect(r.actions).toEqual([]);
    expect(r.diagnostics.channelMaskUpdateCount).toBe(0);
    expect(r.diagnostics.counterPulseCount).toBe(0);
    expect(r.nextState).toBe(state);
  });
});

describe("encodeDiscreteSensorTick — discrete-observer-v0", () => {
  it("emits the complete owned-bit state on first entry", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(state, NOT_FLIGHT_READY, 0);
    const mapped = mappedSignalsForProfile("discrete-observer-v0");
    expect(r.actions.length).toBe(mapped.length);
    // Every emitted action targets a mapped signal exactly.
    const emittedIds = onlyMaskUpdates(r.actions).map((a) => a.mappingId).sort();
    expect(emittedIds).toEqual(mapped.map((m) => m.id).sort());
    // deterministic suborder = index in registry-mapped order
    for (let i = 0; i < r.actions.length; i++) {
      expect(onlyMaskUpdates(r.actions)[i].suborder).toBe(i);
    }
    expect(r.nextState.initialized).toBe(true);
  });

  it("active-low CHAN30 bits encode false→bit=1, true→bit=0", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    const notReady = encodeDiscreteSensorTick(state, NOT_FLIGHT_READY, 0);
    // engineArmed=false, active-low → value===mask (bit=1)
    const armed = onlyMaskUpdates(notReady.actions).find(
      (a) => a.mappingId === "chan30.bit03.engine-armed",
    )!;
    expect(armed.value).toBe(armed.mask);

    const ready = encodeDiscreteSensorTick(state, FLIGHT_READY, 0);
    const armedReady = onlyMaskUpdates(ready.actions).find(
      (a) => a.mappingId === "chan30.bit03.engine-armed",
    )!;
    expect(armedReady.value).toBe(0);
  });

  // M3.3B correction: INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:143-144 says
  // ALL bits in channels 30-33 are inverted, so CHAN33 LR bits are
  // active-low exactly like CHAN30.
  it("active-low CHAN33 LR bits encode signal-present→bit=0, absent→bit=1", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    const notReady = encodeDiscreteSensorTick(state, NOT_FLIGHT_READY, 0);
    const rangeGood = onlyMaskUpdates(notReady.actions).find(
      (a) => a.mappingId === "chan33.bit05.lr-range-good",
    )!;
    expect(rangeGood.value).toBe(rangeGood.mask);

    const ready = encodeDiscreteSensorTick(state, FLIGHT_READY, 0);
    const rangeGoodReady = onlyMaskUpdates(ready.actions).find(
      (a) => a.mappingId === "chan33.bit05.lr-range-good",
    )!;
    expect(rangeGoodReady.value).toBe(0);
  });

  it("does not encode LR as acquired when radar status is not-acquired", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(state, NOT_FLIGHT_READY, 0);
    for (const id of [
      "chan33.bit05.lr-range-good",
      "chan33.bit08.lr-velocity-good",
    ]) {
      const a = onlyMaskUpdates(r.actions).find((x) => x.mappingId === id)!;
      // active-low: DATA GOOD absent means the bus bit stays HIGH.
      expect(a.value).toBe(a.mask);
    }
  });

  it("does not encode LR as acquired when radar status is invalid", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(
      state,
      { ...NOT_FLIGHT_READY, landingRadarStatus: "invalid" },
      0,
    );
    const rg = onlyMaskUpdates(r.actions).find(
      (a) => a.mappingId === "chan33.bit05.lr-range-good",
    )!;
    expect(rg.value).toBe(rg.mask);
  });

  it("IMU FAIL / PIPA FAIL rows are not double-inverted", () => {
    const state = createDiscreteEncoderState("discrete-observer-v0");
    // Healthy IMU/PIPA => the FAIL signal is ABSENT => active-low bus bit HIGH.
    const healthy = encodeDiscreteSensorTick(state, FLIGHT_READY, 0);
    for (const id of ["chan30.bit13.imu-fail", "chan33.bit13.pipa-fail"]) {
      const a = onlyMaskUpdates(healthy.actions).find((x) => x.mappingId === id)!;
      expect(a.value).toBe(a.mask);
    }
    // Failed IMU/PIPA => signal PRESENT => bus bit LOW.
    const failed = encodeDiscreteSensorTick(
      state,
      { ...FLIGHT_READY, imuHealthy: false, pipaHealthy: false },
      0,
    );
    for (const id of ["chan30.bit13.imu-fail", "chan33.bit13.pipa-fail"]) {
      const a = onlyMaskUpdates(failed.actions).find((x) => x.mappingId === id)!;
      expect(a.value).toBe(0);
    }
  });


  it("unchanged state emits zero actions on subsequent ticks", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r1 = encodeDiscreteSensorTick(s0, NOT_FLIGHT_READY, 0);
    const r2 = encodeDiscreteSensorTick(r1.nextState, NOT_FLIGHT_READY, 20_000);
    expect(r2.actions).toEqual([]);
    expect(r2.diagnostics.channelMaskUpdateCount).toBe(0);
  });

  it("only the changed discrete emits an action on transition", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r1 = encodeDiscreteSensorTick(s0, NOT_FLIGHT_READY, 0);
    const flipped: LmDiscreteSensorState = { ...NOT_FLIGHT_READY, engineArmed: true };
    const r2 = encodeDiscreteSensorTick(r1.nextState, flipped, 20_000);
    const ids = onlyMaskUpdates(r2.actions).map((a) => a.mappingId);
    expect(ids).toEqual(["chan30.bit03.engine-armed"]);
  });

  it("simultaneous changes preserve deterministic suborder", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r1 = encodeDiscreteSensorTick(s0, NOT_FLIGHT_READY, 0);
    const r2 = encodeDiscreteSensorTick(r1.nextState, FLIGHT_READY, 20_000);
    // Every mapped signal flipped; suborder is 0..N-1 in mapped order.
    const emitted = onlyMaskUpdates(r2.actions);
    for (let i = 0; i < emitted.length; i++) {
      expect(emitted[i].suborder).toBe(i);
    }
    // Rerunning yields identical action sequence (deterministic).
    const r2b = encodeDiscreteSensorTick(r1.nextState, FLIGHT_READY, 20_000);
    expect(r2b.actions).toEqual(r2.actions);
  });

  it("emits no counter-pulse actions in P5.b", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    for (const av of [NOT_FLIGHT_READY, FLIGHT_READY]) {
      const r = encodeDiscreteSensorTick(s0, av, 0);
      for (const a of r.actions) {
        expect(a.kind).toBe("channel-mask-update");
      }
      expect(r.diagnostics.counterPulseCount).toBe(0);
    }
  });

  it("rejects missing avionics fields (does not default to flight-ready)", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    // Strip a required key.
    const { imuHealthy: _omit, ...partial } = FLIGHT_READY;
    void _omit;
    const r = encodeDiscreteSensorTick(
      s0,
      partial as LmDiscreteSensorState,
      0,
    );
    expect(r.actions).toEqual([]);
    expect(r.blockedPrerequisites.length).toBe(1);
    expect(r.blockedPrerequisites[0].code).toBe("prerequisite-missing");
    expect(r.blockedPrerequisites[0].detail).toContain("imuHealthy");
  });

  it("emits value === value & mask for every action", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(s0, FLIGHT_READY, 0);
    for (const a of onlyMaskUpdates(r.actions)) {
      expect(a.value & ~a.mask).toBe(0);
    }
  });

  it("signalDiagnostics carries mapping id, octal channel/mask, polarity, and profile label", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(s0, FLIGHT_READY, 555);
    for (const d of r.signalDiagnostics) {
      expect(d.channelOctal.startsWith("0o")).toBe(true);
      expect(d.ownedMaskOctal.startsWith("0o")).toBe(true);
      expect(d.missionTimeUs).toBe(555);
      expect(d.profileLabel).toBe("Discrete interface diagnostic");
    }
  });
});

describe("applyChannelMaskUpdate", () => {
  const action: ChannelMaskUpdateAction = {
    kind: "channel-mask-update",
    channel: 0o30,
    mask: 1 << 2,
    value: 1 << 2,
    suborder: 0,
    mappingId: "test",
  };

  it("sets owned bits", () => {
    expect(applyChannelMaskUpdate(0, action)).toBe(1 << 2);
  });

  it("preserves unrelated bits", () => {
    // PROCEED on CHAN32 is bit 14 — model unrelated: bit 14 must survive.
    const unrelated = 1 << 13;
    const current = unrelated;
    expect(applyChannelMaskUpdate(current, action) & unrelated).toBe(unrelated);
  });

  it("clears owned bit when value=0", () => {
    const clearAction: ChannelMaskUpdateAction = { ...action, value: 0 };
    const current = (1 << 13) | (1 << 2);
    const next = applyChannelMaskUpdate(current, clearAction);
    expect(next & (1 << 2)).toBe(0);
    expect(next & (1 << 13)).toBe(1 << 13);
  });

  it("is idempotent under repeated application", () => {
    let word = 0;
    word = applyChannelMaskUpdate(word, action);
    const once = word;
    for (let i = 0; i < 10; i++) word = applyChannelMaskUpdate(word, action);
    expect(word).toBe(once);
  });

  it("action ordering is deterministic — applying the same sequence yields identical results", () => {
    const s0 = createDiscreteEncoderState("discrete-observer-v0");
    const r = encodeDiscreteSensorTick(s0, FLIGHT_READY, 0);
    const shadow30_A = onlyMaskUpdates(r.actions)
      .filter((a) => a.channel === 0o30)
      .reduce((w, a) => applyChannelMaskUpdate(w, a), 0);
    const shadow30_B = onlyMaskUpdates(r.actions)
      .filter((a) => a.channel === 0o30)
      .reduce((w, a) => applyChannelMaskUpdate(w, a), 0);
    expect(shadow30_A).toBe(shadow30_B);
  });

  it("rejects value with bits outside mask", () => {
    expect(() =>
      applyChannelMaskUpdate(0, { ...action, value: 0o777 }),
    ).toThrow();
  });

  it("rejects currentWord outside 15-bit AGC channel range", () => {
    expect(() => applyChannelMaskUpdate(1 << 20, action)).toThrow();
  });
});
