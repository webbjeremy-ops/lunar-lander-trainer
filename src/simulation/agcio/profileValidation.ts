// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.a — pure validation for setMonitorProfile.
//
// This module is a PURE function. It never touches the AGC Worker, never
// arms the extension trace, never injects sensor input, and never mutates
// mission-runtime state. It exists so the eventual P5.d Worker integration
// can consume a single deterministic decision: "may this profile be entered
// atomically right now, and if not, why not?".

import type {
  AgcMonitorProfile,
  MonitorBlockReason,
  ReservedSetMonitorProfileCommand,
} from "./types";

/** Static snapshot of runtime facts the validator needs to decide whether
 *  a monitor profile can be entered atomically. Every field is derived from
 *  worker-owned state at the tick boundary; nothing here mutates. */
export interface MonitorEntryContext {
  /** Current AGC simulation epoch (mission-runtime epoch). */
  readonly simulationEpoch: number;
  /** AGC session epoch — bumped by `cpu_reset()`. Distinct from
   *  simulationEpoch. */
  readonly agcSessionEpoch: number;
  /** AGC has published its initial `ready` message and rope is installed. */
  readonly agcReady: boolean;
  /** Canonical HW-I/O version reported by the running WASM (0 = missing). */
  readonly hwioVersion: number;
  /** Rope identity currently installed. */
  readonly ropeId: string;
  /** Rope SHA-256, lowercase hex. */
  readonly ropeSha256: string;
  /** Mission-runtime status. */
  readonly runtimeStatus:
    | "idle"
    | "running"
    | "interlocked"
    | "landed"
    | "crashed";
  /** Scenario currently running (if any). */
  readonly activeScenarioId: string | null;
  /** Whether the extension output-counter trace is currently enabled.
   *  Entering monitor mode requires this to be FALSE (the entry sequence
   *  arms it deterministically). */
  readonly traceCurrentlyEnabled: boolean;
}

/** Canonical Luminary099 rope identity — the only rope descent-monitor-v1
 *  accepts. Pinned to the frozen M2 rope manifest. */
export const REQUIRED_ROPE_ID = "Luminary099" as const;

/** All profiles the Worker knows about. Static and versioned; exposed via
 *  the reserved `supportedMonitorProfiles` list in sim:ready v2 (P5.d). */
export const SUPPORTED_MONITOR_PROFILES: readonly AgcMonitorProfile[] = [
  "off",
  "discrete-observer-v0",
  "descent-monitor-v1",
] as const;

export interface MonitorEntryDecisionAllowed {
  readonly outcome: "allowed";
  readonly profile: AgcMonitorProfile;
}

export interface MonitorEntryDecisionBlocked {
  readonly outcome: "blocked";
  readonly profile: AgcMonitorProfile;
  readonly reasons: readonly MonitorBlockReason[];
}

export type MonitorEntryDecision =
  | MonitorEntryDecisionAllowed
  | MonitorEntryDecisionBlocked;

/**
 * Decide whether `profile` may be entered given `ctx`. Pure; deterministic.
 *
 * `off` is always allowed (it is the frozen-M3.2 baseline). Any non-off
 * profile requires the full set of preconditions listed in the P5 spec §2:
 * canonical HW-I/O v2, Luminary099 rope, AGC ready, matching epochs, active
 * compatible scenario, trace currently disabled.
 *
 * `descent-monitor-v1` additionally reports the unresolved LR range /
 * velocity and PIPA mappings from `docs/M3_3_IO_MAP.md` as
 * `unresolved-sensor-mapping` reasons. That set is NON-EMPTY as of P5.a, so
 * the profile MUST currently return `blocked`. When those mappings are
 * resolved this function is the single place to remove them.
 */
export function decideMonitorEntry(
  profile: AgcMonitorProfile,
  ctx: MonitorEntryContext,
): MonitorEntryDecision {
  if (profile === "off") {
    return { outcome: "allowed", profile };
  }

  if (!SUPPORTED_MONITOR_PROFILES.includes(profile)) {
    return {
      outcome: "blocked",
      profile,
      reasons: [
        {
          code: "profile-unknown",
          detail: `Unknown monitor profile: ${String(profile)}`,
        },
      ],
    };
  }

  const reasons: MonitorBlockReason[] = [];

  if (ctx.hwioVersion === 0) {
    reasons.push({
      code: "canonical-hwio-missing",
      detail: "Canonical yaAGC-ext HW-I/O exports are not present.",
      reference: "docs/M3_3A2_P4.md",
    });
  } else if (ctx.hwioVersion !== 2) {
    reasons.push({
      code: "canonical-hwio-wrong-version",
      detail: `Canonical HW-I/O version must be 2 (got ${ctx.hwioVersion}).`,
      reference: "docs/M3_3A2_P4.md",
    });
  }

  if (ctx.ropeId !== REQUIRED_ROPE_ID) {
    reasons.push({
      code: "rope-not-luminary099",
      detail: `Monitor profiles require rope ${REQUIRED_ROPE_ID}; got ${ctx.ropeId}.`,
      reference: "docs/M2_FREEZE.md",
    });
  }

  if (!ctx.agcReady) {
    reasons.push({
      code: "agc-not-ready",
      detail: "AGC has not published ready.",
    });
  }

  if (ctx.runtimeStatus !== "running" || ctx.activeScenarioId === null) {
    reasons.push({
      code: "no-active-scenario",
      detail: `Monitor profiles require an active scenario (runtimeStatus=${ctx.runtimeStatus}).`,
    });
  }

  if (ctx.traceCurrentlyEnabled) {
    reasons.push({
      code: "trace-already-enabled",
      detail:
        "HW-I/O output-counter trace is already enabled outside monitor lifecycle; refusing to enter.",
    });
  }

  if (profile === "descent-monitor-v1") {
    for (const reason of DESCENT_MONITOR_V1_UNRESOLVED_MAPPINGS) {
      reasons.push(reason);
    }
  }

  if (reasons.length === 0) {
    return { outcome: "allowed", profile };
  }
  return { outcome: "blocked", profile, reasons };
}

/**
 * The exact list of unresolved LR/PIPA mappings currently blocking
 * `descent-monitor-v1`. Removing an entry from this list is the sole
 * mechanism by which the profile becomes enterable; there is no bypass.
 * Sourced verbatim from `docs/M3_3_IO_MAP.md`.
 */
export const DESCENT_MONITOR_V1_UNRESOLVED_MAPPINGS: readonly MonitorBlockReason[] = [
  {
    code: "unresolved-sensor-mapping",
    detail:
      "Landing-radar altitude (RNRAD via RADARUPT + CHAN33) — no emulator API drives RADARUPT + counter fill.",
    reference: "docs/M3_3_IO_MAP.md#row-1",
  },
  {
    code: "unresolved-sensor-mapping",
    detail:
      "Landing-radar velocity beams (RNRAD via RADARUPT + CHAN13 select bits) — same root cause as row 1.",
    reference: "docs/M3_3_IO_MAP.md#row-2",
  },
  {
    code: "unresolved-sensor-mapping",
    detail:
      "PIPA increments X/Y/Z (PIPAX/Y/Z counters at 0o37/0o40/0o41 via Pinc/Minc) — CDU drain budget unproven; no hardware-model injection path.",
    reference: "docs/M3_3_IO_MAP.md#row-3",
  },
  {
    code: "cdu-drain-budget-unproven",
    detail:
      "CDU FIFO capacity, overflow behavior, drain cadence, and max safe production rate over a 20 ms mission tick are not yet proven from pinned source.",
    reference: "docs/M3_3_IO_MAP.md",
  },
] as const;

// ---------------------------------------------------------------------------
// Command-shape validation (pure — no side effects, no queue mutation)
// ---------------------------------------------------------------------------

export type SetMonitorProfileCommandRejection =
  | "stale-simulation-epoch"
  | "stale-command"
  | "not-tick-aligned"
  | "unsupported-profile";

export interface SetMonitorProfileCommandValidationOk {
  readonly ok: true;
  readonly command: ReservedSetMonitorProfileCommand;
}

export interface SetMonitorProfileCommandValidationRejected {
  readonly ok: false;
  readonly reason: SetMonitorProfileCommandRejection;
  readonly message: string;
}

export type SetMonitorProfileCommandValidation =
  | SetMonitorProfileCommandValidationOk
  | SetMonitorProfileCommandValidationRejected;

/**
 * Validate the epoch, cursor, and tick-boundary alignment of a proposed
 * `sim:set-monitor-profile` command. Pure — does NOT enqueue, does NOT
 * consult the AGC WASM, does NOT arm anything.
 *
 * @param cmd                the proposed command
 * @param currentEpoch       runtime `simulationEpoch` at validation time
 * @param acceptedCursorUs   runtime `acceptedCursorUs` at validation time
 * @param missionTickUs      the tick period (20_000 µs); required for
 *                           tick-boundary alignment
 */
export function validateSetMonitorProfileCommand(
  cmd: ReservedSetMonitorProfileCommand,
  currentEpoch: number,
  acceptedCursorUs: number,
  missionTickUs: number,
): SetMonitorProfileCommandValidation {
  if (!SUPPORTED_MONITOR_PROFILES.includes(cmd.profile)) {
    return {
      ok: false,
      reason: "unsupported-profile",
      message: `Unsupported monitor profile: ${String(cmd.profile)}`,
    };
  }
  if (cmd.simulationEpoch !== currentEpoch) {
    return {
      ok: false,
      reason: "stale-simulation-epoch",
      message: `command epoch ${cmd.simulationEpoch} != runtime epoch ${currentEpoch}`,
    };
  }
  if (cmd.applyAtMissionTimeUs <= acceptedCursorUs) {
    return {
      ok: false,
      reason: "stale-command",
      message: `applyAtMissionTimeUs ${cmd.applyAtMissionTimeUs} <= cursor ${acceptedCursorUs}`,
    };
  }
  if (missionTickUs <= 0 || cmd.applyAtMissionTimeUs % missionTickUs !== 0) {
    return {
      ok: false,
      reason: "not-tick-aligned",
      message: `applyAtMissionTimeUs ${cmd.applyAtMissionTimeUs} is not aligned to a ${missionTickUs} µs mission tick`,
    };
  }
  return { ok: true, command: cmd };
}
