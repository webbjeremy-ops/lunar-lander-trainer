// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.b — Pure discrete sensor encoder for discrete-observer-v0.
//
// PURE FUNCTION. No module-global mutable state. Does not touch the Worker,
// the AGC WASM, or the extension trace. Emits only source-mapped
// `channel-mask-update` actions with owned bits from
// `MONITOR_SIGNAL_REGISTRY`. No counter-pulses; LR/PIPA/CDU pulse
// production is blocked in P5.b.
//
// Consumers merge each emitted action into their authoritative input-
// channel shadow using `applyChannelMaskUpdate` — unrelated bits (e.g.
// PROCEED on CHAN32) survive bit-identically.

import {
  MONITOR_SIGNAL_REGISTRY,
  mappedSignalsForProfile,
  type MonitorSignalMapping,
} from "./sensorRegistry";
import type {
  AgcMonitorProfile,
  AgcSensorAction,
  ChannelMaskUpdateAction,
  EncodedSensorDiagnostics,
  MonitorBlockReason,
} from "./types";
import { AGC_MONITOR_PROFILE_LABELS } from "./types";

// ---------------------------------------------------------------------------
// Explicit avionics input state
// ---------------------------------------------------------------------------

export type LandingRadarStatus =
  | "not-acquired"
  | "acquired-valid"
  | "invalid";

/**
 * Immutable snapshot of every LM discrete the encoder consumes. Every field
 * MUST be supplied explicitly by the caller. Missing values are NOT
 * defaulted to a flight-ready condition — the encoder rejects an
 * incomplete state (see `encodeDiscreteSensorTick`).
 *
 * Fields are expressed in OPERATOR terms (healthy / enabled / acquired).
 * The registry row decides how each maps onto the raw Luminary signal name
 * and its bus polarity; channels 30-33 are wholly inverted per
 * `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:143-144`.
 *
 * `landingRadarStatus` names match Luminary LR data-good semantics:
 *   - "not-acquired" → RANGE_GOOD/VEL_GOOD both unasserted
 *   - "acquired-valid" → both asserted (only permitted when the caller has
 *     actually modeled radar acquisition)
 *   - "invalid" → radar powered but data not good
 */
export interface LmDiscreteSensorState {
  readonly engineArmed: boolean;
  readonly autoThrottleEnabled: boolean;
  readonly lgcInControl: boolean;
  readonly issOperate: boolean;
  readonly imuHealthy: boolean;
  /** ISS/IMU CDU health — drives CHAN30 bit 12 (IMU CDU FAIL). */
  readonly imuCduHealthy: boolean;
  /** Accelerometer health — drives CHAN33 bit 13 (PIPA FAIL). */
  readonly pipaHealthy: boolean;
  readonly landingRadarStatus: LandingRadarStatus;
  /** Antenna position discrete. `"transit"` = neither POS1 nor POS2. */
  readonly landingRadarAntenna: "pos1" | "pos2" | "transit";
  /** CHAN33 bit 9 — LR RANGE LOW SCALE. */
  readonly landingRadarRangeLowScale: boolean;
}


// ---------------------------------------------------------------------------
// Encoder state
// ---------------------------------------------------------------------------

export interface DiscreteEncoderState {
  readonly kind: "discrete-encoder-state-v0";
  readonly profile: AgcMonitorProfile;
  /** Whether the initial full-owned-bit emission has occurred yet. */
  readonly initialized: boolean;
  /** Last logical-level snapshot keyed by mappingId. Used to detect
   *  transitions so unchanged state emits no redundant actions. */
  readonly lastLogicalLevels: { readonly [mappingId: string]: boolean };
}

export function createDiscreteEncoderState(
  profile: AgcMonitorProfile,
): DiscreteEncoderState {
  return {
    kind: "discrete-encoder-state-v0",
    profile,
    initialized: false,
    lastLogicalLevels: {},
  };
}

// ---------------------------------------------------------------------------
// Encoder diagnostics
// ---------------------------------------------------------------------------

export interface DiscreteSignalDiagnostic {
  readonly mappingId: string;
  readonly channelOctal: string;
  readonly ownedMaskOctal: string;
  readonly logicalValue: boolean;
  readonly encodedOwnedBits: number;
  readonly polarity: "active-high" | "active-low";
  readonly actionEmitted: boolean;
  readonly missionTimeUs: number;
  readonly profileLabel: string;
}

export interface DiscreteEncoderResult {
  readonly nextState: DiscreteEncoderState;
  readonly actions: readonly AgcSensorAction[];
  readonly diagnostics: EncodedSensorDiagnostics;
  readonly signalDiagnostics: readonly DiscreteSignalDiagnostic[];
  readonly blockedPrerequisites: readonly MonitorBlockReason[];
}

// ---------------------------------------------------------------------------
// Signal-present extraction
//
// Each function below returns "is the RAW Luminary signal named by this
// registry row PRESENT?". Bus polarity is applied afterwards, exactly once,
// by `encodeOwnedBits`. Pre-M3.3B this layer returned an operator-level
// boolean ("imu healthy") for a row named after the failure signal ("IMU
// FAIL"), which double-inverted CHAN30 bit 13.
// ---------------------------------------------------------------------------

function signalPresentFor(
  mappingId: string,
  s: LmDiscreteSensorState,
): boolean {
  switch (mappingId) {
    case "chan30.bit03.engine-armed":
      return s.engineArmed;
    case "chan30.bit05.auto-throttle":
      return s.autoThrottleEnabled;
    case "chan30.bit09.iss-operate":
      // "IMU OPERATE WITH NO MALFUNCTION" — present only when the ISS is in
      // OPERATE *and* the IMU is not failed.
      return s.issOperate && s.imuHealthy;
    case "chan30.bit10.lgc-in-control":
      return s.lgcInControl;
    case "chan30.bit12.imu-cdu-fail":
      return !s.imuCduHealthy;
    case "chan30.bit13.imu-fail":
      return !s.imuHealthy;
    case "chan33.bit05.lr-range-good":
      return s.landingRadarStatus === "acquired-valid";
    case "chan33.bit06.lr-pos1":
      return s.landingRadarAntenna === "pos1";
    case "chan33.bit07.lr-pos2":
      return s.landingRadarAntenna === "pos2";
    case "chan33.bit08.lr-velocity-good":
      return s.landingRadarStatus === "acquired-valid";
    case "chan33.bit09.lr-range-low-scale":
      return s.landingRadarRangeLowScale;
    case "chan33.bit13.pipa-fail":
      return !s.pipaHealthy;
    default:
      throw new Error(`unknown mappingId ${mappingId}`);
  }
}

/** Apply bus polarity exactly once. `signalPresent` is the raw Luminary
 *  signal level; channels 30-33 encode "present" as bit = 0. */
function encodeOwnedBits(m: MonitorSignalMapping, signalPresent: boolean): number {
  const busHigh = m.polarity === "active-high" ? signalPresent : !signalPresent;
  return busHigh ? m.mask : 0;
}


// ---------------------------------------------------------------------------
// Pure encode
// ---------------------------------------------------------------------------

/**
 * Encode one mission tick of discrete inputs for a monitor profile.
 * Deterministic; no side effects.
 *
 * Initial entry emits one action per mapped signal covering the complete
 * owned-bit state. Subsequent ticks emit actions only for signals whose
 * logical level changed. Suborder is derived from the registry declaration
 * order so identical inputs produce identical action sequences.
 */
export function encodeDiscreteSensorTick(
  encoderState: Readonly<DiscreteEncoderState>,
  avionics: Readonly<LmDiscreteSensorState>,
  missionTimeUs: number,
): DiscreteEncoderResult {
  const profile = encoderState.profile;
  const label = AGC_MONITOR_PROFILE_LABELS[profile].title;

  if (profile === "off") {
    return {
      nextState: encoderState,
      actions: [],
      diagnostics: {
        missionTimeUs,
        channelMaskUpdateCount: 0,
        counterPulseCount: 0,
        perCounter: [],
      },
      signalDiagnostics: [],
      blockedPrerequisites: [],
    };
  }

  // Guard against silently-missing avionics fields (e.g. plain-object
  // callers that omitted a key). `undefined` MUST NOT be coerced to a
  // flight-ready condition.
  const missing: string[] = [];
  const requiredKeys: readonly (keyof LmDiscreteSensorState)[] = [
    "engineArmed",
    "autoThrottleEnabled",
    "lgcInControl",
    "issOperate",
    "imuHealthy",
    "imuCduHealthy",
    "pipaHealthy",
    "landingRadarStatus",
    "landingRadarAntenna",
    "landingRadarRangeLowScale",
  ];

  for (const k of requiredKeys) {
    if (avionics[k] === undefined) missing.push(k);
  }
  const blockedPrerequisites: MonitorBlockReason[] = [];
  if (missing.length > 0) {
    blockedPrerequisites.push({
      code: "prerequisite-missing",
      detail: `LmDiscreteSensorState missing required fields: ${missing.join(", ")}`,
    });
    return {
      nextState: encoderState,
      actions: [],
      diagnostics: {
        missionTimeUs,
        channelMaskUpdateCount: 0,
        counterPulseCount: 0,
        perCounter: [],
      },
      signalDiagnostics: [],
      blockedPrerequisites,
    };
  }
  if (
    avionics.landingRadarStatus !== "not-acquired" &&
    avionics.landingRadarStatus !== "acquired-valid" &&
    avionics.landingRadarStatus !== "invalid"
  ) {
    blockedPrerequisites.push({
      code: "sensor-range-invalid",
      detail: `landingRadarStatus ${String(avionics.landingRadarStatus)} is not a recognized state`,
    });
    return {
      nextState: encoderState,
      actions: [],
      diagnostics: {
        missionTimeUs,
        channelMaskUpdateCount: 0,
        counterPulseCount: 0,
        perCounter: [],
      },
      signalDiagnostics: [],
      blockedPrerequisites,
    };
  }

  const mapped = mappedSignalsForProfile(profile);

  const actions: ChannelMaskUpdateAction[] = [];
  const signalDiagnostics: DiscreteSignalDiagnostic[] = [];
  const nextLevels: Record<string, boolean> = {};

  let suborder = 0;
  for (const m of mapped) {
    const logical = signalPresentFor(m.id, avionics);
    nextLevels[m.id] = logical;
    const encoded = encodeOwnedBits(m, logical);
    const prev = encoderState.lastLogicalLevels[m.id];
    const changed = prev === undefined || prev !== logical;

    const shouldEmit = !encoderState.initialized || changed;

    if (shouldEmit) {
      const action: ChannelMaskUpdateAction = {
        kind: "channel-mask-update",
        channel: m.channel,
        mask: m.mask,
        value: encoded,
        suborder,
        mappingId: m.id,
      };
      // Invariant sanity: (value & ~mask) === 0.
      if ((action.value & ~action.mask) !== 0) {
        throw new Error(
          `encoder invariant violated: value 0o${action.value.toString(8)} has bits outside mask 0o${action.mask.toString(8)} for ${m.id}`,
        );
      }
      actions.push(action);
      suborder += 1;
    }

    signalDiagnostics.push({
      mappingId: m.id,
      channelOctal: `0o${m.channel.toString(8)}`,
      ownedMaskOctal: `0o${m.mask.toString(8)}`,
      logicalValue: logical,
      encodedOwnedBits: encoded,
      polarity: m.polarity,
      actionEmitted: shouldEmit,
      missionTimeUs,
      profileLabel: label,
    });
  }

  const nextState: DiscreteEncoderState = {
    kind: "discrete-encoder-state-v0",
    profile,
    initialized: true,
    lastLogicalLevels: nextLevels,
  };

  return {
    nextState,
    actions,
    diagnostics: {
      missionTimeUs,
      channelMaskUpdateCount: actions.length,
      counterPulseCount: 0,
      perCounter: [],
    },
    signalDiagnostics,
    blockedPrerequisites,
  };
}

// ---------------------------------------------------------------------------
// Pure merge helper — mirrors the future Worker's authoritative-shadow merge
// ---------------------------------------------------------------------------

const MAX_CHANNEL_WORD = 0o77777;

/**
 * Apply one owned-bit update to a current channel word. Pure. This is the
 * exact merge the Worker will perform against its authoritative input
 * shadow: unrelated bits (e.g. PROCEED on CHAN32) are preserved bit-
 * identically. `value & ~mask === 0` is a precondition — the encoder
 * guarantees it; this helper double-checks.
 */
export function applyChannelMaskUpdate(
  currentWord: number,
  action: ChannelMaskUpdateAction,
): number {
  if ((currentWord & ~MAX_CHANNEL_WORD) !== 0 || currentWord < 0) {
    throw new Error(
      `applyChannelMaskUpdate: currentWord 0o${currentWord.toString(8)} outside 15-bit AGC channel range`,
    );
  }
  if ((action.mask & ~MAX_CHANNEL_WORD) !== 0) {
    throw new Error(
      `applyChannelMaskUpdate: mask 0o${action.mask.toString(8)} outside 15-bit AGC channel range`,
    );
  }
  if ((action.value & ~action.mask) !== 0) {
    throw new Error(
      `applyChannelMaskUpdate: value 0o${action.value.toString(8)} has bits outside mask 0o${action.mask.toString(8)}`,
    );
  }
  return (currentWord & ~action.mask) | (action.value & action.mask);
}

// ---------------------------------------------------------------------------
// Registry-derived summary (used by decideMonitorEntry gate)
// ---------------------------------------------------------------------------

/** Every mapping id known to the encoder — for cross-checks against the
 *  registry and against `logicalLevelFor`. */
export const ENCODER_KNOWN_MAPPING_IDS: readonly string[] = MONITOR_SIGNAL_REGISTRY
  .filter((m) => m.status === "mapped")
  .map((m) => m.id);
