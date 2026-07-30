// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B §5 — bootstrap transaction lifecycle tests.

import { describe, expect, it, beforeEach } from "vitest";
import {
  applyFixedAttitudeImuBootstrapV1,
  type BootstrapContext,
  type BootstrapPadLoadPort,
} from "../bootstrapTransaction";
import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
} from "../padLoadManifest";
import { CANONICAL_AGC_RUNTIME } from "@/agc/AgcRuntimeManifest";

/** A faithful in-memory model of the HW-I/O v4 window semantics. */
class FakePadPort implements BootstrapPadLoadPort {
  words = new Map<number, number>();
  status = 0;
  applied = 0;
  errorIndex = -1;
  hwio = 4;
  supported = true;
  trace = false;
  calls: string[] = [];
  failApplyWith: number | null = null;
  corruptAddress: number | null = null;

  padLoadSupported() { return this.supported; }
  hwioVersion() { return this.hwio; }
  padLoadStatus() { return this.status; }
  padLoadAppliedCount() { return this.applied; }
  padLoadLastErrorIndex() { return this.errorIndex; }
  traceEnabled() { return this.trace; }

  openPadLoadWindow() {
    this.calls.push("open");
    if (this.status !== 0) return -21;
    this.status = 1;
    return 0;
  }
  closePadLoadWindow() {
    this.calls.push("close");
    this.status = (this.status & ~1) | 4;
    return 0;
  }
  applyPadLoad(encoded: Uint8Array, count: number) {
    this.calls.push("apply");
    if ((this.status & 1) === 0) return -20;
    if (this.failApplyWith !== null) { this.errorIndex = 1; return this.failApplyWith; }
    const dv = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    for (let i = 0; i < count; i++) {
      const address = dv.getUint16(i * 6, true);
      const value = dv.getUint16(i * 6 + 4, true);
      this.words.set(address, address === this.corruptAddress ? value ^ 1 : value);
    }
    this.applied = count;
    this.status |= 2;
    return 0;
  }
  readErasableWord(address: number) {
    this.calls.push("read");
    return this.words.get(address) ?? 0;
  }
}

const CTX: BootstrapContext = {
  clockPaused: true,
  monitorProfile: "off",
  traceRingCount: 0,
  pendingHwInputRecords: 0,
  ropeId: "Luminary099",
  ropeSha256: MANIFEST.ropeSha256,
  runtimeSha256: CANONICAL_AGC_RUNTIME.sha256,
  agcEpoch: 1,
  simulationEpoch: 1,
  installedInAgcEpoch: null,
  majorMode: 0,
  scenarioId: "apollo11-vertical-descent-v1",
  allowedScenarioIds: ["apollo11-vertical-descent-v1"],
};

const ctx = (over: Partial<BootstrapContext> = {}): BootstrapContext => ({ ...CTX, ...over });

describe("applyFixedAttitudeImuBootstrapV1", () => {
  let port: FakePadPort;
  beforeEach(() => { port = new FakePadPort(); });

  it("installs all 22 words and verifies read-back", () => {
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx());
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.installedWords).toBe(22);
    expect(r.readBack).toHaveLength(22);
  });

  it("follows the mandated order: open -> apply -> close -> read", () => {
    applyFixedAttitudeImuBootstrapV1(port, ctx());
    const order = port.calls.filter((c) => c !== "read");
    expect(order).toEqual(["open", "apply", "close"]);
    expect(port.calls.indexOf("close")).toBeLessThan(port.calls.indexOf("read"));
  });

  it("seals the window even when the apply is rejected", () => {
    port.failApplyWith = -29;
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx());
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe("pad-load-rejected");
    expect(port.calls).toContain("close");
    expect(port.words.size).toBe(0);
  });

  it("detects a single-bit corruption during read-back", () => {
    port.corruptAddress = 0o1733;
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx());
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.code === "readback-mismatch")).toBe(true);
  });

  it.each([
    ["clock-running", { clockPaused: false }],
    ["monitor-active", { monitorProfile: "descent-monitor-v1" }],
    ["trace-not-empty", { traceRingCount: 3 }],
    ["hw-input-pending", { pendingHwInputRecords: 1 }],
    ["rope-provenance", { ropeSha256: "0".repeat(64) }],
    ["runtime-provenance", { runtimeSha256: "0".repeat(64) }],
    ["major-mode", { majorMode: 63 }],
    ["scenario-incompatible", { scenarioId: "other" }],
    ["already-installed", { installedInAgcEpoch: 1 }],
  ])("refuses on %s and never opens a window", (code, over) => {
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx(over as Partial<BootstrapContext>));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.code)).toContain(code);
    expect(port.calls).not.toContain("open");
  });

  it("refuses when the runtime is not HW-I/O v4", () => {
    port.hwio = 3;
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx());
    expect(r.failures.map((f) => f.code)).toContain("hwio-version");
  });

  it("refuses when the trace is armed behind the caller's back", () => {
    port.trace = true;
    expect(applyFixedAttitudeImuBootstrapV1(port, ctx()).failures.map((f) => f.code))
      .toContain("trace-enabled");
  });

  it("refuses when the pad-load window is not pristine", () => {
    port.status = 4;
    expect(applyFixedAttitudeImuBootstrapV1(port, ctx()).failures.map((f) => f.code))
      .toContain("window-not-pristine");
  });

  it("rejects a manifest containing an unrelated erasable", () => {
    const bad = {
      ...MANIFEST,
      records: [
        ...MANIFEST.records,
        { ...MANIFEST.records[0], symbol: "STRAY", address: 0o1000, addressOctal: "0o1000" },
      ],
    };
    const r = applyFixedAttitudeImuBootstrapV1(port, ctx(), bad);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.code.startsWith("manifest:"))).toBe(true);
    expect(port.calls).not.toContain("open");
  });

  it("cannot be reapplied in the same AGC epoch", () => {
    expect(applyFixedAttitudeImuBootstrapV1(port, ctx()).ok).toBe(true);
    const again = applyFixedAttitudeImuBootstrapV1(port, ctx({ installedInAgcEpoch: 1 }));
    expect(again.ok).toBe(false);
    expect(again.failures.map((f) => f.code)).toContain("already-installed");
  });

  it("is eligible again after a reset creates a new AGC epoch", () => {
    applyFixedAttitudeImuBootstrapV1(port, ctx());
    const fresh = new FakePadPort();
    const r = applyFixedAttitudeImuBootstrapV1(fresh, ctx({ agcEpoch: 2, installedInAgcEpoch: 1 }));
    expect(r.ok).toBe(true);
    expect(r.agcEpoch).toBe(2);
  });
});
