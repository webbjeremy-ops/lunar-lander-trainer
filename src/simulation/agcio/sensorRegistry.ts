// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.b — Source-mapping registry.
//
// PURE data + tiny pure helpers. This module never touches the AGC Worker,
// never arms the extension trace, never mutates any state. It is the sole
// authority the pure discrete encoder consults to derive (channel, mask,
// polarity) tuples. Numeric channel/mask constants MUST NOT be duplicated
// outside this file.
//
// Each row corresponds to a signal in docs/M3_3_IO_MAP.md. Only rows with
// status `"mapped"` are used by the encoder; `"unresolved"` rows are
// declared here so the descent-monitor-v1 gate has a machine-readable list
// of what is still missing.
//
// Polarity convention (M3.3B correction):
//   Each row names the RAW AGC SIGNAL as Luminary names it. `polarity`
//   describes how "signal present" is encoded on the bus:
//     - "active-high": signal present encodes as bit = 1
//     - "active-low":  signal present encodes as bit = 0
//   The encoder therefore derives a SIGNAL-PRESENT boolean per row; it never
//   applies a second inversion of its own.
//
// Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:143-144 states
// verbatim: "ALL BITS IN CHANNELS 30-33 ARE INVERTED AS SENSED BY THE
// PROGRAM, SO THAT A VALUE OF ZERO MEANS THAT THE INDICATED SIGNAL IS
// PRESENT." That note covers channels 30, 31, 32 AND 33 — so every CHAN30
// *and* CHAN33 row below is "active-low". (The pre-M3.3B registry wrongly
// treated CHAN33 as active-high and additionally double-inverted the IMU
// FAIL row by naming it "imu-healthy"; both are corrected here.)

import type { AgcMonitorProfile } from "./types";

export type SignalPolarity = "active-high" | "active-low";

export type SignalMappingStatus = "mapped" | "unresolved";

export interface MonitorSignalMapping {
  readonly id: string;
  readonly status: SignalMappingStatus;
  /** AGC channel number (octal in source; stored as decimal here). */
  readonly channel: number;
  /** Bit mask owned by this signal within `channel`. Exactly one bit for
   *  every mapped discrete in the P5.b registry. */
  readonly mask: number;
  readonly polarity: SignalPolarity;
  readonly physicalMeaning: string;
  readonly sourceCitation: string;
  readonly hardwarePath: string;
  readonly validStates: string;
  readonly requiredForProfiles: readonly AgcMonitorProfile[];
}

/** Single source of truth for every profile-owned AGC input bit. */
export const MONITOR_SIGNAL_REGISTRY: readonly MonitorSignalMapping[] = [
  // ---------- CHAN30 (input discretes, active-low) ------------------------
  {
    id: "chan30.bit03.engine-armed",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 2, // bit 3 (1-indexed)
    polarity: "active-low",
    physicalMeaning: "DPS engine armed by crew",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:152 (bit 3, inverted); BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:916",
    hardwarePath: "packet_write(0o30, mask) — steady-state discrete",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit05.auto-throttle",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 4, // bit 5
    polarity: "active-low",
    physicalMeaning: "Computer thrust control enabled (AUTO THROTTLE)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:154 (bit 5, inverted)",
    hardwarePath: "packet_write(0o30, mask)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit09.iss-operate",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 8, // bit 9
    polarity: "active-low",
    physicalMeaning: "ISS in OPERATE mode",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:158 (bit 9, inverted)",
    hardwarePath: "packet_write(0o30, mask)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit10.lgc-in-control",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 9, // bit 10
    polarity: "active-low",
    physicalMeaning: "LGC-in-control (guidance authority)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:159 (bit 10, inverted)",
    hardwarePath: "packet_write(0o30, mask)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit13.imu-healthy",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 12, // bit 13 (IMU FAIL, inverted -> healthy)
    polarity: "active-low",
    physicalMeaning: "IMU healthy (IMU FAIL discrete de-asserted)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:162 (bit 13, inverted)",
    hardwarePath: "packet_write(0o30, mask)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },

  // ---------- CHAN33 (LR discretes, active-high) -------------------------
  {
    id: "chan33.bit05.lr-range-good",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 4, // bit 5
    polarity: "active-high",
    physicalMeaning: "Landing-radar RANGE DATA GOOD",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:184 (bit 5)",
    hardwarePath:
      "packet_write(0o33, mask) — steady-state discrete; word path unresolved (rows 1/2)",
    validStates: "valid when landing radar is powered and acquired",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit06.lr-pos1",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 5, // bit 6
    polarity: "active-high",
    physicalMeaning: "Landing-radar antenna in POS1",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:185 (bit 6)",
    hardwarePath: "packet_write(0o33, mask)",
    validStates: "valid when LR powered",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit07.lr-pos2",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 6, // bit 7
    polarity: "active-high",
    physicalMeaning: "Landing-radar antenna in POS2",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:186 (bit 7)",
    hardwarePath: "packet_write(0o33, mask)",
    validStates: "valid when LR powered",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit08.lr-velocity-good",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 7, // bit 8
    polarity: "active-high",
    physicalMeaning: "Landing-radar VELOCITY DATA GOOD",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:187 (bit 8)",
    hardwarePath:
      "packet_write(0o33, mask) — steady-state discrete; word path unresolved (row 2)",
    validStates: "valid when LR velocity beams have acquired",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },

  // ---------- Unresolved rows — declared, never encoded ------------------
  {
    id: "unresolved.lr-range-word",
    status: "unresolved",
    channel: -1,
    mask: 0,
    polarity: "active-high",
    physicalMeaning: "Landing-radar altitude word into RNRAD via RADARUPT",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-1",
    hardwarePath: "RADARUPT + RNRAD counter fill — no emulator API",
    validStates: "unresolved",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "unresolved.lr-velocity-word",
    status: "unresolved",
    channel: -1,
    mask: 0,
    polarity: "active-high",
    physicalMeaning: "Landing-radar velocity beam word into RNRAD",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-2",
    hardwarePath: "RADARUPT + RNRAD counter fill — no emulator API",
    validStates: "unresolved",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "unresolved.pipa-increments",
    status: "unresolved",
    channel: -1,
    mask: 0,
    polarity: "active-high",
    physicalMeaning: "PIPA X/Y/Z increments via Pinc/Minc",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-3",
    hardwarePath: "Pinc/Minc counter pulses at IMU cadence — no host-input API in P5.b",
    validStates: "unresolved",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "unresolved.cdu-angles",
    status: "unresolved",
    channel: -1,
    mask: 0,
    polarity: "active-high",
    physicalMeaning: "IMU CDU angles X/Y/Z via Pinc/Minc",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-4",
    hardwarePath: "Pinc/Minc counter pulses — CDU drain budget unproven",
    validStates: "unresolved",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "unresolved.throttle-magnitude",
    status: "unresolved",
    channel: -1,
    mask: 0,
    polarity: "active-high",
    physicalMeaning: "DPS throttle magnitude (THRUST counter 0o55)",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-17",
    hardwarePath: "Output-counter unprogrammed sequence — trace not armed in P5.b",
    validStates: "unresolved",
    requiredForProfiles: ["descent-monitor-v1"],
  },
] as const;

// ---------------------------------------------------------------------------
// Pure registry helpers
// ---------------------------------------------------------------------------

const MAX_CHANNEL_WORD = 0o77777; // 15-bit AGC channel word

/** Every mapped row required by `profile`. */
export function mappedSignalsForProfile(
  profile: AgcMonitorProfile,
): readonly MonitorSignalMapping[] {
  return MONITOR_SIGNAL_REGISTRY.filter(
    (m) => m.status === "mapped" && m.requiredForProfiles.includes(profile),
  );
}

/** Every unresolved row required by `profile`. */
export function unresolvedSignalsForProfile(
  profile: AgcMonitorProfile,
): readonly MonitorSignalMapping[] {
  return MONITOR_SIGNAL_REGISTRY.filter(
    (m) => m.status === "unresolved" && m.requiredForProfiles.includes(profile),
  );
}

export interface RegistryValidationError {
  readonly kind:
    | "mask-not-single-bit"
    | "mask-outside-channel-word"
    | "duplicate-mapping-id"
    | "overlapping-ownership"
    | "channel-out-of-range";
  readonly message: string;
  readonly mappingId: string;
}

/** Validate the registry for structural correctness. Called by tests and by
 *  the P5.a monitor-entry gate for `descent-monitor-v1`. Pure. */
export function validateRegistry(
  registry: readonly MonitorSignalMapping[] = MONITOR_SIGNAL_REGISTRY,
): readonly RegistryValidationError[] {
  const errors: RegistryValidationError[] = [];
  const seenIds = new Set<string>();
  // Track owned bits per channel, keyed by channel -> id owning each bit.
  const ownersByChannel = new Map<number, Map<number, string>>();

  for (const m of registry) {
    if (seenIds.has(m.id)) {
      errors.push({
        kind: "duplicate-mapping-id",
        message: `duplicate mapping id ${m.id}`,
        mappingId: m.id,
      });
      continue;
    }
    seenIds.add(m.id);
    if (m.status !== "mapped") continue;

    if (m.channel < 0 || m.channel > 0o777) {
      errors.push({
        kind: "channel-out-of-range",
        message: `channel ${m.channel} out of range for ${m.id}`,
        mappingId: m.id,
      });
      continue;
    }
    if ((m.mask & ~MAX_CHANNEL_WORD) !== 0 || m.mask === 0) {
      errors.push({
        kind: "mask-outside-channel-word",
        message: `mask 0o${m.mask.toString(8)} for ${m.id} exceeds 15-bit AGC channel word`,
        mappingId: m.id,
      });
      continue;
    }
    // P5.b registry: every mapped signal is exactly one bit.
    if ((m.mask & (m.mask - 1)) !== 0) {
      errors.push({
        kind: "mask-not-single-bit",
        message: `mask 0o${m.mask.toString(8)} for ${m.id} is not a single bit`,
        mappingId: m.id,
      });
      continue;
    }

    let owners = ownersByChannel.get(m.channel);
    if (!owners) {
      owners = new Map();
      ownersByChannel.set(m.channel, owners);
    }
    for (let b = 0; b < 15; b++) {
      const bit = 1 << b;
      if ((m.mask & bit) === 0) continue;
      const prev = owners.get(bit);
      if (prev !== undefined && prev !== m.id) {
        errors.push({
          kind: "overlapping-ownership",
          message: `bit 0o${bit.toString(8)} on chan 0o${m.channel.toString(8)} owned by both ${prev} and ${m.id}`,
          mappingId: m.id,
        });
      } else {
        owners.set(bit, m.id);
      }
    }
  }
  return errors;
}
