// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.d — Worker-owned monitor runtime state machine.
//
// This class holds ALL authoritative monitor state. React never owns any of
// it; the main thread only receives compact snapshots and, on request, a
// window of the retained diagnostic ring.
//
// It is deliberately host-agnostic: every emulator interaction goes through
// the injected `MonitorHwPort`, so the whole lifecycle (entry validation,
// trace arming, sensor injection, output observation, disarm) is unit
// testable without instantiating WebAssembly.
//
// SAFETY CONTRACT (P5): nothing in this file may reach the LM physics
// kernel. `AgcCommandedControl` produced here is diagnostic output only;
// the compile-time boundary lives in `src/simulation/runtime/physicsControl`.

import {
  createDiscreteEncoderState,
  encodeDiscreteSensorTick,
  type DiscreteEncoderState,
  type DiscreteSignalDiagnostic,
  type LmDiscreteSensorState,
} from "./discreteEncoder";
import {
  INITIAL_ACTUATOR_DECODER_STATE,
  reduceAgcActuatorTick,
  type AgcActuatorDecoderState,
} from "./actuatorDecoder";
import {
  EXPECTED_ACTUATOR_CHANNELS,
  validateActuatorRegistry,
} from "./actuatorRegistry";
import { mappedSignalsForProfile, validateRegistry } from "./sensorRegistry";
import { decideMonitorEntry, type MonitorEntryContext } from "./profileValidation";
import { AgcInputChannelShadow } from "./inputShadow";
import { MonitorTraceRing, type MonitorTraceWindow } from "./monitorTrace";
import {
  HARDWARE_INTERFACE_LAB_PROFILE,
  createHardwareInterfaceLabState,
  labDiagnostic,
  labEncodePipa,
  labCommitRadarResponse,
  labObserveChan13,
  labRejectRadarResponse,
  labRecordDeliveredPulses,
  type HardwareInterfaceLabDiagnostic,
  type HardwareInterfaceLabState,
  type LabRadarRefusal,
  type LabRadarResponse,
} from "./hardwareInterfaceLab";
import type { Chan13RadarRequest, Chan13Write } from "./chan13Requests";
import type { Vec3 } from "./imuBootstrap";
import type {
  AgcCommandedControl,
  AgcMonitorProfile,
  AgcMonitorSnapshot,
  AgcMonitorStatus,
  AgcOutputChannelEvent,
  AgcOutputCounterEvent,
  AgcSensorAction,
  ChannelMaskUpdateAction,
  EncodedSensorDiagnostics,
  MonitorBlockReason,
  MonitorInputChannelView,
  ThrustCounterDiagnostic,
} from "./types";


/** Input channels any monitor profile may own (CHAN 030 / 033). */
export const MONITOR_OWNED_INPUT_CHANNELS: readonly number[] = [0o30, 0o33];

/** Every emulator touchpoint the monitor needs. Implemented in the Worker
 *  by a thin wrapper over `AgcCoreAdapter`. */
export interface MonitorHwPort {
  /** HW-I/O v3 reported by the running WASM (0 when absent). */
  hwioVersion(): number;
  traceEnabled(): boolean;
  setTraceEnabled(enabled: boolean): void;
  resetTrace(): void;
  /** WASM-layer dropped count (ring overflow inside the emulator). */
  traceDropped(): number;
  /** Entries currently pending in the WASM ring (best effort; the ABI
   *  exposes only dropped + drain, so the port reports what it drained). */
  drainTrace(): readonly AgcOutputCounterEvent[];
  /** Transmit a COMPLETE input-channel word through the frozen
   *  `packet_write` path. */
  writeInputChannel(channel: number, word: number): void;
  // ---- M3.3E synthetic hardware-interface lab -------------------------
  /** Apply ordered unprogrammed counter pulses (native PINC/MINC) through
   *  `agc_hw_input_apply`. Returns true only when the WHOLE batch applied;
   *  the WASM validates atomically. Optional so existing test doubles that
   *  never enter the lab profile keep compiling. */
  applyCounterPulses?(
    records: readonly {
      readonly counterAddress: number;
      readonly incType: string;
      readonly pulseCount: number;
      readonly suborder: number;
    }[],
  ): boolean;
  /** Serially shift one RNRAD word and raise the native RADARUPT latch, in
   *  one atomic host call. Returns true on success. */
  applyLandingRadarUpdate?(word: number, bitCount: number, raiseRadarupt: boolean): boolean;
}

export type MonitorInterlockReason =
  | "agc-reset"
  | "agc-epoch-changed"
  | "scenario-reset"
  | "simulation-interlock"
  | "terminal-state"
  | "worker-disposed"
  | "trace-unexpectedly-disabled"
  | "invalid-sensor-action-set";

export interface MonitorTickInputs {
  readonly missionTick: number;
  readonly missionTimeUs: number;
  readonly avionics: LmDiscreteSensorState | null;
  /**
   * M3.3E only. Body-axis specific force (m/s², thrust ÷ tick-start mass,
   * NO lunar gravity) for the synthetic lab profile. Ignored by every other
   * profile; `null` means no scenario force is defined.
   */
  readonly bodySpecificForceMps2?: Vec3 | null;
  /** Tick length in µs; required by the PIPA integrator. */
  readonly dtUs?: number;
}

/** Post-AGC inputs the synthetic lab needs. Absent for every other profile. */
export interface MonitorLabOutputInputs {
  /** Lossless, ordered CHAN13 output writes from THIS AGC interval. */
  readonly chan13Writes: readonly Chan13Write[];
  readonly altitudeMeters: number | null;
  readonly rangeDataGood: boolean;
  /** True only when the writes came from the clearly labelled test fixture. */
  readonly syntheticFixture?: boolean;
}


export interface MonitorPreAgcResult {
  readonly actionsEmitted: number;
  readonly actionsApplied: number;
  readonly rejected: boolean;
  readonly reasons: readonly MonitorBlockReason[];
}

export interface MonitorProfileRequestResult {
  readonly outcome: "entered" | "exited" | "blocked";
  readonly profile: AgcMonitorProfile;
  readonly status: AgcMonitorStatus;
  readonly reasons: readonly MonitorBlockReason[];
}

export interface MonitorRuntimeFacts {
  readonly profile: AgcMonitorProfile;
  readonly status: AgcMonitorStatus;
  readonly simulationEpoch: number;
  readonly agcEpoch: number;
  readonly traceEnabled: boolean;
  readonly traceDrainCount: number;
  readonly sensorSampleTicks: number;
  readonly outputObservationTicks: number;
  readonly interlockReason: MonitorInterlockReason | null;
}

const EMPTY_SENSOR_DIAGNOSTICS = (missionTimeUs: number): EncodedSensorDiagnostics => ({
  missionTimeUs,
  channelMaskUpdateCount: 0,
  counterPulseCount: 0,
  perCounter: [],
});

export class MonitorController {
  private profile: AgcMonitorProfile = "off";
  private status: AgcMonitorStatus = "off";
  private blockReasons: readonly MonitorBlockReason[] = [];
  private interlockReason: MonitorInterlockReason | null = null;

  private simulationEpoch = 0;
  private agcEpoch = 0;

  private encoder: DiscreteEncoderState | null = null;
  private decoder: AgcActuatorDecoderState = INITIAL_ACTUATOR_DECODER_STATE;

  private readonly ring = new MonitorTraceRing();
  private readonly shadow: AgcInputChannelShadow;

  private lastSensorDiagnostics: EncodedSensorDiagnostics | null = null;
  private lastSignalDiagnostics: readonly DiscreteSignalDiagnostic[] = [];
  private lastActions: readonly ChannelMaskUpdateAction[] = [];
  private lastControl: AgcCommandedControl | null = null;
  private lastThrust: ThrustCounterDiagnostic | null = null;
  private lastOutputChannelEvents: readonly AgcOutputChannelEvent[] = [];
  private lastOutputCounterEvents: readonly AgcOutputCounterEvent[] = [];
  private lastMissionTick = -1;

  // ---- M3.3E synthetic hardware-interface lab --------------------------
  private lab: HardwareInterfaceLabState | null = null;
  private lastLabDiagnostic: HardwareInterfaceLabDiagnostic | null = null;
  private lastLabStableMemberForce: Vec3 | null = null;
  private lastLabPipa: ReturnType<typeof labEncodePipa>["diagnostic"] | null = null;
  private lastLabRequest: Chan13RadarRequest | null = null;
  private lastLabResponse: LabRadarResponse | null = null;
  private lastLabRefusals: readonly LabRadarRefusal[] = [];


  private traceDrainCount = 0;
  private sensorSampleTicks = 0;
  private outputObservationTicks = 0;
  private lastDrainWasEmpty = true;

  constructor(
    private readonly port: MonitorHwPort,
    shadow?: AgcInputChannelShadow,
  ) {
    this.shadow = shadow ?? new AgcInputChannelShadow();
  }

  // ---------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------

  inputShadow(): AgcInputChannelShadow {
    return this.shadow;
  }

  facts(): MonitorRuntimeFacts {
    return {
      profile: this.profile,
      status: this.status,
      simulationEpoch: this.simulationEpoch,
      agcEpoch: this.agcEpoch,
      traceEnabled: this.port.traceEnabled(),
      traceDrainCount: this.traceDrainCount,
      sensorSampleTicks: this.sensorSampleTicks,
      outputObservationTicks: this.outputObservationTicks,
      interlockReason: this.interlockReason,
    };
  }

  isActive(): boolean {
    return this.status === "active" && this.profile !== "off";
  }

  signalDiagnostics(): readonly DiscreteSignalDiagnostic[] {
    return this.lastSignalDiagnostics;
  }

  lastAppliedActions(): readonly ChannelMaskUpdateAction[] {
    return this.lastActions;
  }

  rawOutputs(): {
    readonly channelEvents: readonly AgcOutputChannelEvent[];
    readonly counterEvents: readonly AgcOutputCounterEvent[];
  } {
    return {
      channelEvents: this.lastOutputChannelEvents,
      counterEvents: this.lastOutputCounterEvents,
    };
  }

  snapshot(missionTick: number): AgcMonitorSnapshot {
    return {
      profile: this.profile,
      status: this.status,
      sampledAtMissionTick: missionTick,
      sensors: this.lastSensorDiagnostics,
      commandedControl: this.lastControl,
      traceEnabled: this.port.traceEnabled(),
      traceCount: this.ring.count(),
      traceDropped: this.ring.droppedCount() + this.port.traceDropped(),
      blockReasons: this.blockReasons,
      inputChannels: this.ownedInputChannels(),
      lab: this.lastLabDiagnostic,
    };
  }

  /** M3.3E lab diagnostic for the most recent tick (null when inactive). */
  labDiagnostics(): HardwareInterfaceLabDiagnostic | null {
    return this.lastLabDiagnostic;
  }

  /** M3.3E lab state (tests + acceptance reporting). */
  labState(): HardwareInterfaceLabState | null {
    return this.lab;
  }


  /** Owned input channels + their COMPLETE current shadow words. The owned
   *  mask is derived from the registry for the ACTIVE profile; when the
   *  monitor is off the mask is zero (nothing is owned). */
  private ownedInputChannels(): readonly MonitorInputChannelView[] {
    const masks = new Map<number, number>();
    for (const ch of MONITOR_OWNED_INPUT_CHANNELS) masks.set(ch, 0);
    if (this.isActive()) {
      for (const m of mappedSignalsForProfile(this.profile)) {
        masks.set(m.channel, (masks.get(m.channel) ?? 0) | m.mask);
      }
    }
    return [...masks.keys()].sort((a, b) => a - b).map((channel) => ({
      channel,
      word: this.shadow.read(channel),
      ownedMask: masks.get(channel) ?? 0,
      seeded: !this.shadow.hasHostWrite(channel),
    }));
  }

  traceWindow(): MonitorTraceWindow {
    return this.ring.window();
  }

  thrustDiagnostic(): ThrustCounterDiagnostic | null {
    return this.lastThrust;
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /**
   * Atomic profile entry / exit. Ordering for entry is exactly:
   *   validate → reset trace → verify empty → enable trace → verify enabled
   *   → reset encoder/decoder state → active
   * Any failed step leaves the controller in `off` with the trace disabled;
   * there is no partial entry and no silent fallback to another profile.
   */
  requestProfile(
    profile: AgcMonitorProfile,
    ctx: MonitorEntryContext,
    avionics: LmDiscreteSensorState | null,
  ): MonitorProfileRequestResult {
    if (profile === "off") {
      this.exitToOff(null);
      return { outcome: "exited", profile: "off", status: this.status, reasons: [] };
    }

    const decision = decideMonitorEntry(profile, ctx);
    const reasons: MonitorBlockReason[] = decision.outcome === "blocked" ? [...decision.reasons] : [];

    // Additional runtime prerequisites the pure validator cannot see.
    if (avionics === null) {
      reasons.push({
        code: "prerequisite-missing",
        detail:
          "No explicit LmDiscreteSensorState has been supplied. Monitor entry requires a complete, operator-declared avionics discrete state.",
        reference: "docs/M3_3A2_P5.md",
      });
    }
    for (const err of validateRegistry()) {
      reasons.push({
        code: "unresolved-sensor-mapping",
        detail: `sensor registry: ${err.message}`,
        reference: "src/simulation/agcio/sensorRegistry.ts",
      });
    }
    for (const err of validateActuatorRegistry()) {
      reasons.push({
        code: "prerequisite-missing",
        detail: `actuator registry: ${err.message}`,
        reference: "src/simulation/agcio/actuatorRegistry.ts",
      });
    }
    if (this.port.hwioVersion() !== 4) {
      reasons.push({
        code: "canonical-hwio-wrong-version",
        detail: `Running WASM reports HW-I/O version ${this.port.hwioVersion()}; monitor requires 4.`,
        reference: "docs/M3_3A2_P4.md",
      });
    }

    if (reasons.length > 0) {
      // Blocked: guarantee we are fully disarmed. No partial entry.
      this.exitToOff(null);
      this.profile = "off";
      this.status = "blocked";
      this.blockReasons = reasons;
      return { outcome: "blocked", profile, status: this.status, reasons };
    }

    // ---- Deterministic arming sequence --------------------------------
    this.port.resetTrace();
    if (this.port.traceEnabled()) {
      // resetTrace must never leave the trace armed.
      this.exitToOff(null);
      this.status = "blocked";
      this.blockReasons = [
        {
          code: "trace-already-enabled",
          detail: "Trace reset did not clear the armed state; refusing to enter monitor mode.",
        },
      ];
      return { outcome: "blocked", profile, status: this.status, reasons: this.blockReasons };
    }
    const pending = this.port.drainTrace();
    if (pending.length !== 0) {
      this.exitToOff(null);
      this.status = "blocked";
      this.blockReasons = [
        {
          code: "prerequisite-missing",
          detail: `HW-I/O trace ring was not empty after reset (${pending.length} pending entries).`,
        },
      ];
      return { outcome: "blocked", profile, status: this.status, reasons: this.blockReasons };
    }
    this.port.setTraceEnabled(true);
    if (!this.port.traceEnabled()) {
      this.exitToOff(null);
      this.status = "blocked";
      this.blockReasons = [
        {
          code: "prerequisite-missing",
          detail: "HW-I/O trace failed to arm.",
        },
      ];
      return { outcome: "blocked", profile, status: this.status, reasons: this.blockReasons };
    }

    this.encoder = createDiscreteEncoderState(profile);
    this.decoder = INITIAL_ACTUATOR_DECODER_STATE;
    // M3.3E: a fresh lab state per entry — residual carry, CHAN13 retained
    // level and every counter start from zero. Entry never inherits state.
    this.lab =
      profile === HARDWARE_INTERFACE_LAB_PROFILE
        ? createHardwareInterfaceLabState()
        : null;
    this.clearLabDiagnostics();
    this.ring.clear();

    this.lastSensorDiagnostics = null;
    this.lastSignalDiagnostics = [];
    this.lastActions = [];
    this.lastControl = null;
    this.lastThrust = null;
    this.lastOutputChannelEvents = [];
    this.lastOutputCounterEvents = [];
    this.traceDrainCount = 0;
    this.sensorSampleTicks = 0;
    this.outputObservationTicks = 0;
    this.profile = profile;
    this.status = "active";
    this.blockReasons = [];
    this.interlockReason = null;
    this.simulationEpoch = ctx.simulationEpoch;
    this.agcEpoch = ctx.agcSessionEpoch;
    return { outcome: "entered", profile, status: this.status, reasons: [] };
  }

  /** Drop every retained lab diagnostic. Called on entry and on any exit so
   *  residuals and radar transaction state can never survive a reset. */
  private clearLabDiagnostics(): void {
    this.lastLabDiagnostic = null;
    this.lastLabStableMemberForce = null;
    this.lastLabPipa = null;
    this.lastLabRequest = null;
    this.lastLabResponse = null;
    this.lastLabRefusals = [];
  }

  /** Explicit exit: disable trace → reset trace → clear retained trace →
   *  clear encoder/decoder → off. Never re-arms automatically. */
  exitToOff(interlock: MonitorInterlockReason | null): void {
    this.port.setTraceEnabled(false);
    this.port.resetTrace();
    this.ring.clear();
    this.encoder = null;
    this.decoder = INITIAL_ACTUATOR_DECODER_STATE;
    this.lab = null;
    this.clearLabDiagnostics();
    this.lastSensorDiagnostics = null;
    this.lastSignalDiagnostics = [];
    this.lastActions = [];
    this.lastControl = null;
    this.lastThrust = null;
    this.lastOutputChannelEvents = [];
    this.lastOutputCounterEvents = [];
    this.profile = "off";
    this.status = interlock === null ? "off" : "interlocked";
    this.blockReasons = [];
    this.interlockReason = interlock;
  }


  /** Interlock: monitoring stops and CANNOT be re-armed implicitly. */
  interlock(reason: MonitorInterlockReason): void {
    if (this.status === "off" && this.interlockReason === null && this.profile === "off") {
      // Nothing armed; record the reason but stay off.
      this.port.setTraceEnabled(false);
      this.port.resetTrace();
      return;
    }
    this.exitToOff(reason);
  }

  /** Called when the AGC session epoch changes (cpu_reset disarms tracing
   *  inside the WASM as well). */
  onAgcEpochChanged(newEpoch: number): void {
    const wasArmed = this.isActive();
    this.agcEpoch = newEpoch;
    this.shadow.seedAfterCpuReset();
    if (wasArmed) this.interlock("agc-reset");
    else {
      this.port.setTraceEnabled(false);
      this.port.resetTrace();
    }
  }

  onSimulationEpochChanged(newEpoch: number): void {
    const wasArmed = this.isActive();
    this.simulationEpoch = newEpoch;
    if (wasArmed) this.interlock("scenario-reset");
  }

  onTerminalState(): void {
    if (this.isActive()) this.interlock("terminal-state");
  }

  dispose(): void {
    this.port.setTraceEnabled(false);
    this.port.resetTrace();
    this.ring.clear();
    this.profile = "off";
    this.status = "off";
  }

  // ---------------------------------------------------------------------
  // Tick phases
  // ---------------------------------------------------------------------

  /**
   * Phases 2–5: sample explicit avionics state, encode all due sensor
   * actions, validate the COMPLETE action set, then apply channel-mask
   * updates in suborder through the authoritative shadow.
   *
   * When the action set fails validation nothing is applied (no partial
   * application) and the monitor interlocks.
   */
  preAgcTick(inputs: MonitorTickInputs): MonitorPreAgcResult {
    if (!this.isActive() || this.encoder === null) {
      return { actionsEmitted: 0, actionsApplied: 0, rejected: false, reasons: [] };
    }
    if (inputs.avionics === null) {
      this.interlock("simulation-interlock");
      return {
        actionsEmitted: 0,
        actionsApplied: 0,
        rejected: true,
        reasons: [
          { code: "prerequisite-missing", detail: "avionics state disappeared while monitoring" },
        ],
      };
    }
    if (!this.port.traceEnabled()) {
      // cpu_reset (or anything else) disarmed the trace behind our back.
      this.interlock("trace-unexpectedly-disabled");
      return {
        actionsEmitted: 0,
        actionsApplied: 0,
        rejected: true,
        reasons: [
          {
            code: "prerequisite-missing",
            detail: "HW-I/O trace was disabled outside the monitor lifecycle.",
          },
        ],
      };
    }

    const encoded = encodeDiscreteSensorTick(
      this.encoder,
      inputs.avionics,
      inputs.missionTimeUs,
    );
    this.sensorSampleTicks += 1;
    this.lastSensorDiagnostics = encoded.diagnostics;
    this.lastSignalDiagnostics = encoded.signalDiagnostics;

    if (encoded.blockedPrerequisites.length > 0) {
      this.interlock("invalid-sensor-action-set");
      return {
        actionsEmitted: 0,
        actionsApplied: 0,
        rejected: true,
        reasons: encoded.blockedPrerequisites,
      };
    }

    // ---- Phase 4: validate the COMPLETE set before applying anything ----
    const actions = [...encoded.actions].sort((a, b) => a.suborder - b.suborder);
    const problems: MonitorBlockReason[] = [];
    const merged: { action: ChannelMaskUpdateAction; word: number }[] = [];
    // Validate against a COPY of the shadow so a rejected set cannot leave
    // a partially-merged word behind.
    const provisional = new Map<number, number>();
    for (const action of actions) {
      if (action.kind !== "channel-mask-update") {
        problems.push({
          code: "prerequisite-missing",
          detail: `P5 emits channel-mask updates only; got action kind ${String(
            (action as { kind: string }).kind,
          )}`,
        });
        continue;
      }
      if ((action.value & ~action.mask) !== 0) {
        problems.push({
          code: "sensor-range-invalid",
          detail: `action ${action.mappingId}: value outside owned mask`,
        });
        continue;
      }
      const current = provisional.get(action.channel) ?? this.shadow.read(action.channel);
      // Mandated merge rule (P5.b): owned bits replace, unowned bits survive.
      const next = (current & ~action.mask) | (action.value & action.mask);
      provisional.set(action.channel, next);
      merged.push({ action, word: next });
    }

    if (problems.length > 0) {
      this.interlock("invalid-sensor-action-set");
      return { actionsEmitted: actions.length, actionsApplied: 0, rejected: true, reasons: problems };
    }

    // ---- Phase 5: apply in suborder -------------------------------------
    for (const { action, word } of merged) {
      this.shadow.write(action.channel, word);
      this.port.writeInputChannel(action.channel, word);
      this.ring.append({
        kind: "sensor-channel",
        missionTick: inputs.missionTick,
        missionTimeUs: inputs.missionTimeUs,
        channel: action.channel,
        mask: action.mask,
        value: action.value,
        mergedWord: word,
        suborder: action.suborder,
        mappingId: action.mappingId,
      });
    }

    this.encoder = encoded.nextState;
    this.lastActions = merged.map((m) => m.action);

    // ---- M3.3E: live PIPA ΔV pulses (native PINC/MINC) ------------------
    const pipaPulses = this.applyLabPipa(inputs);

    return {
      actionsEmitted: actions.length + pipaPulses.actionsEmitted,
      actionsApplied: merged.length + pipaPulses.actionsApplied,
      rejected: false,
      reasons: [],
    };
  }

  /**
   * M3.3E — encode and deliver this tick's PIPA pulses.
   *
   * Inert unless the synthetic lab profile is active. Atomic: a refused
   * encode delivers nothing, and a rejected WASM batch leaves the residual
   * state untouched so no ΔV is silently lost.
   */
  private applyLabPipa(inputs: MonitorTickInputs): {
    actionsEmitted: number;
    actionsApplied: number;
  } {
    if (this.profile !== HARDWARE_INTERFACE_LAB_PROFILE || this.lab === null) {
      return { actionsEmitted: 0, actionsApplied: 0 };
    }
    const dtUs = inputs.dtUs ?? 20_000;
    const result = labEncodePipa(this.lab, {
      missionTimeUs: inputs.missionTimeUs,
      dtUs,
      bodySpecificForceMps2: inputs.bodySpecificForceMps2 ?? null,
      // The encoder consumes the SAME operator-declared discrete the CHAN33
      // PIPA FAIL bit is derived from — never a separate invented value.
      pipaHealthy: inputs.avionics?.pipaHealthy ?? false,
    });

    this.lastLabStableMemberForce = result.stableMemberSpecificForceMps2;
    this.lastLabPipa = result.diagnostic;

    if (result.blockedPrerequisites.length > 0 || result.actions.length === 0) {
      // Nothing emitted. Residual state still advances only via nextState,
      // which for a refusal is the unchanged state.
      this.lab = result.nextState;
      return { actionsEmitted: 0, actionsApplied: 0 };
    }

    const records = result.actions
      .filter((a): a is Extract<AgcSensorAction, { kind: "counter-pulses" }> =>
        a.kind === "counter-pulses")
      .map((a) => ({
        counterAddress: a.counterAddress,
        incType: a.incType,
        pulseCount: a.pulseCount,
        suborder: a.suborder,
      }));

    const ok = this.port.applyCounterPulses?.(records) ?? false;
    if (!ok) {
      // The batch was refused by the emulator. Do NOT advance the residual
      // state: the ΔV has not been delivered and must not be discarded.
      return { actionsEmitted: records.length, actionsApplied: 0 };
    }

    const pulses = records.reduce((n, r) => n + r.pulseCount, 0);
    this.lab = labRecordDeliveredPulses(result.nextState, pulses);
    return { actionsEmitted: records.length, actionsApplied: records.length };
  }


  /**
   * Phases 7–10: drain the WASM output-counter ring EXACTLY ONCE, combine
   * with the losslessly captured CHAN11/CHAN14 events from the same AGC
   * interval, run the pure decoder, and append bounded diagnostics.
   */
  postAgcTick(
    missionTick: number,
    missionTimeUs: number,
    channelEvents: readonly AgcOutputChannelEvent[],
    labInputs?: MonitorLabOutputInputs,
  ): void {
    if (!this.isActive()) return;


    const counterEvents = this.port.drainTrace();
    this.traceDrainCount += 1;
    this.lastDrainWasEmpty = counterEvents.length === 0;
    const traceDropped = this.port.traceDropped();

    const result = reduceAgcActuatorTick(this.decoder, {
      missionTick,
      channelEvents,
      counterEvents,
      traceDropped,
    });
    this.decoder = result.nextState;
    this.lastControl = result.control;
    this.lastThrust = result.thrust;
    this.lastOutputChannelEvents = channelEvents;
    this.lastOutputCounterEvents = counterEvents;
    this.outputObservationTicks += 1;
    this.lastMissionTick = missionTick;

    for (const e of channelEvents) {
      if (!EXPECTED_ACTUATOR_CHANNELS.includes(e.channel)) continue;
      this.ring.append({
        kind: "output-channel",
        missionTick,
        missionTimeUs,
        channel: e.channel,
        value: e.value,
        valueBefore: e.valueBefore,
      });
    }
    for (const e of counterEvents) {
      this.ring.append({
        kind: "output-counter",
        missionTick,
        missionTimeUs,
        address: e.address,
        operation: e.operation,
        delta: e.delta,
        valueBefore: e.valueBefore,
        valueAfter: e.valueAfter,
      });
    }

    // ---- M3.3E: request-driven landing-radar ALTITUDE transaction --------
    this.applyLabRadar(missionTimeUs, labInputs);
  }

  /**
   * M3.3E — answer at most ONE Luminary-solicited altitude request per tick.
   *
   * There is no host timer here: if the rope never writes CHAN13, nothing is
   * ever shifted into RNRAD and RADARUPT is never raised.
   */
  private applyLabRadar(missionTimeUs: number, labInputs?: MonitorLabOutputInputs): void {
    if (this.profile !== HARDWARE_INTERFACE_LAB_PROFILE || this.lab === null) return;

    const observed = labObserveChan13(this.lab, {
      writes: labInputs?.chan13Writes ?? [],
      altitudeMeters: labInputs?.altitudeMeters ?? null,
      rangeDataGood: labInputs?.rangeDataGood ?? false,
      syntheticFixture: labInputs?.syntheticFixture,
    });
    let lab = observed.nextState;
    this.lastLabRequest = observed.requests[observed.requests.length - 1] ?? this.lastLabRequest;
    this.lastLabRefusals = observed.refusals;

    // Two-phase transaction: nothing is committed until the emulator has
    // accepted the serial word AND the RADARUPT request.
    const candidate = observed.candidate;
    if (candidate !== null) {
      const ok =
        this.port.applyLandingRadarUpdate?.(
          candidate.action.word,
          candidate.action.bitCount,
          candidate.action.raiseRadarupt,
        ) ?? false;

      if (ok) {
        lab = labCommitRadarResponse(lab, candidate);
        this.lastLabResponse = candidate;
      } else {
        // Not delivered: no counted response, an explicit refusal, the
        // solicitation closed (never silently retried) and the lab
        // interlocked because the bridge is no longer trustworthy.
        lab = labRejectRadarResponse(lab, candidate);
        this.lastLabResponse = null;
        this.lastLabRefusals = [...this.lastLabRefusals, "hardware-application-rejected"];
      }
    } else {
      this.lastLabResponse = null;
    }

    this.lab = lab;
    this.lastLabDiagnostic = labDiagnostic(lab, missionTimeUs, {
      pipa: this.lastLabPipa,
      stableMemberSpecificForceMps2: this.lastLabStableMemberForce,
      lastRequest: this.lastLabRequest,
      lastResponse: this.lastLabResponse,
      lastRefusals: this.lastLabRefusals,
    });
  }


  lastDrainEmpty(): boolean {
    return this.lastDrainWasEmpty;
  }

  lastObservedMissionTick(): number {
    return this.lastMissionTick;
  }

  emptySensorDiagnostics(missionTimeUs: number): EncodedSensorDiagnostics {
    return EMPTY_SENSOR_DIAGNOSTICS(missionTimeUs);
  }
}
