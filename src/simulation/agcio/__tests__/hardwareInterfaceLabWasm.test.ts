// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3E — CANONICAL-WASM ACCEPTANCE for the SYNTHETIC AGC HARDWARE-INTERFACE
// LAB.
//
// Unlike `hardwareInterfaceLabController.test.ts` (fake port), everything
// here runs against the CANONICAL HW-I/O v4 artifact
// `src/third-party/webagc/yaAGC-ext.wasm`, installed into a REAL
// `AgcCoreAdapter` through its `__testInstall` seam, and driven through the
// real `MonitorController`.
//
//   SYNTHETIC HARDWARE-INTERFACE FIXTURE
//   NOT AN AUTHENTIC P63 MISSION REQUEST
//
// Nothing here claims rope consumption: Luminary is not in Average-G, so
// READACCS never drains PIPAX/Y/Z. The diagnostic must keep saying exactly
// "native PIPA input delivered; rope consumption not active in this
// scenario".

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { AgcCoreAdapter } from "@/sim/agc/AgcCoreAdapter";
import { MonitorController, type MonitorHwPort } from "../MonitorController";
import type { MonitorEntryContext } from "../profileValidation";
import type { LmDiscreteSensorState } from "../discreteEncoder";
import type { AgcOutputCounterEvent } from "../types";
import {
  CHAN13,
  CHAN13_RADAR_ACTIVITY_BIT,
  type Chan13Write,
} from "../chan13Requests";
import { PIPA_AXIS_ADDRESS } from "../pipaEncoder";
import { RNRAD_ADDRESS, altitudeToRangeCount } from "../radarObserver";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const EXT_WASM = resolve(REPO_ROOT, "src/third-party/webagc/yaAGC-ext.wasm");

const LAB = "agc-hardware-interface-lab-v1" as const;
/** Native interrupt index 9 → vector 04044 (`RADAR RUPT`). */
const RADARUPT_INDEX = 9;

/**
 * SYNTHETIC HARDWARE-INTERFACE FIXTURE — NOT AN AUTHENTIC P63 MISSION
 * REQUEST. Test-only; it enters at the same ordered Worker capture boundary
 * real AGC CHAN13 output uses, and is not reachable from any production
 * timer or UI control.
 */
function syntheticSolicitation(select: number, timeUs = 0): Chan13Write[] {
  return [
    { channel: CHAN13, word: 0, agcCycle: 1, missionTimeUs: timeUs },
    {
      channel: CHAN13,
      word: select | CHAN13_RADAR_ACTIVITY_BIT,
      agcCycle: 2,
      missionTimeUs: timeUs,
    },
  ];
}

const AVIONICS: LmDiscreteSensorState = {
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

function ctx(over: Partial<MonitorEntryContext> = {}): MonitorEntryContext {
  return {
    simulationEpoch: 1,
    agcSessionEpoch: 0,
    agcReady: true,
    hwioVersion: 4,
    ropeId: "Luminary099",
    ropeSha256: "a".repeat(64),
    runtimeStatus: "running",
    activeScenarioId: "m3.3e-hardware-interface-lab-v1",
    traceCurrentlyEnabled: false,
    ...over,
  };
}

interface Harness {
  adapter: AgcCoreAdapter;
  mc: MonitorController;
  radarAccepted: { value: boolean };
  pulsesAccepted: { value: boolean };
  reset(): void;
  read(address: number): number;
  radaruptPending(): boolean;
}

async function makeHarness(): Promise<Harness> {
  const bytes = readFileSync(EXT_WASM);
  const memory = new WebAssembly.Memory({ initial: 5 });
  const stub = () => 0;
  const wasi = new Proxy({} as Record<string, () => number>, { get: () => stub });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: wasi,
  });

  const adapter = new AgcCoreAdapter();
  adapter.__testInstall(memory, instance.exports as never);
  (instance.exports as { cpu_reset: () => void }).cpu_reset();

  const radarAccepted = { value: true };
  const pulsesAccepted = { value: true };
  const port: MonitorHwPort = {
    hwioVersion: () => adapter.hwioVersion(),
    traceEnabled: () => adapter.traceEnabled(),
    setTraceEnabled: (e) => adapter.setTraceEnabled(e),
    resetTrace: () => adapter.resetTrace(),
    traceDropped: () => adapter.traceDropped(),
    drainTrace: (): readonly AgcOutputCounterEvent[] =>
      adapter.drainTrace().map((r) => ({
        stream: "counter" as const,
        sequence: { hi: r.sequence.hi, lo: r.sequence.lo },
        cycle: { hi: r.cycle.hi, lo: r.cycle.lo },
        address: r.address,
        operation: r.operation,
        delta: r.delta,
        valueBefore: r.valueBefore,
        valueAfter: r.valueAfter,
      })),
    writeInputChannel: (channel, word) => adapter.writeIo(channel, word),
    applyCounterPulses: (records) => {
      if (!pulsesAccepted.value) return false;
      if (records.length === 0) return false;
      return adapter.applyHwInput(
        records.map((r) => ({
          counterAddress: r.counterAddress,
          incType: r.incType as "PINC" | "MINC",
          pulseCount: r.pulseCount,
          suborder: r.suborder,
        })),
      ).ok;
    },
    applyLandingRadarUpdate: (word, bitCount, raise) => {
      if (!radarAccepted.value) return false;
      return adapter.applyLandingRadarUpdate(word, bitCount, raise) === 0;
    },
  };

  const harness: Harness = {
    adapter,
    mc: new MonitorController(port),
    radarAccepted,
    pulsesAccepted,
    reset: () => (instance.exports as { cpu_reset: () => void }).cpu_reset(),
    read: (address) => adapter.readErasableWord(address),
    radaruptPending: () => adapter.interruptRequestPending(RADARUPT_INDEX),
  };
  return harness;
}

function enterLab(h: Harness) {
  expect(h.mc.requestProfile(LAB, ctx(), AVIONICS).outcome).toBe("entered");
}

function thrustTick(h: Harness, tick: number, fx: number, dtUs = 20_000) {
  h.mc.preAgcTick({
    missionTick: tick,
    missionTimeUs: tick * dtUs,
    avionics: AVIONICS,
    bodySpecificForceMps2: [fx, 0, 0],
    dtUs,
  });
}

describe("M3.3E acceptance — canonical HW-I/O v4 WASM, native PIPA", () => {
  let h: Harness;
  beforeEach(async () => { h = await makeHarness(); });

  it("runs against the canonical v4 artifact through a real AgcCoreAdapter", () => {
    expect(h.adapter.hwioVersion()).toBe(4);
    expect(h.adapter.hwInputSupported()).toBe(true);
    expect(h.adapter.radarInterruptSupported()).toBe(true);
  });

  it("delivers PIPA pulses natively: the counters change exactly as encoded", () => {
    enterLab(h);
    thrustTick(h, 0, 3.2);
    const delivered = h.mc.labState()?.hardwareInputPulsesDelivered ?? 0;
    expect(delivered).toBeGreaterThan(0);

    const counters =
      h.read(PIPA_AXIS_ADDRESS.x) + h.read(PIPA_AXIS_ADDRESS.y) + h.read(PIPA_AXIS_ADDRESS.z);
    expect(counters).toBe(delivered);
    // Delivery is NOT rope consumption.
    h.mc.postAgcTick(0, 20_000, [], {
      chan13Writes: [],
      altitudeMeters: 1_000,
      rangeDataGood: true,
    });
    expect(h.mc.labDiagnostics()?.ropeInputConsumed).toBe(false);
    expect(h.mc.labDiagnostics()?.ropeConsumptionNote).toBe(
      "native PIPA input delivered; rope consumption not active in this scenario",
    );
  });

  it("free fall produces zero pulses — lunar gravity is absent", () => {
    enterLab(h);
    for (let t = 0; t < 25; t++) thrustTick(h, t, 0);
    expect(h.mc.labState()?.hardwareInputPulsesDelivered).toBe(0);
    expect(h.read(PIPA_AXIS_ADDRESS.x)).toBe(0);
    expect(h.read(PIPA_AXIS_ADDRESS.y)).toBe(0);
    expect(h.read(PIPA_AXIS_ADDRESS.z)).toBe(0);
  });

  it("uses PINC for positive and MINC for negative specific force", async () => {
    enterLab(h);
    thrustTick(h, 0, 3.2);
    const positive = h.read(PIPA_AXIS_ADDRESS.x);
    expect(positive).toBeGreaterThan(0);

    const g = await makeHarness();
    enterLab(g);
    g.mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [-3.2, 0, 0],
      dtUs: 20_000,
    });
    // MINC on a zero counter underflows into the 15-bit ones-complement
    // negative range: it must NOT read as a positive count.
    expect(g.read(PIPA_AXIS_ADDRESS.x)).not.toBe(positive);
    expect(g.mc.labState()?.hardwareInputPulsesDelivered).toBe(
      h.mc.labState()?.hardwareInputPulsesDelivered,
    );
  });

  it("is deterministic across subdivision and replay", async () => {
    enterLab(h);
    for (let t = 0; t < 10; t++) thrustTick(h, t, 3.27);
    const first = h.read(PIPA_AXIS_ADDRESS.x);

    const g = await makeHarness();
    enterLab(g);
    for (let t = 0; t < 10; t++) thrustTick(g, t, 3.27);
    expect(g.read(PIPA_AXIS_ADDRESS.x)).toBe(first);
  });

  it("a rejected batch mutates no counter and discards no residual", async () => {
    enterLab(h);
    h.pulsesAccepted.value = false;
    thrustTick(h, 0, 3.2);
    expect(h.read(PIPA_AXIS_ADDRESS.x)).toBe(0);
    expect(h.mc.labState()?.hardwareInputPulsesDelivered).toBe(0);

    // Residual retained: after accepting the same tick again, the delivered
    // ΔV matches a clean single-tick run (nothing was thrown away).
    h.pulsesAccepted.value = true;
    thrustTick(h, 1, 3.2);
    const g = await makeHarness();
    enterLab(g);
    thrustTick(g, 0, 3.2);
    expect(h.read(PIPA_AXIS_ADDRESS.x)).toBe(g.read(PIPA_AXIS_ADDRESS.x));
  });

  it("clears host residual state on profile exit", () => {
    enterLab(h);
    thrustTick(h, 0, 3.2);
    h.mc.exitToOff(null);
    expect(h.mc.labState()).toBeNull();
    expect(h.mc.labDiagnostics()).toBeNull();
    const before = h.read(PIPA_AXIS_ADDRESS.x);
    thrustTick(h, 1, 3.2);
    expect(h.read(PIPA_AXIS_ADDRESS.x)).toBe(before);
  });
});

describe("M3.3E acceptance — real RNRAD / RADARUPT transaction", () => {
  let h: Harness;
  beforeEach(async () => { h = await makeHarness(); });

  function radarTick(
    tick: number,
    writes: Chan13Write[],
    altitudeMeters: number | null,
    rangeDataGood = true,
  ) {
    h.mc.postAgcTick(tick, (tick + 1) * 20_000, [], {
      chan13Writes: writes,
      altitudeMeters,
      rangeDataGood,
      syntheticFixture: true,
    });
  }

  it("clear → select+ACTIVITY produces exactly one real RNRAD word + RADARUPT", () => {
    enterLab(h);
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
    expect(h.radaruptPending()).toBe(false);

    const altitude = 1_000;
    radarTick(0, syntheticSolicitation(0o7), altitude);

    const expected = altitudeToRangeCount(altitude);
    expect(h.read(RNRAD_ADDRESS)).toBe(expected);
    expect(h.radaruptPending()).toBe(true);
    expect(h.mc.labDiagnostics()?.radarResponsesDelivered).toBe(1);
    expect(h.mc.labDiagnostics()?.lastResponse?.action.counterAddress).toBe(RNRAD_ADDRESS);

    // A retained CHAN13 level is not a new request; the next empty tick
    // mutates nothing.
    radarTick(1, [], altitude);
    expect(h.read(RNRAD_ADDRESS)).toBe(expected);
    expect(h.mc.labDiagnostics()?.radarResponsesDelivered).toBe(1);
  });

  it("no request → no RNRAD mutation and no RADARUPT", () => {
    enterLab(h);
    for (let t = 0; t < 20; t++) radarTick(t, [], 1_000);
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
    expect(h.radaruptPending()).toBe(false);
  });

  it("refuses without RANGE DATA GOOD, and for unusable altitudes", async () => {
    enterLab(h);
    radarTick(0, syntheticSolicitation(0o7), 1_000, false);
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
    expect(h.radaruptPending()).toBe(false);

    const g = await makeHarness();
    enterLab(g);
    g.mc.postAgcTick(0, 20_000, [], {
      chan13Writes: syntheticSolicitation(0o7),
      altitudeMeters: null,
      rangeDataGood: true,
      syntheticFixture: true,
    });
    expect(g.read(RNRAD_ADDRESS)).toBe(0);

    const k = await makeHarness();
    enterLab(k);
    // Beyond the retained 14-bit counter width: refused, never wrapped.
    k.mc.postAgcTick(0, 20_000, [], {
      chan13Writes: syntheticSolicitation(0o7),
      altitudeMeters: 10_000_000,
      rangeDataGood: true,
      syntheticFixture: true,
    });
    expect(k.read(RNRAD_ADDRESS)).toBe(0);
    expect(k.radaruptPending()).toBe(false);
  });

  it("refuses LR velocity, rendezvous radar and unassigned selections", async () => {
    for (const select of [0o1, 0o2, 0o3, 0o4, 0o5, 0o6]) {
      const g = await makeHarness();
      enterLab(g);
      g.mc.postAgcTick(0, 20_000, [], {
        chan13Writes: syntheticSolicitation(select),
        altitudeMeters: 1_000,
        rangeDataGood: true,
        syntheticFixture: true,
      });
      expect(g.read(RNRAD_ADDRESS)).toBe(0);
      expect(g.radaruptPending()).toBe(false);
      expect(g.mc.labDiagnostics()?.radarResponsesDelivered).toBe(0);
    }
  });

  it("a hardware rejection is never counted as delivered and interlocks the lab", () => {
    enterLab(h);
    h.radarAccepted.value = false;
    radarTick(0, syntheticSolicitation(0o7), 1_000);
    const diag = h.mc.labDiagnostics();
    expect(diag?.radarResponsesDelivered).toBe(0);
    expect(diag?.radarResponsesRefused).toBe(1);
    expect(diag?.interlocked).toBe(true);
    expect(diag?.lastResponse).toBeNull();
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
    expect(h.radaruptPending()).toBe(false);

    // No silent retry, even once hardware would accept again.
    h.radarAccepted.value = true;
    radarTick(1, syntheticSolicitation(0o7, 40_000), 1_000);
    expect(h.mc.labDiagnostics()?.radarResponsesDelivered).toBe(0);
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
  });

  it("CPU reset clears the emulator-side radar transaction state", () => {
    enterLab(h);
    radarTick(0, syntheticSolicitation(0o7), 1_000);
    expect(h.read(RNRAD_ADDRESS)).toBeGreaterThan(0);
    h.reset();
    expect(h.read(RNRAD_ADDRESS)).toBe(0);
    expect(h.radaruptPending()).toBe(false);
  });
});
