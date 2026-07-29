// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.c — pure actuator observation/decoding tests.
// No WASM, no Worker, no adapter: fixtures only.

import { describe, expect, it } from "vitest";

import {
  ACTUATOR_SIGNAL_REGISTRY,
  ENGINE_OFF_MASK,
  ENGINE_ON_MASK,
  THRUST_COUNTER_ADDRESS,
  THRUST_DIAGNOSTIC_HEADER,
  THRUST_DRIVE_ACTIVITY_MASK,
  actuatorSignalLabel,
  unresolvedActuatorSignals,
  validateActuatorRegistry,
} from "../actuatorRegistry";
import {
  INITIAL_ACTUATOR_DECODER_STATE,
  compareWide,
  reduceAgcActuatorTick,
} from "../actuatorDecoder";
import type { AgcActuatorDecoderState } from "../actuatorDecoder";
import { REQUIRED_ROPE_ID, decideMonitorEntry } from "../profileValidation";
import { SIMULATION_PROTOCOL_VERSION } from "../../../agc/simulationProtocol";
import type {
  AgcActuatorTickEvents,
  AgcOutputChannelEvent,
  AgcOutputCounterEvent,
} from "../types";

let seq = 0;
function nextSeq() {
  seq += 1;
  return { hi: 0, lo: seq };
}
function chanEvent(
  channel: number,
  value: number,
  overrides: Partial<AgcOutputChannelEvent> = {},
): AgcOutputChannelEvent {
  return {
    stream: "channel",
    sequence: nextSeq(),
    cycle: { hi: 0, lo: 1000 + seq },
    channel,
    value,
    valueBefore: null,
    ...overrides,
  };
}
function counterEvent(
  delta: number,
  before: number,
  operation = 0,
  overrides: Partial<AgcOutputCounterEvent> = {},
): AgcOutputCounterEvent {
  return {
    stream: "counter",
    sequence: nextSeq(),
    cycle: { hi: 0, lo: 2000 + seq },
    address: THRUST_COUNTER_ADDRESS,
    operation,
    delta,
    valueBefore: before,
    valueAfter: before + delta,
    ...overrides,
  };
}
function tick(
  missionTick: number,
  channelEvents: AgcOutputChannelEvent[] = [],
  counterEvents: AgcOutputCounterEvent[] = [],
  traceDropped = 0,
): AgcActuatorTickEvents {
  return { missionTick, channelEvents, counterEvents, traceDropped };
}

const S0: AgcActuatorDecoderState = INITIAL_ACTUATOR_DECODER_STATE;

describe("actuator registry", () => {
  it("is structurally valid", () => {
    expect(validateActuatorRegistry()).toEqual([]);
  });

  it("rows match the documented CHAN11 / CHAN14 / THRUST mappings", () => {
    const byId = new Map(ACTUATOR_SIGNAL_REGISTRY.map((r) => [r.id, r]));
    const on = byId.get("chan11.bit13.engine-on")!;
    expect(on.source).toEqual({ kind: "channel-bit", channel: 0o11, mask: 1 << 12 });
    expect(on.semantics).toBe("level");
    const off = byId.get("chan11.bit14.engine-off")!;
    expect(off.source).toEqual({ kind: "channel-bit", channel: 0o11, mask: 1 << 13 });
    expect(off.semantics).toBe("level");
    const act = byId.get("chan14.bit04.thrust-drive-activity")!;
    expect(act.source).toEqual({ kind: "channel-bit", channel: 0o14, mask: 1 << 3 });
    expect(act.semantics).toBe("activity");
    const thrust = byId.get("counter.055.thrust-raw-operations")!;
    expect(thrust.source).toEqual({ kind: "output-counter", address: 0o55 });
    expect(thrust.semantics).toBe("counter-operation");
    for (const row of ACTUATOR_SIGNAL_REGISTRY) {
      if (row.status === "mapped") expect(row.sourceCitation.length).toBeGreaterThan(10);
    }
  });

  it("throttle magnitude stays unresolved and octal labels are exposed", () => {
    const unresolved = unresolvedActuatorSignals("descent-monitor-v1");
    expect(unresolved.map((r) => r.id)).toContain(
      "counter.055.thrust-magnitude-fraction",
    );
    expect(actuatorSignalLabel(ACTUATOR_SIGNAL_REGISTRY[0])).toBe("CHAN11 mask 0o10000");
  });

  it("rejects duplicate ids, bad masks, bad addresses, missing citations, resolved scale", () => {
    const base = ACTUATOR_SIGNAL_REGISTRY[0];
    expect(validateActuatorRegistry([base, base]).length).toBeGreaterThan(0);
    expect(
      validateActuatorRegistry([
        { ...base, id: "bad.mask", source: { kind: "channel-bit", channel: 0o11, mask: 0 } },
      ]).length,
    ).toBeGreaterThan(0);
    expect(
      validateActuatorRegistry([
        { ...base, id: "bad.addr", source: { kind: "output-counter", address: 0o50 } },
      ]).length,
    ).toBeGreaterThan(0);
    expect(
      validateActuatorRegistry([{ ...base, id: "no.cite", sourceCitation: "  " }]).length,
    ).toBeGreaterThan(0);
    expect(
      validateActuatorRegistry([{ ...base, id: "scaled", numericScaleResolved: true }])
        .length,
    ).toBeGreaterThan(0);
    // Unpermitted overlap.
    expect(
      validateActuatorRegistry([
        base,
        { ...base, id: "overlap", overlapPermittedWith: [] },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("exposes the mandatory non-physical THRUST header", () => {
    expect(THRUST_DIAGNOSTIC_HEADER).toEqual([
      "RAW AGC THRUST COUNTER ACTIVITY",
      "PHYSICAL THROTTLE SCALE NOT YET RESOLVED",
    ]);
  });
});

describe("engine command decoding", () => {
  it("decodes engine ON", () => {
    const r = reduceAgcActuatorTick(S0, tick(1, [chanEvent(0o11, ENGINE_ON_MASK)]));
    expect(r.control.engineCommand).toBe("on");
    expect(r.control.engineEnabled).toBe(true);
    expect(r.control.throttleFraction).toBeNull();
    expect(r.control.valid).toBe(false);
    expect(r.control.invalidReasons).toEqual(["throttle-scale-unresolved"]);
  });

  it("decodes engine OFF", () => {
    const r = reduceAgcActuatorTick(S0, tick(1, [chanEvent(0o11, ENGINE_OFF_MASK)]));
    expect(r.control.engineCommand).toBe("off");
    expect(r.control.engineEnabled).toBe(false);
  });

  it("no command stays unknown rather than becoming OFF", () => {
    const r = reduceAgcActuatorTick(S0, tick(1));
    expect(r.control.engineCommand).toBe("none");
    expect(r.control.engineEnabled).toBeNull();
    expect(r.control.invalidReasons).toContain("no-engine-command");
    expect(r.control.throttleFraction).toBeNull();
  });

  it("contradictory ON+OFF is a conflict and invalid", () => {
    const r = reduceAgcActuatorTick(
      S0,
      tick(1, [chanEvent(0o11, ENGINE_ON_MASK | ENGINE_OFF_MASK)]),
    );
    expect(r.control.engineCommand).toBe("conflict");
    expect(r.control.engineEnabled).toBeNull();
    expect(r.control.invalidReasons).toContain("contradictory-engine-command");
  });

  it("levels latch across ticks and repeated identical writes are preserved", () => {
    const a = reduceAgcActuatorTick(S0, tick(1, [chanEvent(0o11, ENGINE_ON_MASK)]));
    const b = reduceAgcActuatorTick(a.nextState, tick(2));
    expect(b.control.engineCommand).toBe("on");
    const c = reduceAgcActuatorTick(
      b.nextState,
      tick(3, [chanEvent(0o11, ENGINE_ON_MASK), chanEvent(0o11, ENGINE_ON_MASK)]),
    );
    expect(c.control.raw.channel11).toHaveLength(2);
    expect(c.control.engineCommand).toBe("on");
  });

  it("a zero-valued CHAN11 event is distinct from an absent event", () => {
    const on = reduceAgcActuatorTick(S0, tick(1, [chanEvent(0o11, ENGINE_ON_MASK)]));
    const zero = reduceAgcActuatorTick(on.nextState, tick(2, [chanEvent(0o11, 0)]));
    expect(zero.control.raw.channel11).toHaveLength(1);
    expect(zero.control.engineCommand).toBe("none");
    expect(zero.nextState.lastChannel11Value).toBe(0);
    const absent = reduceAgcActuatorTick(on.nextState, tick(2));
    expect(absent.control.raw.channel11).toHaveLength(0);
    expect(absent.control.engineCommand).toBe("on");
  });

  it("rejects unexpected channels", () => {
    const r = reduceAgcActuatorTick(S0, tick(1, [chanEvent(0o13, 1)]));
    expect(r.control.invalidReasons).toContain("unexpected-channel");
  });
});

describe("CHAN14 thrust-drive activity", () => {
  it("is reported only for the tick where it is observed (no latching)", () => {
    const a = reduceAgcActuatorTick(
      S0,
      tick(1, [chanEvent(0o14, THRUST_DRIVE_ACTIVITY_MASK)]),
    );
    expect(a.control.thrustDriveActivity).toEqual({
      observedThisTick: true,
      eventCount: 1,
    });
    const b = reduceAgcActuatorTick(a.nextState, tick(2));
    expect(b.control.thrustDriveActivity.observedThisTick).toBe(false);
  });
});

describe("THRUST counter observation", () => {
  it("preserves every supplied event, in order, without collapsing", () => {
    const e1 = counterEvent(+5, 100);
    const e2 = counterEvent(-5, 105);
    const e3 = counterEvent(+7, 100);
    const r = reduceAgcActuatorTick(S0, tick(1, [], [e1, e2, e3]));
    expect(r.control.raw.thrustCounter).toEqual([e1, e2, e3]);
    expect(r.thrust.eventCount).toBe(3);
    expect(r.thrust.operations).toEqual([0, 0, 0]);
    expect(r.thrust.signedDeltaTotal).toBe(7);
    expect(r.thrust.firstValue).toBe(100);
    expect(r.thrust.lastValue).toBe(107);
    expect(r.thrust.scaleStatus).toBe("unresolved");
    // No fabricated physical throttle.
    expect(r.control.throttleFraction).toBeNull();
    expect(Object.keys(r.control)).not.toContain("throttlePercent");
  });

  it("rejects unsupported operation identifiers and addresses", () => {
    const bad = counterEvent(1, 0, 99);
    expect(
      reduceAgcActuatorTick(S0, tick(1, [], [bad])).invalidReasons,
    ).toContain("unsupported-counter-operation");
    const wrongAddr = counterEvent(1, 0, 0, { address: 0o50 });
    expect(
      reduceAgcActuatorTick(S0, tick(1, [], [wrongAddr])).invalidReasons,
    ).toContain("unexpected-counter-address");
  });

  it("rejects incoherent before/after for WRITE operations", () => {
    const bad = counterEvent(1, 10, 0, { valueAfter: 50 });
    expect(reduceAgcActuatorTick(S0, tick(1, [], [bad])).invalidReasons).toContain(
      "malformed-event",
    );
  });
});

describe("trace loss, sequencing, and mission-tick association", () => {
  it("dropped trace entries invalidate the result", () => {
    const r = reduceAgcActuatorTick(S0, tick(1, [], [], 3));
    expect(r.invalidReasons).toContain("trace-data-dropped");
    expect(r.control.valid).toBe(false);
    expect(r.nextState.totalDroppedTraceEntries).toBe(3);
  });

  it("negative dropped counts are malformed", () => {
    expect(reduceAgcActuatorTick(S0, tick(1, [], [], -1)).invalidReasons).toContain(
      "malformed-event",
    );
  });

  it("nonmonotonic sequences are rejected in each stream", () => {
    const a = chanEvent(0o11, ENGINE_ON_MASK, { sequence: { hi: 0, lo: 10 } });
    const b = chanEvent(0o11, ENGINE_ON_MASK, { sequence: { hi: 0, lo: 9 } });
    expect(reduceAgcActuatorTick(S0, tick(1, [a, b])).invalidReasons).toContain(
      "nonmonotonic-event-sequence",
    );
    const c1 = counterEvent(1, 0, 0, { sequence: { hi: 1, lo: 0 } });
    const c2 = counterEvent(1, 1, 0, { sequence: { hi: 0, lo: 99 } });
    expect(reduceAgcActuatorTick(S0, tick(1, [], [c1, c2])).invalidReasons).toContain(
      "nonmonotonic-event-sequence",
    );
  });

  it("compares 64-bit counters by word pair, not by JS number", () => {
    const big = { hi: 0xffffffff, lo: 0xfffffffe };
    const bigger = { hi: 0xffffffff, lo: 0xffffffff };
    expect(compareWide(big, bigger)).toBe(-1);
    expect(compareWide(bigger, big)).toBe(1);
    expect(compareWide(bigger, { ...bigger })).toBe(0);
  });

  it("associates the exact mission tick and rejects backwards ticks", () => {
    const a = reduceAgcActuatorTick(S0, tick(7));
    expect(a.control.sampledAtMissionTick).toBe(7);
    const b = reduceAgcActuatorTick(a.nextState, tick(6));
    expect(b.invalidReasons).toContain("malformed-event");
  });
});

describe("purity and determinism", () => {
  it("ordered event reduction preserves every supplied event", () => {
    const chans = [chanEvent(0o11, ENGINE_ON_MASK), chanEvent(0o14, THRUST_DRIVE_ACTIVITY_MASK)];
    const counters = [counterEvent(2, 0), counterEvent(-1, 2), counterEvent(3, 1)];
    const r = reduceAgcActuatorTick(S0, tick(1, [...chans], [...counters]));
    expect(r.control.raw.channel11).toEqual([chans[0]]);
    expect(r.control.raw.channel14).toEqual([chans[1]]);
    expect(r.control.raw.thrustCounter).toEqual(counters);
  });

  it("does not mutate inputs and has no hidden state (identical replay)", () => {
    const chans = [chanEvent(0o11, ENGINE_ON_MASK)];
    const counters = [counterEvent(4, 0)];
    const events = tick(1, chans, counters);
    const frozenChan = JSON.stringify(chans);
    const frozenCounter = JSON.stringify(counters);
    const r1 = reduceAgcActuatorTick(S0, events);
    const r2 = reduceAgcActuatorTick(S0, events);
    expect(JSON.stringify(chans)).toBe(frozenChan);
    expect(JSON.stringify(counters)).toBe(frozenCounter);
    expect(r2.nextState).toEqual(r1.nextState);
    expect(r2.control).toEqual(r1.control);
    expect(r2.thrust).toEqual(r1.thrust);
  });

  it("the reducer neither drains traces nor touches an adapter", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/simulation/agcio/actuatorDecoder.ts", "utf8"),
    );
    expect(src).not.toMatch(/agc_out_trace|AgcCoreAdapter|WebAssembly|postMessage/);
  });
});

describe("frozen invariants", () => {
  it("active simulation protocol remains v1", () => {
    expect(SIMULATION_PROTOCOL_VERSION).toBe(1);
  });

  it("descent-monitor-v1 remains blocked", () => {
    const decision = decideMonitorEntry("descent-monitor-v1", {
      simulationEpoch: 3,
      agcSessionEpoch: 1,
      agcReady: true,
      hwioVersion: 2,
      ropeId: REQUIRED_ROPE_ID,
      ropeSha256: "0".repeat(64),
      runtimeStatus: "running",
      activeScenarioId: "golden",
      traceCurrentlyEnabled: false,
    });
    expect(decision.outcome).toBe("blocked");
  });
});
