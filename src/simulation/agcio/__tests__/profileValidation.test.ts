// SPDX-License-Identifier: GPL-3.0-or-later
//
// P5.a — pure profile-validator tests. No worker, no adapter, no timers.

import { describe, expect, it } from "vitest";
import {
  DESCENT_MONITOR_V1_UNRESOLVED_MAPPINGS,
  REQUIRED_ROPE_ID,
  SUPPORTED_MONITOR_PROFILES,
  decideMonitorEntry,
  validateSetMonitorProfileCommand,
  type MonitorEntryContext,
} from "@/simulation/agcio/profileValidation";
import type { ReservedSetMonitorProfileCommand } from "@/simulation/agcio/types";

const HAPPY_CTX: MonitorEntryContext = {
  simulationEpoch: 3,
  agcSessionEpoch: 1,
  agcReady: true,
  hwioVersion: 2,
  ropeId: REQUIRED_ROPE_ID,
  ropeSha256: "0".repeat(64),
  runtimeStatus: "running",
  activeScenarioId: "golden",
  traceCurrentlyEnabled: false,
};

describe("decideMonitorEntry", () => {
  it("off is always allowed and requires no preconditions", () => {
    const bad: MonitorEntryContext = {
      ...HAPPY_CTX,
      agcReady: false,
      hwioVersion: 0,
      ropeId: "Other",
      runtimeStatus: "idle",
      activeScenarioId: null,
      traceCurrentlyEnabled: true,
    };
    expect(decideMonitorEntry("off", bad)).toEqual({ outcome: "allowed", profile: "off" });
  });

  it("discrete-observer-v0 is allowed under the happy context", () => {
    expect(decideMonitorEntry("discrete-observer-v0", HAPPY_CTX)).toEqual({
      outcome: "allowed",
      profile: "discrete-observer-v0",
    });
  });

  it("descent-monitor-v1 is BLOCKED even in the happy context (LR/PIPA unresolved)", () => {
    const decision = decideMonitorEntry("descent-monitor-v1", HAPPY_CTX);
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome !== "blocked") throw new Error();
    // The full unresolved-mappings block must be present verbatim.
    for (const r of DESCENT_MONITOR_V1_UNRESOLVED_MAPPINGS) {
      expect(decision.reasons).toContainEqual(r);
    }
  });

  it("blocks discrete-observer-v0 with an aggregated reason set (atomic — never partial)", () => {
    const d = decideMonitorEntry("discrete-observer-v0", {
      ...HAPPY_CTX,
      hwioVersion: 1,
      ropeId: "Colossus249",
      agcReady: false,
      runtimeStatus: "idle",
      activeScenarioId: null,
      traceCurrentlyEnabled: true,
    });
    expect(d.outcome).toBe("blocked");
    if (d.outcome !== "blocked") throw new Error();
    const codes = d.reasons.map((r) => r.code).sort();
    expect(codes).toEqual(
      [
        "agc-not-ready",
        "canonical-hwio-wrong-version",
        "no-active-scenario",
        "rope-not-luminary099",
        "trace-already-enabled",
      ].sort(),
    );
  });

  it("rejects an unknown profile with profile-unknown", () => {
    // deliberate cast — external caller could smuggle an unknown string
    const d = decideMonitorEntry(
      "descent-monitor-v99" as unknown as (typeof SUPPORTED_MONITOR_PROFILES)[number],
      HAPPY_CTX,
    );
    expect(d.outcome).toBe("blocked");
    if (d.outcome !== "blocked") throw new Error();
    expect(d.reasons[0].code).toBe("profile-unknown");
  });
});

describe("validateSetMonitorProfileCommand", () => {
  const base: ReservedSetMonitorProfileCommand = {
    type: "sim:set-monitor-profile",
    commandId: 42,
    simulationEpoch: 5,
    applyAtMissionTimeUs: 20_000,
    profile: "discrete-observer-v0",
  };

  it("accepts a tick-aligned, current-epoch, future-cursor command", () => {
    const v = validateSetMonitorProfileCommand(base, 5, -1, 20_000);
    expect(v.ok).toBe(true);
  });

  it("rejects stale epoch", () => {
    const v = validateSetMonitorProfileCommand(base, 6, -1, 20_000);
    expect(v).toEqual({
      ok: false,
      reason: "stale-simulation-epoch",
      message: expect.stringContaining("epoch 5 != runtime epoch 6"),
    });
  });

  it("rejects stale cursor", () => {
    const v = validateSetMonitorProfileCommand(base, 5, 20_000, 20_000);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error();
    expect(v.reason).toBe("stale-command");
  });

  it("rejects non-tick-aligned applyAt", () => {
    const v = validateSetMonitorProfileCommand(
      { ...base, applyAtMissionTimeUs: 30_000 },
      5,
      -1,
      20_000,
    );
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error();
    expect(v.reason).toBe("not-tick-aligned");
  });

  it("rejects unsupported profile", () => {
    const v = validateSetMonitorProfileCommand(
      { ...base, profile: "descent-monitor-v99" as unknown as ReservedSetMonitorProfileCommand["profile"] },
      5,
      -1,
      20_000,
    );
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error();
    expect(v.reason).toBe("unsupported-profile");
  });
});
