// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 3 — Pure LM PIPA (ΔV) encoder.
//
// PURE FUNCTION MODULE. No module-global mutable state, no WASM, no Worker,
// no trace arming, no I/O. It converts a caller-declared STABLE-MEMBER-AXIS
// specific-force vector into the exact ordered PINC/MINC pulse stream the
// HW-I/O v3 host-input surface delivers to PIPAX/PIPAY/PIPAZ, and reports
// the residual velocity the AGC has NOT yet been told about.
//
// SCALE (primary + rope-internal, both independent) — 1 pulse = 1.00 cm/s:
//   * Draper Lab, "Design Survey of the Apollo Inertial Subsystem"
//     (March 1970, NTRS 19700018941), Fig. 4-3, PDF p.66, verbatim:
//       "AV COMMAND MODULE 5.85 CM/SEC/PULSE  /  AV LEM 1.0 CM/SEC/PULSE".
//     The 5.85 cm/s figure is the COMMAND MODULE weight and does not apply
//     to the LM.
//   * Luminary099 @911e5c0 SERVICER.agc:192 `ABDELV = CM/SEC*2(-14)` and
//     :219 `CA KPIP1 # TP MPAC = ABDELV AT 2(14) CM/SEC`. ABDELV is formed
//     from the RAW PIPA counter difference with no intervening scale, so
//     one count is one cm/s.
//   See docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md.
//
// AXIS SCOPE — the caller declares stable-member-axis specific force.
//   This module performs NO body->stable-member rotation. The LM body +X
//   axis is the DPS thrust axis, but the body->SM relation is fixed by
//   REFSMMAT plus the CDU angles, and no source-proven bootstrap exists yet
//   for the golden scenario (docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md §3.3).
//   Inventing a rotation here would fabricate Apollo operation.
//
// NOT CONTROL. The emitted pulses are INPUTS to Luminary099. Nothing decoded
// from the AGC may reach the LM physics kernel.

import type { AgcSensorAction, MonitorBlockReason } from "./types";

/** PIPA erasable counter addresses (yaAGC / Luminary099). */
export const PIPAX_ADDRESS = 0o37;
export const PIPAY_ADDRESS = 0o40;
export const PIPAZ_ADDRESS = 0o41;

export type PipaAxis = "x" | "y" | "z";

export const PIPA_AXIS_ADDRESS: Readonly<Record<PipaAxis, number>> = {
  x: PIPAX_ADDRESS,
  y: PIPAY_ADDRESS,
  z: PIPAZ_ADDRESS,
};

/** Resolved LM PIPA pulse weight: exactly 1 cm/s of velocity change. */
export const PIPA_CM_PER_SECOND_PER_PULSE = 1.0;

/** Same weight in SI. Exact in binary? No — 0.01 is not exactly
 *  representable, so all accumulation is done in CENTIMETRES per second and
 *  converted only at the boundary, keeping quantization deterministic. */
export const PIPA_METERS_PER_SECOND_PER_PULSE = 0.01;

export const PIPA_SCALE_CITATION =
  "Draper 'Design Survey of the Apollo Inertial Subsystem' (Mar 1970, NTRS 19700018941) Fig.4-3 p.66 'AV LEM 1.0 CM/SEC/PULSE'; Luminary099/SERVICER.agc:192,219 (ABDELV = CM/SEC); docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md";

/** The Command-Module weight, recorded ONLY so the reconciliation is
 *  machine-checkable and can never be silently reintroduced for the LM. */
export const PIPA_COMMAND_MODULE_CM_PER_PULSE_NOT_LM = 5.85;

/**
 * NON-AUTHENTIC REFUSAL BOUND — NOT A SOURCED PIPA RATE LIMIT.
 *
 * The PTA pulse-quantum rate limit is not stated in any primary document
 * available to this project. Rather than invent a saturation behaviour, the
 * encoder REFUSES atomically (emits nothing at all for the tick, with a
 * blocked prerequisite) when a single axis would need more pulses in one
 * tick than this bound. It exists purely to make an absurd input loud
 * instead of silent; production code must never present it as Apollo data.
 */
export const PIPA_UNSOURCED_MAX_PULSES_PER_AXIS_PER_TICK = 100_000;

export const PIPA_UNSOURCED_MAX_PULSES_LABEL =
  "NON-AUTHENTIC REFUSAL BOUND — NOT A SOURCED PIPA RATE LIMIT";

export interface PipaEncoderState {
  readonly kind: "pipa-encoder-state-v1";
  /** Per-axis un-pulsed velocity remainder, CENTIMETRES per second.
   *  Invariant: |residual| < 1 cm/s after every encode. */
  readonly residualCmPerSecond: Readonly<Record<PipaAxis, number>>;
  /** Signed cumulative pulse count per axis since state creation. */
  readonly cumulativePulses: Readonly<Record<PipaAxis, number>>;
}

export function createPipaEncoderState(): PipaEncoderState {
  return {
    kind: "pipa-encoder-state-v1",
    residualCmPerSecond: { x: 0, y: 0, z: 0 },
    cumulativePulses: { x: 0, y: 0, z: 0 },
  };
}

export interface PipaEncoderInputs {
  readonly missionTimeUs: number;
  /** Tick length, integer microseconds. Must be > 0. */
  readonly dtUs: number;
  /**
   * Specific force sensed by the PIPAs, resolved on the STABLE MEMBER axes,
   * m/s^2. This is the non-gravitational (thrust + surface reaction)
   * acceleration only — a PIPA in free fall reads zero. `null` when no
   * scenario is running.
   */
  readonly specificForceStableMemberMps2: Readonly<
    Record<PipaAxis, number>
  > | null;
  /** Operator/scenario-declared PIPA health. With the accelerometers failed
   *  the hardware delivers no pulses; the encoder never invents them. */
  readonly pipaHealthy: boolean;
}

export interface PipaAxisDiagnostic {
  readonly axis: PipaAxis;
  readonly counterAddress: number;
  readonly specificForceMps2: number;
  /** ΔV accrued this tick before quantization, cm/s. */
  readonly deltaVCmPerSecond: number;
  readonly pulseCount: number;
  readonly incType: "PINC" | "MINC" | null;
  /** Residual carried into the next tick, cm/s. |residual| < 1. */
  readonly residualCmPerSecond: number;
  /** Velocity the AGC can reconstruct minus true velocity, m/s. */
  readonly residualMetersPerSecond: number;
  readonly cumulativePulses: number;
}

export interface PipaEncoderDiagnostic {
  readonly missionTimeUs: number;
  readonly dtUs: number;
  readonly emitted: boolean;
  readonly pipaHealthy: boolean;
  readonly cmPerSecondPerPulse: typeof PIPA_CM_PER_SECOND_PER_PULSE;
  readonly scaleCitation: string;
  readonly axes: readonly PipaAxisDiagnostic[];
}

export interface PipaEncoderResult {
  readonly nextState: PipaEncoderState;
  /** Ordered PINC/MINC actions, X then Y then Z. Empty when nothing is due.
   *  Opposing pulses are never collapsed: one axis emits at most one action
   *  of one polarity per tick, which is the exact hardware behaviour for a
   *  single integration interval. */
  readonly actions: readonly AgcSensorAction[];
  readonly diagnostic: PipaEncoderDiagnostic;
  readonly blockedPrerequisites: readonly MonitorBlockReason[];
}

const AXES: readonly PipaAxis[] = ["x", "y", "z"];

/** Suborder base: PIPA pulses precede the landing-radar serial word (100)
 *  because in Luminary the LR read is scheduled BY the PIPA-driven
 *  READACCS/SERVICER cycle. */
const PIPA_SUBORDER_BASE = 10;

function idleDiagnostic(
  inputs: PipaEncoderInputs,
  state: PipaEncoderState,
): PipaEncoderDiagnostic {
  return {
    missionTimeUs: inputs.missionTimeUs,
    dtUs: inputs.dtUs,
    emitted: false,
    pipaHealthy: inputs.pipaHealthy,
    cmPerSecondPerPulse: PIPA_CM_PER_SECOND_PER_PULSE,
    scaleCitation: PIPA_SCALE_CITATION,
    axes: AXES.map((axis) => ({
      axis,
      counterAddress: PIPA_AXIS_ADDRESS[axis],
      specificForceMps2:
        inputs.specificForceStableMemberMps2?.[axis] ?? 0,
      deltaVCmPerSecond: 0,
      pulseCount: 0,
      incType: null,
      residualCmPerSecond: state.residualCmPerSecond[axis],
      residualMetersPerSecond:
        (state.residualCmPerSecond[axis] * PIPA_METERS_PER_SECOND_PER_PULSE) /
        PIPA_CM_PER_SECOND_PER_PULSE,
      cumulativePulses: state.cumulativePulses[axis],
    })),
  };
}

/**
 * Encode ONE mission tick of PIPA ΔV into ordered PINC/MINC pulses.
 *
 * Quantization is truncation toward zero on the accumulated (residual + ΔV)
 * total, with the untruncated part carried forward exactly. This is drift
 * free: the sum of emitted pulses always equals
 * `trunc(total accumulated ΔV in cm/s)` regardless of tick subdivision.
 *
 * The tick is ATOMIC: if any axis fails a precondition, NOTHING is emitted
 * and the state is returned unchanged.
 */
export function encodePipaTick(
  state: PipaEncoderState,
  inputs: PipaEncoderInputs,
): PipaEncoderResult {
  const blocked: MonitorBlockReason[] = [];

  if (!Number.isInteger(inputs.missionTimeUs) || inputs.missionTimeUs < 0) {
    blocked.push({
      code: "sensor-range-invalid",
      detail: `missionTimeUs must be a non-negative integer (got ${inputs.missionTimeUs}).`,
    });
    return {
      nextState: state,
      actions: [],
      diagnostic: idleDiagnostic(inputs, state),
      blockedPrerequisites: blocked,
    };
  }

  if (!Number.isInteger(inputs.dtUs) || inputs.dtUs <= 0) {
    blocked.push({
      code: "sensor-range-invalid",
      detail: `dtUs must be a positive integer (got ${inputs.dtUs}).`,
    });
    return {
      nextState: state,
      actions: [],
      diagnostic: idleDiagnostic(inputs, state),
      blockedPrerequisites: blocked,
    };
  }

  const sf = inputs.specificForceStableMemberMps2;

  // No scenario running, or the operator has declared the PIPAs failed:
  // emit nothing, and do NOT accumulate — the hardware is not integrating.
  if (sf === null || !inputs.pipaHealthy) {
    return {
      nextState: state,
      actions: [],
      diagnostic: idleDiagnostic(inputs, state),
      blockedPrerequisites: [],
    };
  }

  for (const axis of AXES) {
    if (!Number.isFinite(sf[axis])) {
      blocked.push({
        code: "sensor-range-invalid",
        detail: `stable-member specific force ${axis} must be finite (got ${sf[axis]}).`,
        reference: PIPA_SCALE_CITATION,
      });
    }
  }
  if (blocked.length > 0) {
    return {
      nextState: state,
      actions: [],
      diagnostic: idleDiagnostic(inputs, state),
      blockedPrerequisites: blocked,
    };
  }

  const dtSeconds = inputs.dtUs / 1_000_000;

  // Pass 1 — compute, check refusal bound, emit nothing yet (atomicity).
  const perAxis = AXES.map((axis) => {
    // m/s^2 * s = m/s -> cm/s (x100). Accumulate in cm/s so the pulse
    // quantum is exactly 1 and quantization has no binary-representation
    // error of its own.
    const deltaVCmPerSecond = sf[axis] * dtSeconds * 100;
    const total = state.residualCmPerSecond[axis] + deltaVCmPerSecond;
    const pulses = Math.trunc(total);
    return {
      axis,
      deltaVCmPerSecond,
      pulses,
      residual: total - pulses,
    };
  });

  for (const a of perAxis) {
    if (Math.abs(a.pulses) > PIPA_UNSOURCED_MAX_PULSES_PER_AXIS_PER_TICK) {
      blocked.push({
        code: "sensor-range-invalid",
        detail: `PIPA ${a.axis} would need ${a.pulses} pulses in one tick, above the ${PIPA_UNSOURCED_MAX_PULSES_LABEL} of ${PIPA_UNSOURCED_MAX_PULSES_PER_AXIS_PER_TICK}. Refusing atomically; no partial pulse train is emitted.`,
        reference: PIPA_SCALE_CITATION,
      });
    }
  }
  if (blocked.length > 0) {
    return {
      nextState: state,
      actions: [],
      diagnostic: idleDiagnostic(inputs, state),
      blockedPrerequisites: blocked,
    };
  }

  // Pass 2 — commit.
  const actions: AgcSensorAction[] = [];
  const residualCmPerSecond: Record<PipaAxis, number> = { x: 0, y: 0, z: 0 };
  const cumulativePulses: Record<PipaAxis, number> = { x: 0, y: 0, z: 0 };
  const axesDiag: PipaAxisDiagnostic[] = [];

  perAxis.forEach((a, index) => {
    const incType = a.pulses === 0 ? null : a.pulses > 0 ? "PINC" : "MINC";
    residualCmPerSecond[a.axis] = a.residual;
    cumulativePulses[a.axis] = state.cumulativePulses[a.axis] + a.pulses;

    if (incType !== null) {
      actions.push({
        kind: "counter-pulses",
        counterAddress: PIPA_AXIS_ADDRESS[a.axis],
        incType,
        pulseCount: Math.abs(a.pulses),
        suborder: PIPA_SUBORDER_BASE + index,
        mappingId: `pipa.${a.axis}.delta-v-pulse`,
      });
    }

    axesDiag.push({
      axis: a.axis,
      counterAddress: PIPA_AXIS_ADDRESS[a.axis],
      specificForceMps2: sf[a.axis],
      deltaVCmPerSecond: a.deltaVCmPerSecond,
      pulseCount: Math.abs(a.pulses),
      incType,
      residualCmPerSecond: a.residual,
      residualMetersPerSecond:
        (a.residual * PIPA_METERS_PER_SECOND_PER_PULSE) /
        PIPA_CM_PER_SECOND_PER_PULSE,
      cumulativePulses: cumulativePulses[a.axis],
    });
  });

  return {
    nextState: {
      kind: "pipa-encoder-state-v1",
      residualCmPerSecond,
      cumulativePulses,
    },
    actions,
    diagnostic: {
      missionTimeUs: inputs.missionTimeUs,
      dtUs: inputs.dtUs,
      emitted: actions.length > 0,
      pipaHealthy: inputs.pipaHealthy,
      cmPerSecondPerPulse: PIPA_CM_PER_SECOND_PER_PULSE,
      scaleCitation: PIPA_SCALE_CITATION,
      axes: axesDiag,
    },
    blockedPrerequisites: [],
  };
}

/** Velocity, m/s, the AGC can reconstruct from a signed pulse total. */
export function pulsesToMetersPerSecond(pulses: number): number {
  return pulses * PIPA_METERS_PER_SECOND_PER_PULSE;
}
