// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3B2 — Pure landing-radar RANGE (altitude) observer encoder.
//
// PURE FUNCTION. No module-global mutable state, no WASM, no Worker, no
// trace arming. It converts a deterministic LM altitude into the serial
// RNRAD (0o46) transaction the HW-I/O v3 export
// `agc_landing_radar_update_apply` delivers, and reports the exact
// reconstruction residual the AGC will see.
//
// SCOPE — ALTITUDE (RANGE) ONLY.
//   * No velocity beams: `VZSCAL/VYSCAL/VXSCAL` are primary-sourced but the
//     beam-select / CHAN13 sequencing is NOT, so nothing is emitted for them.
//   * No PIPA: the ΔV pulse weight is unresolved at primary-document level
//     (docs/M3_3B2_SCALE_ARCHAEOLOGY.md §"Still UNRESOLVED", item 1), so this
//     module never produces PIPA pulses and `descent-monitor-v1` stays
//     blocked.
//   * Nothing here is control: the emitted word is an INPUT to Luminary099.
//     No decoded AGC output may reach the LM physics kernel.
//
// SCALE (primary, citable)
//   `Luminary099/CONTROLLED_CONSTANTS.agc` `HSCAL` — landing-radar range bit
//   weight 1.079 ft/bit; companion `RANGCONV 2DEC 2.859024 B-3`. See
//   docs/M3_3B2_SCALE_ARCHAEOLOGY.md.
//
// COUNTER WIDTH
//   RNRAD is a 14-bit shift counter in yaAGC (`CounterSHINC`/`CounterSHANC`
//   mask 0o37777, agc_engine.c:1292-1316). The authentic PSA transaction
//   shifts 15 serial bits; only the low 14 survive in the counter. The
//   encoder therefore refuses to emit any range count that does not fit in
//   14 bits rather than silently wrapping — the LOW-SCALE band is the only
//   band whose bit weight is source-proven here.

import type { MonitorBlockReason } from "./types";

/** `HSCAL`, Luminary099/CONTROLLED_CONSTANTS.agc — feet per RNRAD bit. */
export const LR_RANGE_FEET_PER_BIT = 1.079;

/** Exact international-foot conversion (0.3048 m/ft, exact by definition). */
export const METERS_PER_FOOT = 0.3048;

/** Metres per RNRAD bit, derived from HSCAL. */
export const LR_RANGE_METERS_PER_BIT = LR_RANGE_FEET_PER_BIT * METERS_PER_FOOT;

/** Serial bits shifted per authentic LR range transaction. */
export const LR_RANGE_SERIAL_BITS = 15;

/** RNRAD retains 14 bits (yaAGC SHINC/SHANC mask 0o37777). */
export const RNRAD_COUNTER_MASK = 0o37777;

/** Largest range count representable in the retained counter. */
export const LR_RANGE_MAX_COUNT = RNRAD_COUNTER_MASK;

/** RNRAD erasable address. */
export const RNRAD_ADDRESS = 0o46;

/**
 * Diagnostic emission cadence.
 *
 * NOT source-proven: the real LGC solicits each LR read from
 * `P20-P25.agc` READRADR/RADAREAD, and that solicitation sequence is NOT
 * modelled here. 250 ms is an explicitly-declared DIAGNOSTIC cadence,
 * reported as such in the UI, and is a multiple of the 20 ms mission tick
 * so emission stays tick-aligned and deterministic.
 */
export const LR_OBSERVER_CADENCE_US = 250_000;

export interface LandingRadarObserverState {
  readonly kind: "landing-radar-observer-state-v1";
  /** Mission time of the last emission, or null before the first. */
  readonly lastEmitMissionTimeUs: number | null;
  readonly emissionCount: number;
}

export function createLandingRadarObserverState(): LandingRadarObserverState {
  return {
    kind: "landing-radar-observer-state-v1",
    lastEmitMissionTimeUs: null,
    emissionCount: 0,
  };
}

/** One serial RNRAD transaction the Worker will hand to
 *  `agc_landing_radar_update_apply` verbatim. */
export interface RadarSerialWordAction {
  readonly kind: "radar-serial-word";
  readonly counterAddress: typeof RNRAD_ADDRESS;
  readonly word: number;
  readonly bitCount: typeof LR_RANGE_SERIAL_BITS;
  readonly raiseRadarupt: true;
  readonly suborder: number;
  readonly mappingId: "chan33.rnrad.lr-range-word";
}

/** Everything the panel needs to audit one observer tick. Physical values
 *  are RANGE only; nothing here is a velocity, a thrust or a percentage. */
export interface LandingRadarObserverDiagnostic {
  readonly missionTimeUs: number;
  readonly cadenceUs: number;
  readonly cadenceSourced: false;
  readonly altitudeMeters: number | null;
  readonly altitudeFeet: number | null;
  /** Target RNRAD count before saturation checks. */
  readonly targetCounterValue: number | null;
  /** Word actually shifted in this tick (null when nothing was emitted). */
  readonly emittedWord: number | null;
  readonly bitsEmitted: number;
  /** Altitude the AGC can reconstruct from the retained 14-bit counter. */
  readonly reconstructedAltitudeMeters: number | null;
  /** reconstructed − actual, metres. Pure quantization + saturation error. */
  readonly residualMeters: number | null;
  readonly emitted: boolean;
  readonly saturated: boolean;
  readonly rangeDataGood: boolean;
  readonly emissionCount: number;
  readonly feetPerBit: typeof LR_RANGE_FEET_PER_BIT;
  readonly scaleCitation: string;
}

export const LR_RANGE_SCALE_CITATION =
  "Luminary099/CONTROLLED_CONSTANTS.agc HSCAL (1.079 ft/bit); docs/M3_3B2_SCALE_ARCHAEOLOGY.md";

export interface LandingRadarObserverInputs {
  readonly missionTimeUs: number;
  /** Deterministic LM altitude, metres. `null` when no scenario is running. */
  readonly altitudeMeters: number | null;
  /** Operator-declared LR RANGE DATA GOOD discrete. The observer never
   *  invents acquisition: with the discrete unasserted nothing is sent. */
  readonly rangeDataGood: boolean;
}

export interface LandingRadarObserverResult {
  readonly nextState: LandingRadarObserverState;
  readonly action: RadarSerialWordAction | null;
  readonly diagnostic: LandingRadarObserverDiagnostic;
  readonly blockedPrerequisites: readonly MonitorBlockReason[];
}

function emptyDiagnostic(
  inputs: LandingRadarObserverInputs,
  state: LandingRadarObserverState,
  extra: Partial<LandingRadarObserverDiagnostic> = {},
): LandingRadarObserverDiagnostic {
  return {
    missionTimeUs: inputs.missionTimeUs,
    cadenceUs: LR_OBSERVER_CADENCE_US,
    cadenceSourced: false,
    altitudeMeters: inputs.altitudeMeters,
    altitudeFeet:
      inputs.altitudeMeters === null ? null : inputs.altitudeMeters / METERS_PER_FOOT,
    targetCounterValue: null,
    emittedWord: null,
    bitsEmitted: 0,
    reconstructedAltitudeMeters: null,
    residualMeters: null,
    emitted: false,
    saturated: false,
    rangeDataGood: inputs.rangeDataGood,
    emissionCount: state.emissionCount,
    feetPerBit: LR_RANGE_FEET_PER_BIT,
    scaleCitation: LR_RANGE_SCALE_CITATION,
    ...extra,
  };
}

/** Deterministic count for an altitude. Half-up rounding on a non-negative
 *  quantity; no floating-point mode dependence. */
export function altitudeToRangeCount(altitudeMeters: number): number {
  const feet = altitudeMeters / METERS_PER_FOOT;
  return Math.floor(feet / LR_RANGE_FEET_PER_BIT + 0.5);
}

export function rangeCountToAltitudeMeters(count: number): number {
  return count * LR_RANGE_METERS_PER_BIT;
}

/**
 * Encode at most ONE serial RNRAD range transaction for this mission tick.
 *
 * Emission requires all of: an altitude, the LR RANGE DATA GOOD discrete,
 * the cadence boundary, and a count that fits the retained 14-bit counter.
 * Any failure emits nothing at all — a partial or wrapped word is never
 * produced.
 */
export function encodeLandingRadarTick(
  state: LandingRadarObserverState,
  inputs: LandingRadarObserverInputs,
): LandingRadarObserverResult {
  const blocked: MonitorBlockReason[] = [];

  if (!Number.isInteger(inputs.missionTimeUs) || inputs.missionTimeUs < 0) {
    blocked.push({
      code: "sensor-range-invalid",
      detail: `missionTimeUs must be a non-negative integer (got ${inputs.missionTimeUs}).`,
    });
    return { nextState: state, action: null, diagnostic: emptyDiagnostic(inputs, state), blockedPrerequisites: blocked };
  }

  if (inputs.altitudeMeters === null) {
    return { nextState: state, action: null, diagnostic: emptyDiagnostic(inputs, state), blockedPrerequisites: [] };
  }

  if (!Number.isFinite(inputs.altitudeMeters) || inputs.altitudeMeters < 0) {
    blocked.push({
      code: "sensor-range-invalid",
      detail: `LM altitude must be finite and non-negative (got ${inputs.altitudeMeters}).`,
      reference: LR_RANGE_SCALE_CITATION,
    });
    return { nextState: state, action: null, diagnostic: emptyDiagnostic(inputs, state), blockedPrerequisites: blocked };
  }

  const targetCounterValue = altitudeToRangeCount(inputs.altitudeMeters);
  const saturated = targetCounterValue > LR_RANGE_MAX_COUNT;

  const due =
    state.lastEmitMissionTimeUs === null ||
    inputs.missionTimeUs - state.lastEmitMissionTimeUs >= LR_OBSERVER_CADENCE_US;

  if (!inputs.rangeDataGood || saturated || !due) {
    return {
      nextState: state,
      action: null,
      diagnostic: emptyDiagnostic(inputs, state, { targetCounterValue, saturated }),
      blockedPrerequisites: [],
    };
  }

  const word = targetCounterValue & RNRAD_COUNTER_MASK;
  const reconstructedAltitudeMeters = rangeCountToAltitudeMeters(word);

  const nextState: LandingRadarObserverState = {
    kind: "landing-radar-observer-state-v1",
    lastEmitMissionTimeUs: inputs.missionTimeUs,
    emissionCount: state.emissionCount + 1,
  };

  return {
    nextState,
    action: {
      kind: "radar-serial-word",
      counterAddress: RNRAD_ADDRESS,
      word,
      bitCount: LR_RANGE_SERIAL_BITS,
      raiseRadarupt: true,
      suborder: 100,
      mappingId: "chan33.rnrad.lr-range-word",
    },
    diagnostic: emptyDiagnostic(inputs, nextState, {
      targetCounterValue,
      emittedWord: word,
      bitsEmitted: LR_RANGE_SERIAL_BITS,
      reconstructedAltitudeMeters,
      residualMeters: reconstructedAltitudeMeters - inputs.altitudeMeters,
      emitted: true,
      saturated: false,
    }),
    blockedPrerequisites: [],
  };
}
