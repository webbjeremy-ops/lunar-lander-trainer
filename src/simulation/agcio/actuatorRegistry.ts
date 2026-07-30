// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.c — Machine-readable AGC OUTPUT (actuator) mapping registry.
//
// PURE data + pure validation. This module never instantiates or calls the
// WASM, never touches the Worker, never arms the extension trace.
//
// Every row is derived from docs/M3_3_IO_MAP.md. Pulse-vs-level semantics
// are taken from the cited Luminary099 source behavior, NEVER inferred from
// the signal's name.

import type { AgcMonitorProfile } from "./types";

export type ActuatorSemantics =
  | "command-pulse"
  | "level"
  | "activity"
  | "counter-operation";

export type ActuatorMappingStatus = "mapped" | "unresolved";

export type ActuatorSource =
  | { readonly kind: "channel-bit"; readonly channel: number; readonly mask: number }
  | { readonly kind: "output-counter"; readonly address: number };

export interface ActuatorSignalMapping {
  readonly id: string;
  readonly source: ActuatorSource;
  readonly meaning: string;
  readonly semantics: ActuatorSemantics;
  readonly status: ActuatorMappingStatus;
  readonly sourceCitation: string;
  readonly requiredForProfiles: readonly AgcMonitorProfile[];
  /** Set only where two rows are documented to share a channel word and the
   *  overlap is explicitly permitted (e.g. an aggregate word row). */
  readonly overlapPermittedWith?: readonly string[];
  /** True only for rows whose numeric physical scale is source-proven. A
   *  throttle-magnitude row may NEVER set this while row 17 of the I/O map
   *  remains unresolved. */
  readonly numericScaleResolved?: boolean;
}

/** Channel-word width in the AGC: 15 bits. */
export const AGC_CHANNEL_WORD_MASK = 0o77777;

/** Output-counter addresses the HW-I/O v3 capability table exposes with
 *  ROLE_OBSERVABLE_OUT. P5.c decodes THRUST only. */
export const OBSERVABLE_OUTPUT_COUNTER_ADDRESSES: readonly number[] = [0o55];

/** Native operation identifiers accepted in the output-counter trace
 *  (`AgcOutputTraceEntry.operation`). 0 = AGC store (WRITE); the remaining
 *  values mirror the yaAGC `UnprogrammedIncrement` switch as reproduced in
 *  third-party/virtualagc-fork/PATCHES/lovable-hwio/hwio.c:28-36. */
export const NATIVE_COUNTER_OPERATION_CODES: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 0o21, 0o23,
];


export const COUNTER_OPERATION_LABELS: { readonly [code: number]: string } = {
  0: "WRITE",
  1: "PCDU",
  2: "MINC",
  3: "MCDU",
  4: "DINC",
  5: "SHINC",
  6: "SHANC",
  0o21: "PCDUX",
  0o23: "MCDUX",
};
// NB: HWIO_INC_PINC === 0 collides with the WRITE tag in the native trace
// encoding; P5.c therefore treats operation 0 as "native code 0" and never
// re-labels it as a physical action beyond the WRITE citation above.

export const ACTUATOR_SIGNAL_REGISTRY: readonly ActuatorSignalMapping[] = [
  {
    id: "chan11.bit13.engine-on",
    source: { kind: "channel-bit", channel: 0o11, mask: 1 << 12 },
    meaning: "DPS ENGINE ON discrete commanded by the LGC",
    // Source behavior: Luminary sets/resets the bit in the CHAN11 output
    // word and the word persists on the bus until rewritten — a LEVEL, not
    // an edge pulse.
    semantics: "level",
    status: "mapped",
    sourceCitation:
      "docs/M3_3_IO_MAP.md#row-14; Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:78-96; BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:415; P70-P71.agc:153",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
    overlapPermittedWith: ["chan11.bit14.engine-off"],
  },
  {
    id: "chan11.bit14.engine-off",
    source: { kind: "channel-bit", channel: 0o11, mask: 1 << 13 },
    meaning: "DPS ENGINE OFF discrete commanded by the LGC",
    semantics: "level",
    status: "mapped",
    sourceCitation:
      "docs/M3_3_IO_MAP.md#row-15; Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:78-96",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
    overlapPermittedWith: ["chan11.bit13.engine-on"],
  },
  {
    id: "chan14.bit04.thrust-drive-activity",
    source: { kind: "channel-bit", channel: 0o14, mask: 1 << 3 },
    meaning: "THRUST DRIVE ACTIVITY — DPS throttle drive is being pulsed",
    // Source behavior: written with `WOR CHAN14` around the drive burst
    // (LANDING_ANALOG_DISPLAYS.agc:500). The map documents it as an
    // ACTIVITY indication qualifying the (unresolved) magnitude, not a
    // latched engine state.
    semantics: "activity",
    status: "mapped",
    sourceCitation:
      "docs/M3_3_IO_MAP.md#row-18; Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:113; LANDING_ANALOG_DISPLAYS.agc:500; IMU_MODE_SWITCHING_ROUTINES.agc:251",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "counter.055.thrust-raw-operations",
    source: { kind: "output-counter", address: 0o55 },
    meaning:
      "Raw THRUST output-counter operations (lossless observation only — physical throttle scale NOT resolved)",
    semantics: "counter-operation",
    status: "mapped",
    sourceCitation:
      "docs/M3_3_IO_MAP.md#row-17; Luminary099/ERASABLE_ASSIGNMENTS.agc:137; THROTTLE_CONTROL_ROUTINES.agc:127; hwio.c trace ring (docs/M3_3A2_P2.md §5)",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
    numericScaleResolved: false,
  },
  {
    id: "counter.055.thrust-magnitude-fraction",
    source: { kind: "output-counter", address: 0o55 },
    meaning:
      "DPS throttle command MAGNITUDE as a physical fraction — pulse-to-thrust scale and accumulation semantics UNRESOLVED",
    semantics: "counter-operation",
    status: "unresolved",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-17 (status: unresolved)",
    requiredForProfiles: ["descent-monitor-v1"],
    overlapPermittedWith: ["counter.055.thrust-raw-operations"],
    numericScaleResolved: false,
  },
];

export interface ActuatorRegistryError {
  readonly mappingId: string | null;
  readonly message: string;
}

/** Pure structural validation of the registry. */
export function validateActuatorRegistry(
  registry: readonly ActuatorSignalMapping[] = ACTUATOR_SIGNAL_REGISTRY,
): readonly ActuatorRegistryError[] {
  const errors: ActuatorRegistryError[] = [];
  const seen = new Set<string>();
  const channelOwners = new Map<string, string>();

  for (const row of registry) {
    if (seen.has(row.id)) {
      errors.push({ mappingId: row.id, message: "duplicate mapping id" });
    }
    seen.add(row.id);

    if (row.status === "mapped" && row.sourceCitation.trim().length === 0) {
      errors.push({ mappingId: row.id, message: "mapped row without source citation" });
    }

    if (row.source.kind === "channel-bit") {
      const { channel, mask } = row.source;
      if (!Number.isInteger(channel) || channel <= 0 || channel > 0o777) {
        errors.push({ mappingId: row.id, message: `invalid channel ${channel}` });
      }
      if (
        !Number.isInteger(mask) ||
        mask <= 0 ||
        (mask & ~AGC_CHANNEL_WORD_MASK) !== 0
      ) {
        errors.push({ mappingId: row.id, message: `invalid channel mask ${mask}` });
      }
      for (let bit = 0; bit < 15; bit++) {
        const b = 1 << bit;
        if ((mask & b) === 0) continue;
        const key = `${channel}:${b}`;
        const owner = channelOwners.get(key);
        if (owner && !(row.overlapPermittedWith ?? []).includes(owner)) {
          errors.push({
            mappingId: row.id,
            message: `bit overlap with ${owner} on channel ${channel.toString(8)} bit ${bit + 1} is not explicitly permitted`,
          });
        }
        if (!owner) channelOwners.set(key, row.id);
      }
    } else {
      const { address } = row.source;
      if (!OBSERVABLE_OUTPUT_COUNTER_ADDRESSES.includes(address)) {
        errors.push({
          mappingId: row.id,
          message: `unsupported output-counter address 0o${address.toString(8)}`,
        });
      }
    }

    // Hard safety gate: no numeric throttle magnitude may be declared
    // resolved while the pulse-to-thrust scale is unresolved.
    if (row.numericScaleResolved === true) {
      errors.push({
        mappingId: row.id,
        message:
          "numeric throttle magnitude mapping is forbidden while the THRUST scale remains unresolved",
      });
    }
  }

  return errors;
}

export function mappedActuatorSignals(
  profile: AgcMonitorProfile,
  registry: readonly ActuatorSignalMapping[] = ACTUATOR_SIGNAL_REGISTRY,
): readonly ActuatorSignalMapping[] {
  return registry.filter(
    (r) => r.status === "mapped" && r.requiredForProfiles.includes(profile),
  );
}

export function unresolvedActuatorSignals(
  profile: AgcMonitorProfile,
  registry: readonly ActuatorSignalMapping[] = ACTUATOR_SIGNAL_REGISTRY,
): readonly ActuatorSignalMapping[] {
  return registry.filter(
    (r) => r.status === "unresolved" && r.requiredForProfiles.includes(profile),
  );
}

/** Convenience octal labels for diagnostics. */
export function actuatorSignalLabel(row: ActuatorSignalMapping): string {
  return row.source.kind === "channel-bit"
    ? `CHAN${row.source.channel.toString(8).padStart(2, "0")} mask 0o${row.source.mask.toString(8)}`
    : `COUNTER 0o${row.source.address.toString(8)}`;
}

/** Channels P5.c is permitted to decode. */
export const EXPECTED_ACTUATOR_CHANNELS: readonly number[] = [0o11, 0o14];

/** Output-counter address P5.c is permitted to decode. */
export const THRUST_COUNTER_ADDRESS = 0o55;

export const ENGINE_ON_MASK = 1 << 12;
export const ENGINE_OFF_MASK = 1 << 13;
export const THRUST_DRIVE_ACTIVITY_MASK = 1 << 3;

export const THRUST_DIAGNOSTIC_HEADER = [
  "RAW AGC THRUST COUNTER ACTIVITY",
  "PHYSICAL THROTTLE SCALE NOT YET RESOLVED",
] as const;
