// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.2 Deterministic Mission Runtime — pure coordinator.
//
// Owns MissionRuntimeState and a deterministic command queue. Never touches
// wall clocks, React, timers, or postMessage. The AGC Worker drives it once
// per 20 000 µs mission tick using the shared MissionClock's tick boundary.
//
// Tick phase order (documented and enforced by the Worker's tick loop):
//   1. applyBoundaryCommands(tickStartUs)  — drain due commands
//   2. (reserved) AGC-input sampling       — M3.3
//   3. (Worker steps AGC for the tick)
//   4. (reserved) AGC-output resolution    — M3.3
//   5. advancePhysics(tickStartUs, index)  — one 20 000 µs kernel step
//   6. terminal touchdown latching (if any) — emitted lossless
//   7. (Worker publishes coalesced snapshot)

import {
  DEFAULT_LM_PHYSICS_PARAMETERS,
  type LmPhysicsParameters,
  type LmPhysicsState,
} from "@/simulation/lm";
// P5 physics firewall: the runtime advances physics ONLY through the
// branded wrapper. `AgcCommandedControl` has no brand and cannot be passed.
import {
  advanceMissionPhysics,
  resolveScenarioPhysicsControl,
} from "./physicsControl";
import type { AgcMonitorSnapshot } from "@/simulation/agcio/types";
import type {
  CommandAck,
  CommandRejectionReason,
  MissionCommand,
  MissionRuntimeState,
  MissionSnapshot,
  TerminalTouchdownEvent,
} from "./types";

export const MISSION_TICK_US = 20_000;

export interface MissionRuntimeOptions {
  readonly parameters?: LmPhysicsParameters;
}

export class MissionRuntime {
  private readonly params: LmPhysicsParameters;
  private state: MissionRuntimeState;
  private queue: MissionCommand[] = [];
  /** commandIds seen in the CURRENT simulation epoch. Cleared on every
   *  epoch bump (resetScenario) so a fresh scenario has a fresh id space. */
  private seenIds = new Set<number>();
  private snapshotSeq = 0;
  /** Counter used to mint id-space for scenario-internal setControl
   *  synthesized from an LmScenarioDefinition.timedCommands. Kept in the
   *  negative range so it can never collide with user-supplied ids. */
  private nextInternalId = -1;

  constructor(opts: MissionRuntimeOptions = {}) {
    this.params = opts.parameters ?? DEFAULT_LM_PHYSICS_PARAMETERS;
    this.state = freshState(0);
  }

  getState(): Readonly<MissionRuntimeState> {
    return this.state;
  }

  getSimulationEpoch(): number {
    return this.state.simulationEpoch;
  }

  getStatus(): MissionRuntimeState["status"] {
    return this.state.status;
  }

  /** Number of commands currently queued (for tests). */
  queuedCount(): number {
    return this.queue.length;
  }

  /** Validate and enqueue. Deterministic ordering is enforced at apply time
   *  by draining in (applyAt, commandId) order. */
  enqueue(cmd: MissionCommand): CommandAck {
    if (this.seenIds.has(cmd.commandId)) {
      return rej(cmd.commandId, "duplicate-command-id",
        `commandId ${cmd.commandId} already accepted in epoch ${this.state.simulationEpoch}`);
    }
    if (cmd.simulationEpoch !== this.state.simulationEpoch) {
      return rej(cmd.commandId, "stale-simulation-epoch",
        `command epoch ${cmd.simulationEpoch} != runtime epoch ${this.state.simulationEpoch}`);
    }
    if (cmd.applyAtMissionTimeUs <= this.state.acceptedCursorUs) {
      return rej(cmd.commandId, "stale-command",
        `applyAtMissionTimeUs ${cmd.applyAtMissionTimeUs} <= cursor ${this.state.acceptedCursorUs}`);
    }
    if (this.state.status === "interlocked" && cmd.type !== "resetScenario") {
      return rej(cmd.commandId, "interlocked",
        `runtime interlocked (${this.state.interlockReason ?? "unknown"})`);
    }
    this.seenIds.add(cmd.commandId);
    this.queue.push(cmd);
    this.sortQueue();
    return { accepted: true, commandId: cmd.commandId };
  }

  /**
   * Phase 1 — apply every command whose applyAtMissionTimeUs <= tickStartUs
   * in strict (applyAt, commandId) order. Returns any deferred rejections
   * (e.g. `scenario-not-running` for a same-timestamp setControl that
   * arrives before its startScenario).
   */
  applyBoundaryCommands(tickStartUs: number): CommandAck[] {
    const rejections: CommandAck[] = [];
    while (this.queue.length > 0 && this.queue[0].applyAtMissionTimeUs <= tickStartUs) {
      const cmd = this.queue.shift()!;
      const ack = this.applyCommand(cmd);
      if (!ack.accepted) rejections.push(ack);
    }
    return rejections;
  }

  /**
   * Phase 5 + 6 — advance LM physics by exactly one mission tick when a
   * scenario is running, and latch touchdown atomically. Returns the
   * terminal event if this tick produced one, otherwise null. Updates the
   * accepted cursor to tickStartUs + MISSION_TICK_US regardless of status
   * so idle/interlocked runtimes still reject stale commands correctly.
   */
  advancePhysics(tickStartUs: number, tickIndex: number): TerminalTouchdownEvent | null {
    const tickEndUs = tickStartUs + MISSION_TICK_US;
    let terminal: TerminalTouchdownEvent | null = null;

    if (this.state.status === "running" && this.state.lm !== null) {
      const before = this.state.lm;
      const next = advanceMissionPhysics(
        before,
        resolveScenarioPhysicsControl(this.state.control),
        MISSION_TICK_US,
        this.params,
      );
      this.state.lm = next;
      this.state.scenarioElapsedUs = next.simulationTimeUs;
      if (next.landed && !before.landed) {
        this.state.touchdown = next.touchdown;
        this.state.status = next.touchdown?.classification === "crash" ? "crashed" : "landed";
        terminal = {
          simulationEpoch: this.state.simulationEpoch,
          scenarioId: this.state.scenarioId ?? "unknown",
          missionTick: tickIndex,
          missionTimeUs: tickEndUs,
          scenarioElapsedUs: next.simulationTimeUs,
          touchdown: next.touchdown!,
          finalLm: next,
        };
      }
    }

    this.state.acceptedCursorUs = tickEndUs;
    return terminal;
  }

  /**
   * M3.3E — body-axis specific force for the synthetic hardware-interface
   * lab: engine thrust ÷ current total mass, in m/s², along +X (thrust
   * axis). Lunar gravity is DELIBERATELY EXCLUDED: an accelerometer is in
   * free fall under gravity and senses only non-gravitational force.
   *
   * Read-only derivation from scenario state — this never feeds the kernel,
   * so the physics firewall is untouched.
   */
  getBodySpecificForceMps2(): readonly [number, number, number] | null {
    const lm = this.state.lm;
    if (this.state.status !== "running" || lm === null) return null;
    const mass = lm.dryMassKg + lm.propellantMassKg;
    if (!(mass > 0)) return null;
    const thrustN = lm.engineEnabled
      ? this.params.vehicle.maxThrustN.value * lm.throttle
      : 0;

    return [thrustN / mass, 0, 0];
  }

  /** M3.3E — current scenario altitude (metres) or null when idle. */
  getAltitudeMeters(): number | null {
    const lm = this.state.lm;
    if (this.state.status !== "running" || lm === null) return null;
    return lm.altitudeM;
  }


  /** Move the runtime into `interlocked` when the AGC session epoch changes
   *  while a scenario is active. Idempotent; does nothing when no scenario
   *  is running (idle/landed/crashed are terminal or empty). */
  interlock(reason: "agc-epoch-changed"): void {
    if (this.state.status === "running") {
      this.state.status = "interlocked";
      this.state.interlockReason = reason;
    }
  }

  snapshot(
    missionTick: number,
    missionTimeUs: number,
    clockPaused: boolean,
    monitor: AgcMonitorSnapshot | null = null,
  ): MissionSnapshot {
    return {
      sequence: ++this.snapshotSeq,
      missionTick,
      missionTimeUs,
      clockPaused,
      simulationEpoch: this.state.simulationEpoch,
      scenarioElapsedUs: this.state.scenarioElapsedUs,
      status: this.state.status,
      interlockReason: this.state.interlockReason,
      lm: this.state.lm === null ? null : { ...this.state.lm },
      control: { ...this.state.control },
      touchdown: this.state.touchdown === null ? null : { ...this.state.touchdown },
      monitor,
    };
  }

  private applyCommand(cmd: MissionCommand): CommandAck {
    // Interlock re-check at apply time — a scenario reset in the same batch
    // could have cleared it, so we don't want to reject prematurely.
    if (this.state.status === "interlocked" && cmd.type !== "resetScenario") {
      return rej(cmd.commandId, "interlocked",
        `runtime interlocked at apply time (${this.state.interlockReason ?? "unknown"})`);
    }

    switch (cmd.type) {
      case "startScenario": {
        const s = cmd.scenario;
        this.state.scenarioId = s.id;
        this.state.scenarioStartMissionTimeUs = cmd.applyAtMissionTimeUs;
        this.state.scenarioElapsedUs = 0;
        this.state.lm = { ...s.initialLmState, simulationTimeUs: 0 };
        this.state.control = {
          throttle: s.initialLmState.throttle,
          engineEnabled: s.initialLmState.engineEnabled,
        };
        this.state.touchdown = null;
        this.state.status = "running";
        this.state.lastAppliedCommandId = cmd.commandId;

        // Translate scenario-relative TimedLmCommands into absolute-mission-time
        // setControl commands. They use a private negative id namespace so
        // they can never collide with user-supplied commandIds.
        for (const tc of s.timedCommands) {
          const absAt = cmd.applyAtMissionTimeUs + tc.simulationTimeUs;
          if (absAt <= this.state.acceptedCursorUs) continue;
          const internalId = this.nextInternalId--;
          this.queue.push({
            type: "setControl",
            commandId: internalId,
            simulationEpoch: this.state.simulationEpoch,
            applyAtMissionTimeUs: absAt,
            throttle: tc.throttle,
            engineEnabled: tc.engineEnabled,
          });
        }
        this.sortQueue();
        return { accepted: true, commandId: cmd.commandId };
      }

      case "setControl": {
        if (this.state.status !== "running") {
          return rej(cmd.commandId, "scenario-not-running",
            `setControl requires status=running, got ${this.state.status}`);
        }
        this.state.control = {
          throttle: cmd.throttle ?? this.state.control.throttle,
          engineEnabled: cmd.engineEnabled ?? this.state.control.engineEnabled,
        };
        this.state.lastAppliedCommandId = cmd.commandId;
        return { accepted: true, commandId: cmd.commandId };
      }

      case "resetScenario": {
        this.performReset();
        this.state.lastAppliedCommandId = cmd.commandId;
        return { accepted: true, commandId: cmd.commandId };
      }
    }
  }

  private performReset(): void {
    // Bump epoch FIRST so any future enqueue against the OLD epoch is
    // rejected as stale-simulation-epoch even during teardown.
    const nextEpoch = this.state.simulationEpoch + 1;
    const acceptedCursorUs = this.state.acceptedCursorUs;
    this.state = freshState(nextEpoch);
    // Preserve the mission-time cursor across resets so no queued command
    // can retroactively fire in the past.
    this.state.acceptedCursorUs = acceptedCursorUs;
    this.queue = [];
    this.seenIds.clear();
    this.nextInternalId = -1;
  }

  /** Stable sort by (applyAt, commandId). Node/V8's Array#sort is stable
   *  since 2019 but we make the comparator total so behavior is
   *  order-invariant even under other engines. */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.applyAtMissionTimeUs !== b.applyAtMissionTimeUs) {
        return a.applyAtMissionTimeUs - b.applyAtMissionTimeUs;
      }
      return a.commandId - b.commandId;
    });
  }
}

function freshState(epoch: number): MissionRuntimeState {
  return {
    simulationEpoch: epoch,
    status: "idle",
    interlockReason: null,
    scenarioId: null,
    scenarioStartMissionTimeUs: null,
    scenarioElapsedUs: 0,
    lm: null,
    control: { throttle: 0, engineEnabled: false },
    touchdown: null,
    lastAppliedCommandId: null,
    acceptedCursorUs: -1,
  };
}

function rej(id: number, reason: CommandRejectionReason, message: string): CommandAck {
  return { accepted: false, commandId: id, reason, message };
}

/** Structural, order-invariant equality between two runtime states for
 *  determinism tests. Ignores object identity but compares every field. */
export function missionRuntimeStatesEqual(
  a: Readonly<MissionRuntimeState>,
  b: Readonly<MissionRuntimeState>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
