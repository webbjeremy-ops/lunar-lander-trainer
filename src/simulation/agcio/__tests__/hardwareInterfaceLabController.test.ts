// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3E — MonitorController integration of the SYNTHETIC AGC
// HARDWARE-INTERFACE LAB.
//
// These tests use a fake MonitorHwPort, so nothing here instantiates
// WebAssembly. What they pin is the plumbing contract:
//
//   * no lab activity at all while any other profile is selected;
//   * PIPA pulses are delivered through the native PINC/MINC batch path,
//     derived ONLY from scenario specific force (no lunar gravity);
//   * a refused batch does NOT advance the residual carry (no lost ΔV);
//   * a landing-radar transaction happens ONLY when Luminary itself writes
//     CHAN13 — there is no host-side radar timer;
//   * diagnostics never conflate hardware delivery with rope consumption.

import { beforeEach, describe, expect, it } from "vitest";
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
import { RNRAD_ADDRESS } from "../radarObserver";

const LAB = "agc-hardware-interface-lab-v1" as const;

class FakePort implements MonitorHwPort {
  enabled = false;
  hwio = 4;
  pulseBatches: {
    counterAddress: number;
    incType: string;
    pulseCount: number;
    suborder: number;
  }[][] = [];
  pulsesAccepted = true;
  radarCalls: { word: number; bitCount: number; raise: boolean }[] = [];
  radarAccepted = true;

  hwioVersion() { return this.hwio; }
  traceEnabled() { return this.enabled; }
  setTraceEnabled(e: boolean) { this.enabled = e; }
  resetTrace() {}
  traceDropped() { return 0; }
  drainTrace(): readonly AgcOutputCounterEvent[] { return []; }
  writeInputChannel() {}
  applyCounterPulses(records: readonly {
    readonly counterAddress: number;
    readonly incType: string;
    readonly pulseCount: number;
    readonly suborder: number;
  }[]) {
    this.pulseBatches.push(records.map((r) => ({ ...r })));
    return this.pulsesAccepted;
  }
  applyLandingRadarUpdate(word: number, bitCount: number, raise: boolean) {
    this.radarCalls.push({ word, bitCount, raise });
    return this.radarAccepted;
  }
  totalPulses(): number {
    return this.pulseBatches.flat().reduce((n, r) => n + r.pulseCount, 0);
  }
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

/** One CHAN13 solicitation pair: INITREAD clears, then selects + ACTIVITY. */
function solicitation(select: number, timeUs = 0): Chan13Write[] {
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

describe("M3.3E lab — MonitorController integration", () => {
  let port: FakePort;
  let mc: MonitorController;

  beforeEach(() => {
    port = new FakePort();
    mc = new MonitorController(port);
  });

  function enterLab() {
    const d = mc.requestProfile(LAB, ctx(), AVIONICS);
    expect(d.outcome).toBe("entered");
  }

  it("enters as a supported profile and starts with an empty lab state", () => {
    enterLab();
    const lab = mc.labState();
    expect(lab).not.toBeNull();
    expect(lab?.hardwareInputPulsesDelivered).toBe(0);
    expect(lab?.chan13RequestsObserved).toBe(0);
  });

  it("does nothing lab-related under discrete-observer-v0", () => {
    const d = mc.requestProfile("discrete-observer-v0", ctx(), AVIONICS);
    expect(d.outcome).toBe("entered");
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    mc.postAgcTick(0, 20_000, [], {
      chan13Writes: solicitation(0o7),
      altitudeMeters: 1_000,
      rangeDataGood: true,
    });
    expect(port.pulseBatches).toHaveLength(0);
    expect(port.radarCalls).toHaveLength(0);
    expect(mc.labState()).toBeNull();
    expect(mc.labDiagnostics()).toBeNull();
  });

  it("delivers PIPA pulses from scenario specific force through PINC/MINC", () => {
    enterLab();
    // 3.2 m/s² for 20 ms = 0.064 m/s = 6.4 cm/s => 6 pulses, 0.4 carried.
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    expect(port.pulseBatches).toHaveLength(1);
    const batch = port.pulseBatches[0];
    expect(batch.every((r) => Object.values(PIPA_AXIS_ADDRESS).includes(r.counterAddress))).toBe(true);
    expect(batch.every((r) => r.incType === "PINC" || r.incType === "MINC")).toBe(true);
    expect(port.totalPulses()).toBeGreaterThan(0);
    expect(mc.labState()?.hardwareInputPulsesDelivered).toBe(port.totalPulses());
  });

  it("emits nothing when there is no scenario force or PIPA is failed", () => {
    enterLab();
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: null,
      dtUs: 20_000,
    });
    mc.preAgcTick({
      missionTick: 1,
      missionTimeUs: 20_000,
      avionics: { ...AVIONICS, pipaHealthy: false },
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    expect(port.pulseBatches).toHaveLength(0);
    expect(mc.labState()?.hardwareInputPulsesDelivered).toBe(0);
  });

  it("does not count a refused batch as delivered ΔV", () => {
    enterLab();
    port.pulsesAccepted = false;
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    expect(port.pulseBatches).toHaveLength(1);
    expect(mc.labState()?.hardwareInputPulsesDelivered).toBe(0);
  });

  it("never touches the radar without a CHAN13 solicitation", () => {
    enterLab();
    for (let t = 0; t < 40; t++) {
      mc.postAgcTick(t, t * 20_000, [], {
        chan13Writes: [],
        altitudeMeters: 1_000,
        rangeDataGood: true,
      });
    }
    expect(port.radarCalls).toHaveLength(0);
    const diag = mc.labDiagnostics();
    expect(diag?.chan13RequestsObserved).toBe(0);
    expect(diag?.repeatingRadarTimerPresent).toBe(false);
  });

  it("answers exactly one altitude solicitation with RNRAD + RADARUPT", () => {
    enterLab();
    mc.postAgcTick(0, 20_000, [], {
      chan13Writes: solicitation(0o7),
      altitudeMeters: 1_000,
      rangeDataGood: true,
    });
    expect(port.radarCalls).toHaveLength(1);
    expect(port.radarCalls[0].raise).toBe(true);
    expect(port.radarCalls[0].bitCount).toBe(15);
    expect(port.radarCalls[0].word).toBeGreaterThan(0);
    expect(mc.labDiagnostics()?.lastResponse?.action.counterAddress).toBe(RNRAD_ADDRESS);

    // A tick with no new solicitation answers nothing.
    mc.postAgcTick(1, 40_000, [], {
      chan13Writes: [],
      altitudeMeters: 1_000,
      rangeDataGood: true,
    });
    expect(port.radarCalls).toHaveLength(1);
    expect(mc.labDiagnostics()?.radarResponsesDelivered).toBe(1);
    // "last response" is per-tick: a tick that answered nothing reports null.
    expect(mc.labDiagnostics()?.lastResponse).toBeNull();
  });

  it("refuses to answer when RANGE DATA GOOD is not declared", () => {
    enterLab();
    mc.postAgcTick(0, 20_000, [], {
      chan13Writes: solicitation(0o7),
      altitudeMeters: 1_000,
      rangeDataGood: false,
    });
    expect(port.radarCalls).toHaveLength(0);
    expect(mc.labDiagnostics()?.radarResponsesRefused).toBeGreaterThan(0);
  });

  it("keeps hardware delivery and rope consumption strictly separate", () => {
    enterLab();
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    mc.postAgcTick(0, 20_000, [], {
      chan13Writes: [],
      altitudeMeters: 1_000,
      rangeDataGood: true,
    });
    const diag = mc.labDiagnostics();
    expect(diag?.hardwareInputDelivered).toBeGreaterThan(0);
    expect(diag?.ropeInputConsumed).toBe(false);
    expect(diag?.authenticMissionRequestGenerated).toBe(0);
    expect(diag?.banner.join(" ")).toContain("SYNTHETIC");
    expect(mc.snapshot(0).lab).toBe(diag);
  });

  it("clears every lab residual on exit and never re-arms implicitly", () => {
    enterLab();
    mc.preAgcTick({
      missionTick: 0,
      missionTimeUs: 0,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    mc.exitToOff(null);
    expect(mc.labState()).toBeNull();
    expect(mc.labDiagnostics()).toBeNull();

    const before = port.pulseBatches.length;
    mc.preAgcTick({
      missionTick: 1,
      missionTimeUs: 20_000,
      avionics: AVIONICS,
      bodySpecificForceMps2: [3.2, 0, 0],
      dtUs: 20_000,
    });
    expect(port.pulseBatches).toHaveLength(before);
  });
});
