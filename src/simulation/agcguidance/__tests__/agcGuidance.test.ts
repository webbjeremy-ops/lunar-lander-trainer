// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — Reconstructed AGC guidance: checkpoint, targets, control adapter,
// and the shadow-mode safety gate.
//
// The load-bearing property these tests pin: shadow mode can NEVER produce a
// control input, and the adapter can never exceed the kernel's own bounds.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTROL_ADAPTER_CONFIG,
  INITIAL_CONTROL_ADAPTER_STATE,
  RECONSTRUCTED_PDI_CHECKPOINT_V1,
  RECONSTRUCTION_ASSUMPTIONS,
  accumulateShadowSummary,
  assumptionById,
  buildReconstructedPdiCheckpoint,
  compareGuidance,
  EMPTY_SHADOW_SUMMARY,
  referenceGuidanceTargets,
  resolveGuidanceAuthority,
  stepControlAdapter,
  validateGuidanceTargets,
  validateReconstructedPdiCheckpoint,
  type AgcGuidanceTargetsV1,
} from "@/simulation/agcguidance";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS } from "@/simulation/lunar2d/LunarMissionConstants";
import { createLunarFlightState } from "@/simulation/lunar2d/physics";

const P = DEFAULT_LUNAR_FLIGHT_PARAMETERS;

describe("reconstruction assumption registry", () => {
  it("has unique, fully populated, falsifiable entries", () => {
    const ids = new Set<string>();
    for (const a of RECONSTRUCTION_ASSUMPTIONS) {
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
      expect(a.statement.length).toBeGreaterThan(20);
      expect(a.basis.length).toBeGreaterThan(20);
      expect(a.sources.length).toBeGreaterThan(0);
      expect(a.falsifiableBy.length).toBeGreaterThan(10);
    }
  });

  it("throws for an undeclared assumption id", () => {
    expect(() => assumptionById("no-such-assumption")).toThrow();
  });
});

describe("reconstructed PDI checkpoint", () => {
  it("validates and is deterministic", () => {
    expect(validateReconstructedPdiCheckpoint()).toEqual([]);
    expect(JSON.stringify(buildReconstructedPdiCheckpoint())).toBe(
      JSON.stringify(RECONSTRUCTED_PDI_CHECKPOINT_V1),
    );
  });

  it("is labelled as a reconstruction, not the original input deck", () => {
    expect(RECONSTRUCTED_PDI_CHECKPOINT_V1.label).toContain(
      "NOT THE ORIGINAL APOLLO 11 INPUT DECK",
    );
    expect(RECONSTRUCTED_PDI_CHECKPOINT_V1.classification).toBe(
      "historically-grounded-reconstruction",
    );
  });

  it("places the vehicle at the workbook PDI altitude and speed", () => {
    const s = RECONSTRUCTED_PDI_CHECKPOINT_V1.flightState;
    const r = Math.hypot(s.positionM[0], s.positionM[1]);
    const altitude = r - P.environment.meanRadiusM.value;
    expect(altitude).toBeGreaterThan(15_000);
    expect(altitude).toBeLessThan(15_500);
    expect(Math.hypot(...s.velocityMps)).toBeCloseTo(1_694.6, 0);
    expect(s.missionTimeUs).toBe(0);
    expect(s.terminalState).toBeNull();
  });

  it("declares Average-G active and a P00 pad load", () => {
    expect(RECONSTRUCTED_PDI_CHECKPOINT_V1.bookkeeping.averageGActive).toBe(true);
    expect(RECONSTRUCTED_PDI_CHECKPOINT_V1.padLoad.requiredMajorMode).toBe(0);
  });
});

describe("guidance targets", () => {
  const state = createLunarFlightState({ altitudeM: 3_000, radialSpeedMps: -30 }, P);

  it("reference targets are labelled advisory and validate", () => {
    const t = referenceGuidanceTargets(state, P);
    expect(t.origin).toBe("reference-profile");
    expect(t.label).toContain("ADVISORY");
    expect(validateGuidanceTargets(t)).toEqual([]);
  });

  it("rejects malformed records", () => {
    const bad = { ...referenceGuidanceTargets(state, P), throttleTendency: 4 };
    expect(validateGuidanceTargets(bad)).toContain("throttle-tendency-out-of-range");
  });
});

describe("reconstructed LM control-electronics adapter", () => {
  const state = createLunarFlightState({ altitudeM: 2_000, radialSpeedMps: -25 }, P);

  it("never exceeds the kernel attitude authority or rate bounds", () => {
    const targets: AgcGuidanceTargetsV1 = {
      ...referenceGuidanceTargets(state, P),
      commandedAttitudeRad: 3,
      attitudeRateTargetRadPerSec: 50,
    };
    const out = stepControlAdapter({
      state,
      targets,
      adapterState: INITIAL_CONTROL_ADAPTER_STATE,
      dtUs: 20_000,
      parameters: P,
    });
    expect(out.control).not.toBeNull();
    expect(Math.abs(out.control!.attitudeCommand)).toBeLessThanOrEqual(1);
    expect(out.clamped).toContain("attitude-rate");
  });

  it("slew-limits the throttle instead of stepping instantly", () => {
    const targets = { ...referenceGuidanceTargets(state, P), throttleTendency: 1 };
    const out = stepControlAdapter({
      state,
      targets,
      adapterState: INITIAL_CONTROL_ADAPTER_STATE,
      dtUs: 20_000,
      parameters: P,
    });
    const maxStep = DEFAULT_CONTROL_ADAPTER_CONFIG.throttleSlewPerSec * 0.02;
    expect(out.nextAdapterState.throttle).toBeLessThanOrEqual(maxStep + 1e-12);
    expect(out.clamped).toContain("throttle-slew");
  });

  it("refuses invalid targets and terminal states without guessing", () => {
    const bad = { ...referenceGuidanceTargets(state, P), throttleTendency: 9 };
    const refused = stepControlAdapter({
      state,
      targets: bad,
      adapterState: INITIAL_CONTROL_ADAPTER_STATE,
      dtUs: 20_000,
      parameters: P,
    });
    expect(refused.control).toBeNull();
    expect(refused.refusals.length).toBeGreaterThan(0);
    expect(refused.nextAdapterState).toBe(INITIAL_CONTROL_ADAPTER_STATE);

    const landed = { ...state, terminalState: "landed" as const };
    const out = stepControlAdapter({
      state: landed,
      targets: referenceGuidanceTargets(state, P),
      adapterState: INITIAL_CONTROL_ADAPTER_STATE,
      dtUs: 20_000,
      parameters: P,
    });
    expect(out.control).toBeNull();
    expect(out.refusals).toContain("terminal-state");
  });

  it("is a pure function of its inputs", () => {
    const targets = referenceGuidanceTargets(state, P);
    const a = stepControlAdapter({ state, targets, adapterState: INITIAL_CONTROL_ADAPTER_STATE, dtUs: 20_000, parameters: P });
    const b = stepControlAdapter({ state, targets, adapterState: INITIAL_CONTROL_ADAPTER_STATE, dtUs: 20_000, parameters: P });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("shadow mode safety gate", () => {
  const state = createLunarFlightState({ altitudeM: 1_500, radialSpeedMps: -20 }, P);
  const reference = referenceGuidanceTargets(state, P);
  const authentic: AgcGuidanceTargetsV1 = {
    ...reference,
    origin: "authentic-luminary",
    label: "AUTHENTIC LUMINARY GUIDANCE TARGETS",
    confidence: 1,
  };
  const adapter = stepControlAdapter({
    state,
    targets: authentic,
    adapterState: INITIAL_CONTROL_ADAPTER_STATE,
    dtUs: 20_000,
    parameters: P,
  });

  it("shadow mode never yields a control input, even with a valid adapter", () => {
    const d = resolveGuidanceAuthority({ mode: "shadow", targets: authentic, adapter });
    expect(d.control).toBeNull();
    expect(d.reasons).toContain("shadow-mode-never-controls");
    expect(d.label).toContain("NOT controlling the vehicle");
  });

  it("off mode never yields a control input", () => {
    expect(resolveGuidanceAuthority({ mode: "off", targets: authentic, adapter }).control).toBeNull();
  });

  it("engaged mode refuses reference-origin targets", () => {
    const d = resolveGuidanceAuthority({ mode: "engaged", targets: reference, adapter });
    expect(d.control).toBeNull();
    expect(d.reasons).toContain("targets-not-authentic");
  });

  it("engaged mode passes bounded commands from an authentic record", () => {
    const d = resolveGuidanceAuthority({ mode: "engaged", targets: authentic, adapter });
    expect(d.control).not.toBeNull();
    expect(d.reasons).toEqual([]);
    expect(Math.abs(d.control!.attitudeCommand)).toBeLessThanOrEqual(1);
    expect(d.control!.throttle).toBeGreaterThanOrEqual(0);
    expect(d.control!.throttle).toBeLessThanOrEqual(1);
  });

  it("compares and accumulates divergence without affecting control", () => {
    const identical = compareGuidance(authentic, reference);
    expect(identical.coherent).toBe(true);

    const drifted = compareGuidance(
      { ...authentic, commandedAttitudeRad: reference.commandedAttitudeRad + 1 },
      reference,
    );
    expect(drifted.coherent).toBe(false);
    expect(drifted.notes).toContain("attitude-divergence");

    let s = EMPTY_SHADOW_SUMMARY;
    s = accumulateShadowSummary(s, identical);
    s = accumulateShadowSummary(s, drifted);
    expect(s.samples).toBe(2);
    expect(s.coherentSamples).toBe(1);
    expect(s.maxAttitudeDeltaRad).toBeGreaterThan(0.9);
  });
});
