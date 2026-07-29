// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.a — AGC I/O monitor-mode types.
//
// TYPES ONLY. Nothing in this file mutates worker state, arms tracing, or
// activates the extended simulation protocol. Everything here is either
// consumed by the pure profileValidation module (P5.a) or reserved for the
// P5.d Worker integration that has not yet landed.
//
// Compatibility contract:
//   - The frozen M2 AGC protocol (`src/agc/protocol.ts` — `ReadyPayload`,
//     `AgcExtensionReadyMessage`, `AgcEvent`, event-log export schema) is
//     NOT touched by this module.
//   - The active simulation protocol (`src/agc/simulationProtocol.ts`
//     `SIMULATION_PROTOCOL_VERSION === 1`) is NOT bumped by this module.
//     The v2-shape types below are declared for P5.d's future handshake and
//     are not yet transmitted on the wire, not yet advertised in
//     `sim:ready`, and not yet accepted by the Worker's dispatcher.

// ---------------------------------------------------------------------------
// Monitor profile identity
// ---------------------------------------------------------------------------

/**
 * The AGC ⇄ LM monitor profiles the Worker knows about.
 *
 *  - `off` (default): no sensor injection, no output-trace arming, no
 *    diagnostic actuator decoding. Bit-identical to frozen M3.2.
 *
 *  - `discrete-observer-v0`: DIAGNOSTIC INTERFACE ONLY.
 *      DISCRETE INTERFACE DIAGNOSTIC ONLY
 *      NOT A POWERED-DESCENT MONITOR
 *    Injects only the source-mapped steady-state discretes from
 *    `docs/M3_3_IO_MAP.md` whose status is `mapped` (CHAN30 engine-armed /
 *    auto-throttle / LGC-in-control / ISS operate / IMU health, CHAN33 LR
 *    status bits — the discretes only, not the range/velocity word) and
 *    latches the lossless CHAN11/CHAN14 discretes plus THRUST output-counter
 *    trace for diagnostic display. It MUST NOT be described as, exported as,
 *    or otherwise treated as a descent monitor: the LR range/velocity word
 *    path and PIPA increments remain `unresolved` per M3.3A1, so Luminary099
 *    will not receive the sensor stream a real powered descent requires.
 *
 *  - `descent-monitor-v1`: the authentic powered-descent monitor. Requires
 *    every LR/PIPA mapping in `docs/M3_3_IO_MAP.md` to be resolved. Until
 *    those mappings land the profile MUST return `monitorBlocked` from the
 *    validator with the corresponding unresolved-source reasons; no partial
 *    activation is permitted.
 */
export type AgcMonitorProfile = "off" | "discrete-observer-v0" | "descent-monitor-v1";

/** Human-readable, agent-safe labels. Consumers rendering profile state MUST
 *  use these labels verbatim so the diagnostic-only nature of v0 stays
 *  visible. */
export const AGC_MONITOR_PROFILE_LABELS: {
  readonly [K in AgcMonitorProfile]: {
    readonly title: string;
    readonly banner: string | null;
    readonly description: string;
  };
} = {
  off: {
    title: "Monitor off",
    banner: null,
    description:
      "No sensor injection, no output-trace arming, no actuator decoding. Bit-identical to frozen M3.2.",
  },
  "discrete-observer-v0": {
    title: "Discrete interface diagnostic",
    banner: "DISCRETE INTERFACE DIAGNOSTIC ONLY — NOT A POWERED-DESCENT MONITOR",
    description:
      "Injects only source-mapped steady-state discretes (CHAN30/CHAN33) and observes CHAN11/CHAN14 discretes and the THRUST output-counter trace. Not a substitute for LR/PIPA sensing.",
  },
  "descent-monitor-v1": {
    title: "Descent monitor v1",
    banner: "AGC MONITOR ONLY — COMMAND NOT APPLIED TO SPACECRAFT",
    description:
      "Authentic Luminary099 powered-descent monitor. Blocked until every LR range/velocity and PIPA mapping in docs/M3_3_IO_MAP.md is resolved.",
  },
} as const;

// ---------------------------------------------------------------------------
// Block reasons — atomic validator output
// ---------------------------------------------------------------------------

export type MonitorBlockReasonCode =
  | "profile-unknown"
  | "canonical-hwio-missing"
  | "canonical-hwio-wrong-version"
  | "rope-not-luminary099"
  | "agc-not-ready"
  | "simulation-epoch-mismatch"
  | "agc-epoch-mismatch"
  | "no-active-scenario"
  | "scenario-not-compatible"
  | "unresolved-sensor-mapping"
  | "sensor-range-invalid"
  | "prerequisite-missing"
  | "trace-already-enabled"
  | "cdu-drain-budget-unproven";

export interface MonitorBlockReason {
  readonly code: MonitorBlockReasonCode;
  readonly detail: string;
  /** Optional source-map reference (e.g. `docs/M3_3_IO_MAP.md#row-1`). */
  readonly reference?: string;
}

// ---------------------------------------------------------------------------
// AGC hardware-input primitives
// ---------------------------------------------------------------------------

/**
 * yaAGC-ext HW-I/O v2 unprogrammed-increment types. Values MUST match the
 * `AgcIncType` enum in `third-party/virtualagc-fork/PATCHES/lovable-hwio/
 * hwio.c` verbatim (see `docs/M3_3A2_P2.md`); they are exchanged with the
 * WASM as u16 tags in the batched hardware-input path.
 *
 * NB: values are exposed verbatim — no normalization or collapsing of
 * opposing pulses is permitted before they reach `agc_hw_input_apply`.
 */
export type AgcIncrementType =
  | "PINC"
  | "MINC"
  | "PCDU"
  | "MCDU"
  | "DINC"
  | "PYJK";

/** A single ordered unprogrammed-counter action queued for a mission tick.
 *  Only the P5.d Worker will produce these; the pure P5.b encoder emits an
 *  `AgcSensorAction` union whose `counter-pulses` variant is transcribed
 *  into one or more of these records. */
export interface AgcHwInputRecord {
  readonly counterAddress: number;
  readonly incType: AgcIncrementType;
}

// ---------------------------------------------------------------------------
// Pure sensor-encoder contract (types defined here; encoder lands in P5.b)
// ---------------------------------------------------------------------------

/**
 * Ordered hardware-action stream emitted by the pure sensor encoder.
 *
 * Channel packet writes and counter pulses are DISTINCT bus events on the
 * physical AGC hardware and MUST remain distinct here. `suborder` preserves
 * the encoder's intended intra-tick sequence across both kinds so the
 * Worker can dispatch channel writes through the frozen packet-input path
 * and counter pulses through `agc_hw_input_apply` without relabelling one
 * as the other. Opposing pulses (PINC/MINC, PCDU/MCDU) MUST NOT be
 * collapsed prior to reaching the emulator.
 *
 * Note on ordering approximation: within a single mission tick the
 * emulator sees channel packets at the beginning of the AGC advance and
 * unprogrammed-increment counter updates interleaved with subsequent
 * instructions. When the encoder emits both kinds for the same tick, the
 * `suborder` sequence expresses ENCODER intent; the Worker documents any
 * approximation it introduces when translating that into the WASM's
 * available dispatch surface.
 */
export type AgcSensorAction =
  | {
      readonly kind: "channel-mask-update";
      readonly channel: number;
      /** Bits owned by the emitting profile. `value & ~mask === 0` is
       *  invariant; the future Worker merges via
       *  `(current & ~mask) | (value & mask)` so unrelated bits (e.g.
       *  PROCEED on CHAN32) are preserved bit-identically. */
      readonly mask: number;
      readonly value: number;
      readonly suborder: number;
      readonly mappingId: string;
    }
  | {
      readonly kind: "counter-pulses";
      readonly counterAddress: number;
      readonly incType: AgcIncrementType;
      readonly pulseCount: number;
      readonly suborder: number;
      readonly mappingId: string;
    };

/** Narrowed view of the owned-bit-update variant used by the future Worker
 *  merge helper (`applyChannelMaskUpdate`). */
export type ChannelMaskUpdateAction = Extract<
  AgcSensorAction,
  { kind: "channel-mask-update" }
>;

/** Per-tick sensor diagnostics returned by the encoder for the harness /
 *  monitor snapshot. Kept compact; large traces live in the retrievable
 *  monitor-trace ring, not in every snapshot. */
export interface EncodedSensorDiagnostics {
  readonly missionTimeUs: number;
  readonly channelWriteCount: number;
  readonly counterPulseCount: number;
  readonly perCounter: readonly {
    readonly counterAddress: number;
    readonly incType: AgcIncrementType;
    readonly pulseCount: number;
    /** Deterministic quantization residual carried into `nextState`. */
    readonly residual: number;
  }[];
}

/** Opaque encoder state. Concrete shape is defined by the P5.b encoder;
 *  P5.a only reserves the type so downstream types can name it. */
export interface SensorEncoderState {
  readonly kind: "sensor-encoder-state-v0";
  readonly residuals: { readonly [key: string]: number };
}

export interface SensorEncoderResult {
  readonly nextState: SensorEncoderState;
  readonly actions: readonly AgcSensorAction[];
  readonly diagnostics: EncodedSensorDiagnostics;
  readonly blockedPrerequisites: readonly MonitorBlockReason[];
}

// ---------------------------------------------------------------------------
// Actuator decoder output (types only; reducer lands in P5.c)
// ---------------------------------------------------------------------------

export interface RawTraceSummary {
  readonly counterAddress: number;
  readonly incType: AgcIncrementType;
  readonly pulseCount: number;
  readonly firstMissionTick: number;
  readonly lastMissionTick: number;
}

/** Decoded AGC-commanded control. DIAGNOSTIC ONLY. This value is intended
 *  to be displayed and logged; it MUST NOT reach `stepLmPhysics()`. The
 *  compile-time boundary lives in `src/simulation/runtime/physicsControl`.
 *
 *  Absent or invalid commands MUST NOT be coerced to `{throttleFraction: 0,
 *  engineEnabled: false, valid: true}` — set `valid: false` and populate
 *  `invalidReasons`.
 */
export interface AgcCommandedControl {
  readonly engineEnabled: boolean;
  readonly throttleFraction: number | null;
  readonly valid: boolean;
  readonly invalidReasons: readonly string[];
  readonly sampledAtMissionTick: number;
  readonly raw: {
    readonly thrustCounterEvents: readonly RawTraceSummary[];
    readonly channel11: number | null;
    readonly channel14: number | null;
  };
}

// ---------------------------------------------------------------------------
// Monitor snapshot (compact — trace ring is retrieved separately in P5.d)
// ---------------------------------------------------------------------------

export type AgcMonitorStatus = "off" | "active" | "interlocked" | "blocked";

export interface AgcMonitorSnapshot {
  readonly profile: AgcMonitorProfile;
  readonly status: AgcMonitorStatus;
  readonly sampledAtMissionTick: number;
  readonly sensors: EncodedSensorDiagnostics | null;
  readonly commandedControl: AgcCommandedControl | null;
  readonly traceEnabled: boolean;
  readonly traceCount: number;
  readonly traceDropped: number;
  readonly blockReasons: readonly MonitorBlockReason[];
}

// ---------------------------------------------------------------------------
// Simulation protocol v2 — RESERVED, NOT ACTIVATED
// ---------------------------------------------------------------------------
//
// These types describe the shape the sim: namespace will take once P5.d
// implements the Worker/client behavior. Until then:
//   - `SIMULATION_PROTOCOL_VERSION` in `src/agc/simulationProtocol.ts`
//     stays at 1.
//   - `sim:ready` continues to advertise `simulationProtocolVersion: 1`.
//   - The Worker MUST NOT dispatch on `sim:set-monitor-profile`,
//     `sim:monitor-blocked`, `sim:request-monitor-trace`, or
//     `sim:monitor-trace`.
//
// Enabling any of the below is a P5.d concern, not P5.a.

export const RESERVED_SIMULATION_PROTOCOL_VERSION_V2 = 2 as const;

/** Additive-only augmentation of the v1 sim:ready payload. When v2 lands
 *  the additive fields below join the existing payload — no v1 field is
 *  renamed or removed. */
export interface ReservedSimReadyPayloadV2Augmentation {
  readonly simulationProtocolVersion: typeof RESERVED_SIMULATION_PROTOCOL_VERSION_V2;
  /** Static list of profile identifiers the Worker will accept. Mutable
   *  monitor state does NOT live on sim:ready; it lives on mission
   *  snapshots (`AgcMonitorSnapshot`). */
  readonly supportedMonitorProfiles: readonly AgcMonitorProfile[];
}

export interface ReservedSetMonitorProfileCommand {
  readonly type: "sim:set-monitor-profile";
  readonly commandId: number;
  readonly simulationEpoch: number;
  /** Mission-time tick boundary at which the profile change applies. Same
   *  epoch/cursor validation rules as `MissionCommandBase`. */
  readonly applyAtMissionTimeUs: number;
  readonly profile: AgcMonitorProfile;
}

export interface ReservedMonitorBlockedEvent {
  readonly type: "sim:monitor-blocked";
  readonly commandId: number;
  readonly simulationEpoch: number;
  readonly requestedProfile: AgcMonitorProfile;
  readonly reasons: readonly MonitorBlockReason[];
}

export interface ReservedRequestMonitorTraceCommand {
  readonly type: "sim:request-monitor-trace";
  readonly requestId: number;
  readonly simulationEpoch: number;
}

export interface ReservedMonitorTraceEvent {
  readonly type: "sim:monitor-trace";
  readonly requestId: number;
  readonly simulationEpoch: number;
  readonly retainedRange: {
    readonly firstMissionTick: number;
    readonly lastMissionTick: number;
  } | null;
  readonly droppedCount: number;
  /** Deterministic ordering: entries are yielded in
   *  (missionTick, suborder, counterAddress, incType) order. */
  readonly events: readonly {
    readonly missionTick: number;
    readonly suborder: number;
    readonly counterAddress: number;
    readonly incType: AgcIncrementType;
    readonly pulseCount: number;
  }[];
}
