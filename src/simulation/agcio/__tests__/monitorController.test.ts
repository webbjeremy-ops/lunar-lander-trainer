// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.d — Worker-owned monitor lifecycle tests.
//
// The controller is exercised through a FAKE MonitorHwPort, so these tests
// never instantiate WebAssembly and can assert exactly which emulator calls
// were made (and, critically, which were NOT made while the profile is off).

import { describe, it, expect, beforeEach } from "vitest";
import {
  MonitorController,
  type MonitorHwPort,
} from "../MonitorController";
import type { MonitorEntryContext } from "../profileValidation";
import type { LmDiscreteSensorState } from "../discreteEncoder";
import type { AgcOutputChannelEvent, AgcOutputCounterEvent } from "../types";
import { MONITOR_TRACE_CAPACITY } from "../monitorTrace";
import { YAAGC_INPUT_CHANNEL_INIT } from "../inputShadow";

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

class FakePort implements MonitorHwPort {
  calls: Call[] = [];
  enabled = false;
  dropped = 0;
  pending: AgcOutputCounterEvent[] = [];
  writes: { channel: number; word: number }[] = [];
  hwio = 2;

  private rec(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  hwioVersion() { this.rec("hwioVersion"); return this.hwio; }
  traceEnabled() { this.rec("traceEnabled"); return this.enabled; }
  setTraceEnabled(e: boolean) { this.rec("setTraceEnabled", e); this.enabled = e; }
  resetTrace() { this.rec("resetTrace"); this.pending = []; this.dropped = 0; }
  traceDropped() { this.rec("traceDropped"); return this.dropped; }
  drainTrace(): readonly AgcOutputCounterEvent[] {
    this.rec("drainTrace");
    const out = this.pending;
    this.pending = [];
    return out;
  }
  writeInputChannel(channel: number, word: number) {
    this.rec("writeInputChannel", channel, word);
    this.writes.push({ channel, word });
  }
  names(): string[] { return this.calls.map((c) => c.name); }
  count(name: string): number { return this.calls.filter((c) => c.name === name).length; }
}

const AVIONICS: LmDiscreteSensorState = {
  engineArmed: true,
  autoThrottleEnabled: true,
  lgcInControl: true,
  issOperate: true,
  imuHealthy: true,
  landingRadarStatus: "not-acquired",
  landingRadarAntenna: "transit",
};

function ctx(over: Partial<MonitorEntryContext> = {}): MonitorEntryContext {
  return {
    simulationEpoch: 1,
    agcSessionEpoch: 0,
    agcReady: true,
    hwioVersion: 2,
    ropeId: "Luminary099",
    ropeSha256: "a".repeat(64),
    runtimeStatus: "running",
    activeScenarioId: "apollo11-pdi",
    traceCurrentlyEnabled: false,
    ...over,
  };
}

function counterEvent(seq: number, delta: number): AgcOutputCounterEvent {
  return {
    stream: "counter",
    sequence: { hi: 0, lo: seq },
    cycle: { hi: 0, lo: seq },
    address: 0o55,
    operation: 0,
    delta,
    valueBefore: 0,
    valueAfter: Math.abs(delta),
  };
}

function channelEvent(channel: number, value: number, seq: number): AgcOutputChannelEvent {
  return {
    stream: "channel",
    sequence: { hi: 0, lo: seq },
    cycle: { hi: 0, lo: seq },
    channel,
    value,
    valueBefore: null,
  };
}

describe("MonitorController — dormancy while off", () => {
  it("invokes no counter-input or trace-enable API while the profile is off", () => {
    const port = new FakePort();
    const mc = new MonitorController(port);
    for (let t = 0; t < 10; t++) {
      mc.preAgcTick({ missionTick: t, missionTimeUs: t * 20_000, avionics: AVIONICS });
      mc.postAgcTick(t, t * 20_000, []);
    }
    expect(port.count("setTraceEnabled")).toBe(0);
    expect(port.count("drainTrace")).toBe(0);
    expect(port.count("writeInputChannel")).toBe(0);
    expect(mc.facts().status).toBe("off");
    expect(mc.snapshot(9).traceEnabled).toBe(false);
  });
});

describe("MonitorController — atomic entry", () => {
  let port: FakePort;
  let mc: MonitorController;
  beforeEach(() => {
    port = new FakePort();
    mc = new MonitorController(port);
  });

  it("arms in the mandated order: reset → verify empty → enable → verify", () => {
    const r = mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    expect(r.outcome).toBe("entered");
    const order = port.names().filter((n) =>
      n === "resetTrace" || n === "drainTrace" || n === "setTraceEnabled" || n === "traceEnabled",
    );
    const resetIdx = order.indexOf("resetTrace");
    const drainIdx = order.indexOf("drainTrace");
    const enableIdx = order.indexOf("setTraceEnabled");
    expect(resetIdx).toBeLessThan(drainIdx);
    expect(drainIdx).toBeLessThan(enableIdx);
    // verification read happens after arming
    expect(order.lastIndexOf("traceEnabled")).toBeGreaterThan(enableIdx);
    expect(port.enabled).toBe(true);
  });

  it("blocks descent-monitor-v1 with authentic unresolved-mapping reasons", () => {
    const r = mc.requestProfile("descent-monitor-v1", ctx(), AVIONICS);
    expect(r.outcome).toBe("blocked");
    expect(r.reasons.some((x) => x.code === "unresolved-sensor-mapping")).toBe(true);
    // No partial fallback into discrete mode, and nothing armed.
    expect(mc.facts().profile).toBe("off");
    expect(port.enabled).toBe(false);
  });

  it("blocks entry when no explicit avionics state was supplied", () => {
    const r = mc.requestProfile("discrete-observer-v0", ctx(), null);
    expect(r.outcome).toBe("blocked");
    expect(r.reasons.some((x) => x.code === "prerequisite-missing")).toBe(true);
    expect(port.enabled).toBe(false);
  });

  it("blocks entry when the runtime is not HW-I/O v2", () => {
    port.hwio = 0;
    const r = mc.requestProfile("discrete-observer-v0", ctx({ hwioVersion: 0 }), AVIONICS);
    expect(r.outcome).toBe("blocked");
    expect(port.enabled).toBe(false);
  });
});

describe("MonitorController — sensor injection", () => {
  let port: FakePort;
  let mc: MonitorController;
  beforeEach(() => {
    port = new FakePort();
    mc = new MonitorController(port);
    mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    port.writes = [];
  });

  it("emits the complete owned state exactly once on the first tick", () => {
    const first = mc.preAgcTick({ missionTick: 0, missionTimeUs: 0, avionics: AVIONICS });
    expect(first.actionsApplied).toBeGreaterThan(0);
    const second = mc.preAgcTick({ missionTick: 1, missionTimeUs: 20_000, avionics: AVIONICS });
    // Unchanged avionics ⇒ no redundant writes.
    expect(second.actionsApplied).toBe(0);
  });

  it("preserves unowned CHAN30/CHAN33 bits and is idempotent", () => {
    const shadow = mc.inputShadow();
    // Seed an unowned bit the monitor does not own (bit 15 of CH030).
    const unowned = 1 << 14;
    shadow.write(0o30, YAAGC_INPUT_CHANNEL_INIT[0o30] | unowned);
    mc.preAgcTick({ missionTick: 0, missionTimeUs: 0, avionics: AVIONICS });
    expect(shadow.read(0o30) & unowned).toBe(unowned);
    const after = shadow.read(0o30);
    mc.preAgcTick({ missionTick: 1, missionTimeUs: 20_000, avionics: AVIONICS });
    expect(shadow.read(0o30)).toBe(after);
  });

  it("writes only COMPLETE channel words through the frozen packet path", () => {
    mc.preAgcTick({ missionTick: 0, missionTimeUs: 0, avionics: AVIONICS });
    expect(port.writes.length).toBeGreaterThan(0);
    for (const w of port.writes) {
      expect(w.word).toBe(w.word & 0o77777);
      expect([0o30, 0o33]).toContain(w.channel);
    }
  });

  it("interlocks (and applies nothing) on an incomplete avionics state", () => {
    const bad = { ...AVIONICS } as Record<string, unknown>;
    delete bad.imuHealthy;
    const before = port.writes.length;
    const r = mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: bad as unknown as LmDiscreteSensorState,
    });
    expect(r.rejected).toBe(true);
    expect(port.writes.length).toBe(before);
    expect(mc.facts().status).toBe("interlocked");
    expect(port.enabled).toBe(false);
  });
});

describe("MonitorController — output observation", () => {
  let port: FakePort;
  let mc: MonitorController;
  beforeEach(() => {
    port = new FakePort();
    mc = new MonitorController(port);
    mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    port.calls = [];
  });

  it("drains the WASM ring exactly once per tick; a second drain is empty", () => {
    port.pending = [counterEvent(1, 5), counterEvent(2, -3)];
    mc.postAgcTick(0, 20_000, []);
    expect(port.count("drainTrace")).toBe(1);
    expect(port.drainTrace()).toEqual([]);
    expect(mc.facts().traceDrainCount).toBe(1);
  });

  it("preserves repeated CHAN11 writes losslessly and decodes engine ON", () => {
    const engineOn = 1 << 12;
    mc.postAgcTick(0, 20_000, [
      channelEvent(0o11, engineOn, 1),
      channelEvent(0o11, engineOn, 2),
    ]);
    const raw = mc.rawOutputs();
    expect(raw.channelEvents).toHaveLength(2);
    expect(mc.snapshot(0).commandedControl?.engineCommand).toBe("on");
  });

  it("never resolves a throttle magnitude from THRUST activity", () => {
    port.pending = [counterEvent(1, 42)];
    mc.postAgcTick(0, 20_000, []);
    const control = mc.snapshot(0).commandedControl;
    expect(control?.throttleFraction).toBeNull();
    expect(control?.valid).toBe(false);
    expect(mc.thrustDiagnostic()?.scaleStatus).toBe("unresolved");
  });

  it("surfaces dropped trace data in the snapshot", () => {
    port.dropped = 7;
    mc.postAgcTick(0, 20_000, []);
    expect(mc.snapshot(0).traceDropped).toBeGreaterThanOrEqual(7);
  });
});

describe("MonitorController — disarm and interlock paths", () => {
  function armed(): { port: FakePort; mc: MonitorController } {
    const port = new FakePort();
    const mc = new MonitorController(port);
    mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    return { port, mc };
  }

  it("explicit exit disables + resets trace and clears retained diagnostics", () => {
    const { port, mc } = armed();
    mc.postAgcTick(0, 20_000, [channelEvent(0o11, 1 << 12, 1)]);
    expect(mc.traceWindow().retainedCount).toBeGreaterThan(0);
    mc.requestProfile("off", ctx(), AVIONICS);
    expect(port.enabled).toBe(false);
    expect(port.count("resetTrace")).toBeGreaterThanOrEqual(2);
    expect(mc.traceWindow().retainedCount).toBe(0);
    expect(mc.facts().status).toBe("off");
  });

  it("an AGC reset interlocks and never re-arms implicitly", () => {
    const { port, mc } = armed();
    port.calls = [];
    mc.onAgcEpochChanged(1);
    expect(mc.facts().status).toBe("interlocked");
    expect(mc.facts().interlockReason).toBe("agc-reset");
    expect(port.enabled).toBe(false);
    // Subsequent ticks stay inert.
    mc.preAgcTick({ missionTick: 5, missionTimeUs: 100_000, avionics: AVIONICS });
    mc.postAgcTick(5, 120_000, []);
    expect(port.count("drainTrace")).toBe(0);
  });

  it("a scenario reset interlocks", () => {
    const { mc } = armed();
    mc.onSimulationEpochChanged(2);
    expect(mc.facts().status).toBe("interlocked");
  });

  it("a terminal state interlocks", () => {
    const { mc } = armed();
    mc.onTerminalState();
    expect(mc.facts().status).toBe("interlocked");
  });

  it("interlocks when the trace is disabled behind the monitor's back", () => {
    const { port, mc } = armed();
    port.enabled = false; // e.g. cpu_reset inside the WASM
    const r = mc.preAgcTick({ missionTick: 1, missionTimeUs: 20_000, avionics: AVIONICS });
    expect(r.rejected).toBe(true);
    expect(mc.facts().interlockReason).toBe("trace-unexpectedly-disabled");
  });

  it("dispose leaves the trace disabled", () => {
    const { port, mc } = armed();
    mc.dispose();
    expect(port.enabled).toBe(false);
  });
});

describe("MonitorController — bounded retention", () => {
  it("reports overflow honestly rather than silently truncating", () => {
    const port = new FakePort();
    const mc = new MonitorController(port);
    mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    for (let t = 0; t < MONITOR_TRACE_CAPACITY + 50; t++) {
      mc.postAgcTick(t, t * 20_000, [channelEvent(0o11, 1 << 12, t + 1)]);
    }
    const w = mc.traceWindow();
    expect(w.retainedCount).toBe(MONITOR_TRACE_CAPACITY);
    expect(w.droppedCount).toBe(50);
    expect(w.capacity).toBe(MONITOR_TRACE_CAPACITY);
    expect(w.firstSeq).toBe(51);
  });
});
