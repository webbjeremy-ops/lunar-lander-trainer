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
import type {
  AgcCommandedControl,
  AgcMonitorProfile,
  AgcMonitorSnapshot,
  AgcMonitorStatus,
  AgcOutputChannelEvent,
  AgcOutputCounterEvent,
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
  /** HW-I/O v2 reported by the running WASM (0 when absent). */
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
    };
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
    if (this.port.hwioVersion() !== 2) {
      reasons.push({
        code: "canonical-hwio-wrong-version",
        detail: `Running WASM reports HW-I/O version ${this.port.hwioVersion()}; monitor requires 2.`,
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

  /** Explicit exit: disable trace → reset trace → clear retained trace →
   *  clear encoder/decoder → off. Never re-arms automatically. */
  exitToOff(interlock: MonitorInterlockReason | null): void {
    this.port.setTraceEnabled(false);
    this.port.resetTrace();
    this.ring.clear();
    this.encoder = null;
    this.decoder = INITIAL_ACTUATOR_DECODER_STATE;
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
    return {
      actionsEmitted: actions.length,
      actionsApplied: merged.length,
      rejected: false,
      reasons: [],
    };
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
