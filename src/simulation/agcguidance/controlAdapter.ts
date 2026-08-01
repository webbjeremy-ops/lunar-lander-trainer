// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — RECONSTRUCTED LM CONTROL-ELECTRONICS ADAPTER.
//
//   AUTHENTIC LUMINARY GUIDANCE
//   RECONSTRUCTED LM CONTROL-ELECTRONICS ADAPTER
//
// The AGC issued guidance intent; the LM's control and propulsion electronics
// turned it into gimbal, RCS and throttle actuation. This module is an
// explicitly approximate stand-in for that hardware. It is:
//
//   * pure and deterministic (integer microsecond dt, no clocks, no I/O);
//   * hard-bounded — attitude authority, attitude rate and throttle slew are
//     clamped to the kernel's own limits, so no target can drive the vehicle
//     outside behaviour the physics kernel already permits;
//   * refusable — invalid targets produce no command at all, never a guess.
//
// It does not claim any historical transfer function; see the
// `control-electronics-response` assumption.

import type {
  LunarControlInput,
  LunarFlightState,
} from "@/simulation/lunar2d/types";
import {
  DEFAULT_LUNAR_FLIGHT_PARAMETERS,
  type LunarFlightParameters,
} from "@/simulation/lunar2d/LunarMissionConstants";
import { snapDescentThrottle } from "@/simulation/lunar2d/physics";
import { CONTROL_ADAPTER_LABEL } from "./assumptions";
import { validateGuidanceTargets, type AgcGuidanceTargetsV1 } from "./targets";

export interface ControlAdapterConfig {
  /** Proportional gain from attitude error (rad) to commanded rate (rad/s). */
  readonly attitudeGainPerSec: number;
  /** Proportional gain from rate error (rad/s) to authority command [-1, 1]. */
  readonly rateGain: number;
  /** Maximum throttle change per second (DPS actuator slew stand-in). */
  readonly throttleSlewPerSec: number;
  /** Attitude errors below this are treated as zero. */
  readonly attitudeDeadbandRad: number;
}

export const DEFAULT_CONTROL_ADAPTER_CONFIG: ControlAdapterConfig = {
  attitudeGainPerSec: 0.6,
  rateGain: 8,
  throttleSlewPerSec: 0.5,
  attitudeDeadbandRad: 0.5 * (Math.PI / 180),
};

/** Carried between ticks. Serializable and replay-safe. */
export interface ControlAdapterState {
  readonly throttle: number;
  readonly ticks: number;
}

export const INITIAL_CONTROL_ADAPTER_STATE: ControlAdapterState = {
  throttle: 0,
  ticks: 0,
};

export interface ControlAdapterOutput {
  readonly label: typeof CONTROL_ADAPTER_LABEL;
  /** Null when the targets were refused — the caller must not synthesize one. */
  readonly control: LunarControlInput | null;
  readonly nextAdapterState: ControlAdapterState;
  /** Non-empty when the record was refused. */
  readonly refusals: readonly string[];
  /** Which bounds actually bit on this tick. Diagnostic only. */
  readonly clamped: readonly ("attitude-authority" | "attitude-rate" | "throttle-slew" | "throttle-band")[];
  readonly attitudeErrorRad: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * One adapter tick: guidance targets in, bounded vehicle commands out.
 *
 * `dtUs` must be a positive integer number of microseconds. The adapter is a
 * pure function of (state, targets, adapterState, dt).
 */
export function stepControlAdapter(input: {
  readonly state: Readonly<LunarFlightState>;
  readonly targets: AgcGuidanceTargetsV1;
  readonly adapterState: ControlAdapterState;
  readonly dtUs: number;
  readonly parameters?: Readonly<LunarFlightParameters>;
  readonly config?: ControlAdapterConfig;
}): ControlAdapterOutput {
  const parameters = input.parameters ?? DEFAULT_LUNAR_FLIGHT_PARAMETERS;
  const config = input.config ?? DEFAULT_CONTROL_ADAPTER_CONFIG;
  const { state, targets, adapterState } = input;

  const refusals = [...validateGuidanceTargets(targets)];
  if (!Number.isInteger(input.dtUs) || input.dtUs <= 0) refusals.push("invalid-dt");
  if (state.terminalState !== null) refusals.push("terminal-state");
  if (refusals.length > 0) {
    return {
      label: CONTROL_ADAPTER_LABEL,
      control: null,
      nextAdapterState: adapterState,
      refusals,
      clamped: [],
      attitudeErrorRad: 0,
    };
  }

  const dt = input.dtUs / 1e6;
  const clamped: ControlAdapterOutput["clamped"][number][] = [];

  // --- Attitude: angle error -> rate target -> bounded authority command.
  let attitudeError = targets.commandedAttitudeRad - state.attitudeRad;
  if (Math.abs(attitudeError) < config.attitudeDeadbandRad) attitudeError = 0;

  const maxRate = parameters.attitude.maxAngularRateRadPerSec.value;
  let rateTarget =
    targets.attitudeRateTargetRadPerSec + attitudeError * config.attitudeGainPerSec;
  if (Math.abs(rateTarget) > maxRate) {
    rateTarget = clamp(rateTarget, -maxRate, maxRate);
    clamped.push("attitude-rate");
  }

  let attitudeCommand = (rateTarget - state.angularRateRadPerSec) * config.rateGain;
  if (Math.abs(attitudeCommand) > 1) {
    attitudeCommand = clamp(attitudeCommand, -1, 1);
    clamped.push("attitude-authority");
  }

  // --- Throttle: slew-limited approach to the tendency, then band snapping.
  const maxStep = config.throttleSlewPerSec * dt;
  const desired = clamp(targets.throttleTendency, 0, 1);
  let throttle = desired;
  if (Math.abs(desired - adapterState.throttle) > maxStep) {
    throttle = adapterState.throttle + Math.sign(desired - adapterState.throttle) * maxStep;
    clamped.push("throttle-slew");
  }
  const engineCommand: LunarControlInput["engineCommand"] =
    state.configuration === "ascent-stage"
      ? throttle > 0
        ? "ascent"
        : "off"
      : throttle > 0
        ? "descent"
        : "off";
  const snapped =
    engineCommand === "descent" ? snapDescentThrottle(throttle, parameters) : throttle;
  if (snapped !== throttle) clamped.push("throttle-band");

  return {
    label: CONTROL_ADAPTER_LABEL,
    control: {
      throttle: snapped,
      engineCommand,
      attitudeCommand,
    },
    nextAdapterState: { throttle, ticks: adapterState.ticks + 1 },
    refusals: [],
    clamped,
    attitudeErrorRad: attitudeError,
  };
}
