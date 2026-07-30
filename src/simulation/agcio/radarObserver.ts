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
 * NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE.
 *
 * Kept ONLY as a development/test fixture so the pure encoder can be
 * exercised deterministically. No production monitor profile may consult
 * it: the authentic landing-radar read is AGC-SOLICITED, never host-timed.
 *
 * Source (pinned Luminary099, chrislgarry/Apollo-11 @ 911e5c0):
 *   * `P20-P25.agc` INITREAD (p. 554) — the LGC clears the CHAN13 radar
 *     bits (`CS ALLREAD` / `WAND CHAN13`) and then writes the select +
 *     ACTIVITY bits (`WOR CHAN13`); the PSA answers by shifting the data
 *     serially into RNRAD and raising RADARUPT.
 *   * `P20-P25.agc` RADAREAD (p. 555) — the RADARUPT handler reads RNRAD
 *     and resets the ACTIVITY bit; one RADARUPT delivers ONE selected data
 *     word, chosen by CHAN13 bits 1-3.
 *   * `SERVICER.agc` LRHTASK (p. 872) — the altitude read is a WAITLIST
 *     task "set by READACCS during the descent braking phase when the ALT
 *     to the lunar surface is less than 25,000 FT ... 50 MS prior to the
 *     next READACCS task", i.e. phased to the PIPA-driven READACCS cycle.
 *   * `SERVICER.agc` LRHJOB (p. 892) — "about 95 MS" sampling window,
 *     "LRH DATA 1.079 FT/BIT".
 *
 * The cadence is therefore inseparable from READACCS/SERVICER, which is
 * driven by the PIPA read whose ΔV pulse weight is UNRESOLVED
 * (docs/M3_3B2_SCALE_ARCHAEOLOGY.md §"Still UNRESOLVED", item 1). A
 * host-side free-running timer would fabricate Apollo operation, so
 * `landing-radar-observer-v1` stays atomically blocked with
 * `radar-update-cadence-unresolved`.
 */
export const LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US = 250_000;

/** Verbatim label that MUST accompany any presentation of the fixture. */
export const LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_LABEL =
  "NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE";

/** Citations for the AGC-solicited transaction, recorded verbatim in
 *  docs/M3_3_IO_MAP.md. */
export const LR_RANGE_CADENCE_CITATIONS: readonly string[] = [
  "Luminary099/P20-P25.agc INITREAD (p.554) — CS ALLREAD / WAND CHAN13, then WOR CHAN13 select+ACTIVITY: the read is AGC-solicited.",
  "Luminary099/P20-P25.agc RADAREAD (p.555) — one RADARUPT delivers ONE data word selected by CHAN13 bits 1-3; handler resets ACTIVITY (BIT4).",
  "Luminary099/SERVICER.agc LRHTASK (p.872) — LR altitude read scheduled by READACCS, 50 ms before the next READACCS task, below 25,000 ft.",
  "Luminary099/SERVICER.agc LRHJOB (p.892) — sampling window ~95 ms; 'LRH DATA 1.079 FT/BIT'.",
  "Luminary099/SERVICER.agc LRVJOB (p.892) — velocity read is 5 samples, ~500 ms, beam-sequenced by VSELECT; not modelled.",
] as const;


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
  /**
   * Emission cadence, µs. REQUIRED and explicit — there is no default,
   * because no source-supported host-side cadence exists (the authentic
   * read is AGC-solicited via CHAN13; see LR_RANGE_CADENCE_CITATIONS).
   * Production profiles must not supply one; tests pass
   * `LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US`.
   */
  readonly cadenceUs: number;
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
    cadenceUs: inputs.cadenceUs,
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
    inputs.missionTimeUs - state.lastEmitMissionTimeUs >= inputs.cadenceUs;

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
