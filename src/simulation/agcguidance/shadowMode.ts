// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — SHADOW MODE: the AGC watches, it does not fly.
//
// The progression this milestone locks in:
//
//   off      — no reconstructed guidance at all (frozen M4.1 behaviour);
//   shadow   — authentic Luminary is fed real simulated sensors and its
//              targets are recorded and compared against the reference
//              profile. `resolveGuidanceAuthority` NEVER returns a control
//              input in this mode. This is the safety property;
//   engaged   — "Reconstructed AGC Guidance": the adapter's bounded commands
//              are offered to the caller, and only if the authentic record is
//              present, valid and recent.
//
// Everything here is pure. The comparison is a diagnostic record, not a
// scoring input and not a control path.

import type { LunarControlInput } from "@/simulation/lunar2d/types";
import { CONTROL_ADAPTER_LABEL } from "./assumptions";
import type { AgcGuidanceTargetsV1 } from "./targets";
import type { ControlAdapterOutput } from "./controlAdapter";

export type AgcGuidanceMode = "off" | "shadow" | "engaged";

export const AGC_GUIDANCE_MODE_LABELS: Readonly<Record<AgcGuidanceMode, string>> = {
  off: "AGC GUIDANCE OFF — historically grounded procedure bridge flying",
  shadow: "SHADOW MODE — authentic Luminary observed, NOT controlling the vehicle",
  engaged: CONTROL_ADAPTER_LABEL,
};

export interface GuidanceDivergenceV1 {
  readonly missionTimeUs: number;
  readonly attitudeDeltaRad: number;
  readonly radialSpeedTargetDeltaMps: number;
  readonly throttleTendencyDelta: number;
  readonly programPhaseAgrees: boolean;
  /** True when every delta is inside the coherence tolerances below. */
  readonly coherent: boolean;
  readonly notes: readonly string[];
}

/** Tolerances at which the authentic record is considered "behaving sanely". */
export const COHERENCE_TOLERANCES = {
  attitudeRad: 20 * (Math.PI / 180),
  radialSpeedMps: 8,
  throttleTendency: 0.35,
} as const;

export function compareGuidance(
  authentic: AgcGuidanceTargetsV1,
  reference: AgcGuidanceTargetsV1,
): GuidanceDivergenceV1 {
  const attitudeDeltaRad = authentic.commandedAttitudeRad - reference.commandedAttitudeRad;
  const radialSpeedTargetDeltaMps =
    authentic.targetRadialSpeedMps - reference.targetRadialSpeedMps;
  const throttleTendencyDelta = authentic.throttleTendency - reference.throttleTendency;
  const programPhaseAgrees = authentic.programPhase === reference.programPhase;

  const notes: string[] = [];
  if (Math.abs(attitudeDeltaRad) > COHERENCE_TOLERANCES.attitudeRad) {
    notes.push("attitude-divergence");
  }
  if (Math.abs(radialSpeedTargetDeltaMps) > COHERENCE_TOLERANCES.radialSpeedMps) {
    notes.push("descent-rate-divergence");
  }
  if (Math.abs(throttleTendencyDelta) > COHERENCE_TOLERANCES.throttleTendency) {
    notes.push("throttle-divergence");
  }
  if (!programPhaseAgrees) notes.push("program-phase-disagreement");

  return {
    missionTimeUs: authentic.missionTimeUs,
    attitudeDeltaRad,
    radialSpeedTargetDeltaMps,
    throttleTendencyDelta,
    programPhaseAgrees,
    coherent: notes.length === 0,
    notes,
  };
}

/** Rolling coherence summary a UI or acceptance test can assert on. */
export interface ShadowSummaryV1 {
  readonly samples: number;
  readonly coherentSamples: number;
  readonly maxAttitudeDeltaRad: number;
  readonly maxThrottleDelta: number;
  readonly phaseDisagreements: number;
}

export const EMPTY_SHADOW_SUMMARY: ShadowSummaryV1 = {
  samples: 0,
  coherentSamples: 0,
  maxAttitudeDeltaRad: 0,
  maxThrottleDelta: 0,
  phaseDisagreements: 0,
};

export function accumulateShadowSummary(
  summary: ShadowSummaryV1,
  d: GuidanceDivergenceV1,
): ShadowSummaryV1 {
  return {
    samples: summary.samples + 1,
    coherentSamples: summary.coherentSamples + (d.coherent ? 1 : 0),
    maxAttitudeDeltaRad: Math.max(summary.maxAttitudeDeltaRad, Math.abs(d.attitudeDeltaRad)),
    maxThrottleDelta: Math.max(summary.maxThrottleDelta, Math.abs(d.throttleTendencyDelta)),
    phaseDisagreements: summary.phaseDisagreements + (d.programPhaseAgrees ? 0 : 1),
  };
}

export interface GuidanceAuthorityDecision {
  readonly mode: AgcGuidanceMode;
  readonly label: string;
  /** Non-null ONLY in "engaged" mode with a valid authentic-origin record. */
  readonly control: LunarControlInput | null;
  readonly reasons: readonly string[];
}

/**
 * The single gate between reconstructed guidance and the vehicle.
 *
 * Callers must route every reconstructed-guidance command through this
 * function. It refuses in every case except an explicitly engaged mode holding
 * an accepted adapter output built from an authentic-origin record.
 */
export function resolveGuidanceAuthority(input: {
  readonly mode: AgcGuidanceMode;
  readonly targets: AgcGuidanceTargetsV1 | null;
  readonly adapter: ControlAdapterOutput | null;
}): GuidanceAuthorityDecision {
  const { mode, targets, adapter } = input;
  const label = AGC_GUIDANCE_MODE_LABELS[mode];
  const reasons: string[] = [];

  if (mode !== "engaged") {
    reasons.push(mode === "shadow" ? "shadow-mode-never-controls" : "mode-off");
    return { mode, label, control: null, reasons };
  }
  if (!targets) reasons.push("no-guidance-targets");
  else if (targets.origin !== "authentic-luminary") reasons.push("targets-not-authentic");
  if (!adapter) reasons.push("no-adapter-output");
  else if (adapter.refusals.length > 0) reasons.push(...adapter.refusals);
  else if (!adapter.control) reasons.push("adapter-produced-no-control");

  if (reasons.length > 0) return { mode, label, control: null, reasons };
  return { mode, label, control: adapter!.control, reasons: [] };
}
