// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3E — SYNTHETIC AGC HARDWARE-INTERFACE LABORATORY (pure core).
//
//   SYNTHETIC AGC HARDWARE-INTERFACE LAB
//   NOT AN APOLLO 11 MISSION-STATE RECONSTRUCTION
//   NOT A COMPLETE P63 DESCENT
//
// PURE MODULE. No WASM, no Worker, no timers, no mutable module state.
//
// WHAT THIS IS
//   A deliberately synthetic plumbing milestone that exercises the AGC
//   hardware INPUT surfaces end to end:
//     * PIPA ΔV pulses (native PINC/MINC) derived from a declared,
//       source-scaled specific force resolved onto the stable member with
//       the proven fixed-attitude body→SM matrix;
//     * request-driven landing-radar ALTITUDE transactions: a genuine
//       Luminary-issued CHAN13 solicitation is the ONLY thing that can
//       produce an RNRAD serial word plus RADARUPT.
//
// WHAT THIS IS NOT
//   * Not an Apollo 11 mission state. No RN/VN, no historically authentic
//     P63 startup, no AVEGFLAG, no Average-G bootstrap.
//   * Not a descent monitor. `descent-monitor-v1` stays blocked.
//   * Not control. Nothing decoded from the AGC may reach LM physics.
//   * No repeating radar timer exists anywhere on this path: no
//     solicitation → no RNRAD → no RADARUPT.
//
// REPORTING CATEGORIES (never conflated — see `HardwareInterfaceLabDiagnostic`)
//   hardwareInputDelivered        host → AGC counter pulses actually applied
//   ropeInputConsumed             whether Luminary read them (see below)
//   syntheticRequestGenerated     CHAN13 request raised by a synthetic fixture
//   authenticMissionRequestGenerated
//                                 CHAN13 request raised by a complete,
//                                 historically authentic mission run — always
//                                 false in this milestone.
//
// Rope consumption: READACCS/SERVICER only drains PIPAX/Y/Z under Average-G
// (AVEGFLAG), which this milestone deliberately does not set. Where Luminary
// does not read the counters we report exactly that — "native PIPA input
// delivered; rope consumption not active in this scenario" — and claim
// nothing more.

import {
  LUMINARY099_FIXED_ATTITUDE_IMU_V1,
  stableMemberSpecificForceFromBody,
  type Vec3,
} from "./imuBootstrap";
import {
  createPipaEncoderState,
  encodePipaTick,
  type PipaEncoderDiagnostic,
  type PipaEncoderState,
} from "./pipaEncoder";
import {
  altitudeToRangeCount,
  rangeCountToAltitudeMeters,
  LR_RANGE_MAX_COUNT,
  LR_RANGE_SCALE_CITATION,
  LR_RANGE_SERIAL_BITS,
  RNRAD_ADDRESS,
  type RadarSerialWordAction,
} from "./radarObserver";
import {
  completeOutstandingRequest,
  createChan13ObserverState,
  observeChan13Write,
  type Chan13ObserverState,
  type Chan13RadarRequest,
  type Chan13Write,
} from "./chan13Requests";
import type { AgcSensorAction, MonitorBlockReason } from "./types";

/** The one profile this milestone activates. */
export const HARDWARE_INTERFACE_LAB_PROFILE = "agc-hardware-interface-lab-v1" as const;

/** Verbatim banner. UI and documentation MUST render these lines. */
export const HARDWARE_INTERFACE_LAB_BANNER: readonly string[] = [
  "SYNTHETIC HARDWARE-INTERFACE LAB",
  "PIPA AND LANDING-RADAR ALTITUDE TRANSACTIONS",
  "NOT A COMPLETE POWERED-DESCENT PROGRAM",
  "AGC OUTPUT IS DIAGNOSTIC ONLY",
] as const;

export const HARDWARE_INTERFACE_LAB_SCOPE_NOTICE =
  "SYNTHETIC AGC HARDWARE-INTERFACE LAB — NOT AN APOLLO 11 POWERED-DESCENT RECONSTRUCTION";

/** Reported verbatim whenever pulses were delivered but Luminary is not in a
 *  state that reads the PIPA counters. */
export const ROPE_CONSUMPTION_NOT_ACTIVE =
  "native PIPA input delivered; rope consumption not active in this scenario";

// ---------------------------------------------------------------------------
// Body specific force — scenario/manual force ÷ tick-start mass, NO gravity
// ---------------------------------------------------------------------------

/**
 * Specific force sensed by the accelerometers on the LM BODY axes.
 *
 * PIPAs are accelerometers: they sense NON-gravitational specific force
 * only, so lunar gravity is deliberately absent and free fall reads exactly
 * zero. The DPS thrust axis is body +X.
 *
 * Returns `null` (rather than a fabricated zero) when the inputs cannot
 * define a specific force at all.
 */
export function bodySpecificForceFromThrust(
  thrustNewtons: number,
  totalMassKg: number,
): Vec3 | null {
  if (!Number.isFinite(thrustNewtons) || !Number.isFinite(totalMassKg)) return null;
  if (totalMassKg <= 0) return null;
  return [thrustNewtons / totalMassKg, 0, 0];
}

/** Body → stable member with the proven fixed-attitude bootstrap matrix. */
export function labStableMemberSpecificForce(body: Vec3): Vec3 {
  return stableMemberSpecificForceFromBody(body, LUMINARY099_FIXED_ATTITUDE_IMU_V1);
}

// ---------------------------------------------------------------------------
// Lab state
// ---------------------------------------------------------------------------

export interface HardwareInterfaceLabState {
  readonly kind: "hardware-interface-lab-state-v1";
  readonly pipa: PipaEncoderState;
  readonly chan13: Chan13ObserverState;
  /** Counter pulses actually handed to the emulator. */
  readonly hardwareInputPulsesDelivered: number;
  /** CHAN13 solicitations observed from the running rope. */
  readonly chan13RequestsObserved: number;
  /** Solicitations answered with a serial RNRAD word + RADARUPT. */
  readonly radarResponsesDelivered: number;
  /** Solicitations explicitly refused (velocity / rendezvous / unassigned). */
  readonly radarResponsesRefused: number;
  /** Requests attributed to the test-only synthetic fixture. */
  readonly syntheticRequestsGenerated: number;
  /** Requests produced by a complete authentic mission run. Always 0 here. */
  readonly authenticMissionRequestsGenerated: number;
}

export function createHardwareInterfaceLabState(): HardwareInterfaceLabState {
  return {
    kind: "hardware-interface-lab-state-v1",
    pipa: createPipaEncoderState(),
    chan13: createChan13ObserverState(),
    hardwareInputPulsesDelivered: 0,
    chan13RequestsObserved: 0,
    radarResponsesDelivered: 0,
    radarResponsesRefused: 0,
    syntheticRequestsGenerated: 0,
    authenticMissionRequestsGenerated: 0,
  };
}

// ---------------------------------------------------------------------------
// Phase A — PIPA input (pure)
// ---------------------------------------------------------------------------

export interface LabPipaInputs {
  readonly missionTimeUs: number;
  readonly dtUs: number;
  /** Body-axis specific force, m/s². `null` = no scenario / not defined. */
  readonly bodySpecificForceMps2: Vec3 | null;
  /** Operator-declared accelerometer health. */
  readonly pipaHealthy: boolean;
}

export interface LabPipaResult {
  readonly nextState: HardwareInterfaceLabState;
  readonly actions: readonly AgcSensorAction[];
  readonly diagnostic: PipaEncoderDiagnostic;
  readonly stableMemberSpecificForceMps2: Vec3 | null;
  readonly blockedPrerequisites: readonly MonitorBlockReason[];
}

/** Encode one tick of PIPA ΔV. Atomic: any refusal emits nothing at all. */
export function labEncodePipa(
  state: HardwareInterfaceLabState,
  inputs: LabPipaInputs,
): LabPipaResult {
  const sm =
    inputs.bodySpecificForceMps2 === null
      ? null
      : labStableMemberSpecificForce(inputs.bodySpecificForceMps2);

  const result = encodePipaTick(state.pipa, {
    missionTimeUs: inputs.missionTimeUs,
    dtUs: inputs.dtUs,
    specificForceStableMemberMps2:
      sm === null ? null : { x: sm[0], y: sm[1], z: sm[2] },
    pipaHealthy: inputs.pipaHealthy,
  });

  return {
    nextState: { ...state, pipa: result.nextState },
    actions: result.actions,
    diagnostic: result.diagnostic,
    stableMemberSpecificForceMps2: sm,
    blockedPrerequisites: result.blockedPrerequisites,
  };
}

/** Record that `pulses` counter pulses were actually accepted by the AGC. */
export function labRecordDeliveredPulses(
  state: HardwareInterfaceLabState,
  pulses: number,
): HardwareInterfaceLabState {
  if (pulses <= 0) return state;
  return {
    ...state,
    hardwareInputPulsesDelivered: state.hardwareInputPulsesDelivered + pulses,
  };
}

// ---------------------------------------------------------------------------
// Phase B — CHAN13 solicitation → RNRAD altitude response (pure)
// ---------------------------------------------------------------------------

export type LabRadarRefusal =
  | "no-outstanding-request"
  | "selection-refused"
  | "altitude-unavailable"
  | "range-data-not-good"
  | "range-count-out-of-counter-width";

export interface LabRadarResponse {
  readonly action: RadarSerialWordAction;
  readonly answeredSequence: number;
  readonly targetCounterValue: number;
  readonly reconstructedAltitudeMeters: number;
  readonly residualMeters: number;
}

export interface LabChan13Inputs {
  readonly writes: readonly Chan13Write[];
  /** Deterministic scenario altitude, metres, or null. */
  readonly altitudeMeters: number | null;
  /** Operator-declared LR RANGE DATA GOOD. Never invented. */
  readonly rangeDataGood: boolean;
  /** True only for the clearly labelled test-only fixture path. */
  readonly syntheticFixture?: boolean;
}

export interface LabChan13Result {
  readonly nextState: HardwareInterfaceLabState;
  readonly requests: readonly Chan13RadarRequest[];
  /** At most ONE response per tick — one solicitation, one answer. */
  readonly response: LabRadarResponse | null;
  readonly refusals: readonly LabRadarRefusal[];
}

/**
 * Fold the ordered CHAN13 output writes of one AGC interval, then answer AT
 * MOST the single outstanding altitude solicitation.
 *
 * Invariants proven in tests:
 *   * no solicitation → no RNRAD → no RADARUPT;
 *   * a retained level is not a repeat request (INITREAD clear-then-set);
 *   * one request permits at most one response;
 *   * unsupported selections are refused and never answered;
 *   * a count wider than the 14-bit counter is refused, never wrapped.
 */
export function labObserveChan13(
  state: HardwareInterfaceLabState,
  inputs: LabChan13Inputs,
): LabChan13Result {
  let chan13 = state.chan13;
  const requests: Chan13RadarRequest[] = [];
  const refusals: LabRadarRefusal[] = [];
  let observed = 0;
  let refused = 0;
  let synthetic = 0;

  for (const write of inputs.writes) {
    const r = observeChan13Write(chan13, write);
    chan13 = r.nextState;
    if (r.request) {
      requests.push(r.request);
      observed += 1;
      if (inputs.syntheticFixture) synthetic += 1;
      if (r.request.refusal !== null) {
        refused += 1;
        refusals.push("selection-refused");
      }
    }
  }

  const outstanding = chan13.outstanding;
  let response: LabRadarResponse | null = null;

  if (outstanding !== null) {
    if (!inputs.rangeDataGood) {
      refusals.push("range-data-not-good");
    } else if (
      inputs.altitudeMeters === null ||
      !Number.isFinite(inputs.altitudeMeters) ||
      inputs.altitudeMeters < 0
    ) {
      refusals.push("altitude-unavailable");
    } else {
      const target = altitudeToRangeCount(inputs.altitudeMeters);
      if (target > LR_RANGE_MAX_COUNT) {
        refusals.push("range-count-out-of-counter-width");
      } else {
        const reconstructed = rangeCountToAltitudeMeters(target);
        response = {
          action: {
            kind: "radar-serial-word",
            counterAddress: RNRAD_ADDRESS,
            word: target,
            bitCount: LR_RANGE_SERIAL_BITS,
            raiseRadarupt: true,
            suborder: 100,
            mappingId: "chan33.rnrad.lr-range-word",
          },
          answeredSequence: outstanding.sequence,
          targetCounterValue: target,
          reconstructedAltitudeMeters: reconstructed,
          residualMeters: reconstructed - inputs.altitudeMeters,
        };
        chan13 = completeOutstandingRequest(chan13, outstanding.sequence);
      }
    }
  } else if (inputs.writes.length === 0) {
    refusals.push("no-outstanding-request");
  }

  // Every refusal EXCEPT the idle "nothing was asked" note is a genuine
  // refused transaction and is counted as such — a solicitation the host
  // could not answer must never look like silence.
  const refusedTotal =
    refused + refusals.filter((r) => r !== "selection-refused" && r !== "no-outstanding-request").length;

  return {
    nextState: {
      ...state,
      chan13,
      chan13RequestsObserved: state.chan13RequestsObserved + observed,
      radarResponsesRefused: state.radarResponsesRefused + refusedTotal,

      radarResponsesDelivered:
        state.radarResponsesDelivered + (response === null ? 0 : 1),
      syntheticRequestsGenerated: state.syntheticRequestsGenerated + synthetic,
      // Never incremented in this milestone: no authentic mission run exists.
      authenticMissionRequestsGenerated: state.authenticMissionRequestsGenerated,
    },
    requests,
    response,
    refusals,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface HardwareInterfaceLabDiagnostic {
  readonly kind: "hardware-interface-lab-diagnostic-v1";
  readonly banner: readonly string[];
  readonly scopeNotice: string;
  readonly missionTimeUs: number;
  /** Stable-member specific force actually encoded this tick. */
  readonly stableMemberSpecificForceMps2: readonly [number, number, number] | null;
  readonly pipa: PipaEncoderDiagnostic | null;
  // --- reporting categories, never conflated -------------------------------
  readonly hardwareInputDelivered: number;
  readonly ropeInputConsumed: false;
  readonly ropeConsumptionNote: string;
  readonly syntheticRequestGenerated: number;
  readonly authenticMissionRequestGenerated: 0;
  // --- radar ---------------------------------------------------------------
  readonly chan13RequestsObserved: number;
  readonly radarResponsesDelivered: number;
  readonly radarResponsesRefused: number;
  readonly lastRequest: Chan13RadarRequest | null;
  readonly lastResponse: LabRadarResponse | null;
  readonly lastRefusals: readonly LabRadarRefusal[];
  readonly rangeScaleCitation: string;
  /** Structural guarantee, asserted in tests. */
  readonly repeatingRadarTimerPresent: false;
}

export function labDiagnostic(
  state: HardwareInterfaceLabState,
  missionTimeUs: number,
  parts: {
    readonly pipa?: PipaEncoderDiagnostic | null;
    readonly stableMemberSpecificForceMps2?: Vec3 | null;
    readonly lastRequest?: Chan13RadarRequest | null;
    readonly lastResponse?: LabRadarResponse | null;
    readonly lastRefusals?: readonly LabRadarRefusal[];
  } = {},
): HardwareInterfaceLabDiagnostic {
  const sm = parts.stableMemberSpecificForceMps2 ?? null;
  return {
    kind: "hardware-interface-lab-diagnostic-v1",
    banner: HARDWARE_INTERFACE_LAB_BANNER,
    scopeNotice: HARDWARE_INTERFACE_LAB_SCOPE_NOTICE,
    missionTimeUs,
    stableMemberSpecificForceMps2: sm === null ? null : [sm[0], sm[1], sm[2]],
    pipa: parts.pipa ?? null,
    hardwareInputDelivered: state.hardwareInputPulsesDelivered,
    ropeInputConsumed: false,
    ropeConsumptionNote: ROPE_CONSUMPTION_NOT_ACTIVE,
    syntheticRequestGenerated: state.syntheticRequestsGenerated,
    authenticMissionRequestGenerated: 0,
    chan13RequestsObserved: state.chan13RequestsObserved,
    radarResponsesDelivered: state.radarResponsesDelivered,
    radarResponsesRefused: state.radarResponsesRefused,
    lastRequest: parts.lastRequest ?? null,
    lastResponse: parts.lastResponse ?? null,
    lastRefusals: parts.lastRefusals ?? [],
    rangeScaleCitation: LR_RANGE_SCALE_CITATION,
    repeatingRadarTimerPresent: false,
  };
}
