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
  // ---------- CHAN30 (input discretes, ALL active-low) --------------------
  {
    id: "chan30.bit03.engine-armed",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 2, // bit 3 (1-indexed)
    polarity: "active-low",
    physicalMeaning: "ENGINE ARMED SIGNAL (signal present = DPS armed)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:150 (bit 3); inversion note :143-144; read at BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:916",
    hardwarePath: "packet_write(0o30, word) — steady-state discrete",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit05.auto-throttle",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 4, // bit 5
    polarity: "active-low",
    physicalMeaning:
      "AUTO THROTTLE; COMPUTER CONTROL OF DESCENT ENGINE (signal present = LGC throttle authority)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:152 (bit 5); inversion note :143-144",
    hardwarePath: "packet_write(0o30, word)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit09.iss-operate",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 8, // bit 9
    polarity: "active-low",
    physicalMeaning:
      "IMU OPERATE WITH NO MALFUNCTION (signal present = ISS in OPERATE, no malfunction)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:157 (bit 9); inversion note :143-144",
    hardwarePath: "packet_write(0o30, word)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit10.lgc-in-control",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 9, // bit 10
    polarity: "active-low",
    physicalMeaning:
      "LM COMPUTER (NOT AGS) HAS CONTROL OF LM (signal present = LGC in control)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:158 (bit 10); inversion note :143-144",
    hardwarePath: "packet_write(0o30, word)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit12.imu-cdu-fail",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 11, // bit 12
    polarity: "active-low",
    physicalMeaning:
      "IMU CDU FAIL (signal present = ISS CDU malfunction). Encoded from imuCduHealthy === false.",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:160 (bit 12); inversion note :143-144",
    hardwarePath: "packet_write(0o30, word)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan30.bit13.imu-fail",
    status: "mapped",
    channel: 0o30,
    mask: 1 << 12, // bit 13
    polarity: "active-low",
    physicalMeaning:
      "IMU FAIL (signal present = malfunction of IMU stabilization loops). Encoded from imuHealthy === false.",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:161 (bit 13); inversion note :143-144",
    hardwarePath: "packet_write(0o30, word)",
    validStates: "always valid",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },

  // ---------- CHAN33 (LR + PIPA status discretes, ALSO active-low) --------
  // Corrected in M3.3B: the inversion note at :143-144 covers channels
  // 30-33 inclusive, so these are NOT active-high.
  {
    id: "chan33.bit05.lr-range-good",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 4, // bit 5
    polarity: "active-low",
    physicalMeaning: "LR RANGE DATA GOOD",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:208 (bit 5); inversion note :143-144",
    hardwarePath: "packet_write(0o33, word) — steady-state discrete",
    validStates: "valid when landing radar is powered and range has acquired",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit06.lr-pos1",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 5, // bit 6
    polarity: "active-low",
    physicalMeaning: "LR POS1 (antenna in descent position 1)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:209 (bit 6); inversion note :143-144; gated at THE_LUNAR_LANDING.agc P63SPOT3",
    hardwarePath: "packet_write(0o33, word)",
    validStates: "valid when LR powered",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit07.lr-pos2",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 6, // bit 7
    polarity: "active-low",
    physicalMeaning: "LR POS2 (antenna in approach position 2)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:210 (bit 7); inversion note :143-144",
    hardwarePath: "packet_write(0o33, word)",
    validStates: "valid when LR powered",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit08.lr-velocity-good",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 7, // bit 8
    polarity: "active-low",
    physicalMeaning: "LR VEL DATA GOOD",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:212 (bit 8); inversion note :143-144",
    hardwarePath: "packet_write(0o33, word)",
    validStates: "valid when LR velocity beams have acquired",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit09.lr-range-low-scale",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 8, // bit 9
    polarity: "active-low",
    physicalMeaning:
      "LR RANGE LOW SCALE (signal present = radar reporting on the low range scale)",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:213 (bit 9); inversion note :143-144; consumed by SCALECHK in P20-P25.agc",
    hardwarePath: "packet_write(0o33, word)",
    validStates: "valid when LR powered",
    requiredForProfiles: ["discrete-observer-v0", "descent-monitor-v1"],
  },
  {
    id: "chan33.bit13.pipa-fail",
    status: "mapped",
    channel: 0o33,
    mask: 1 << 12, // bit 13
    polarity: "active-low",
    physicalMeaning:
      "PIPA FAIL (signal present = accelerometer failure). Encoded from pipaHealthy === false.",
    sourceCitation:
      "Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:217 (bit 13); inversion note :143-144",
    hardwarePath: "packet_write(0o33, word)",
    validStates: "always valid",
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
  // NOTE: `unresolved.pipa-increments` was REMOVED in M3.3C Phase 2. The
  // PIPA ΔV pulse weight is now resolved (1 pulse = 1.00 cm/s) and PIPA is
  // a COUNTER, not a discrete bit, so it lives in MONITOR_COUNTER_REGISTRY
  // below. See docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md.


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
// M3.3C Phase 2 — COUNTER registry (unprogrammed-sequence inputs)
// ---------------------------------------------------------------------------
//
// Counters are a DIFFERENT bus mechanism from discrete channel bits: they are
// driven by unprogrammed increment sequences (PINC/MINC/PCDU/MCDU/SHINC), not
// by packet writes, and they carry a PHYSICAL SCALE rather than a polarity.
// They therefore get their own table with its own gate, so a resolved scale
// can never be confused with a resolved discrete bit.

export interface MonitorCounterMapping {
  readonly id: string;
  readonly status: SignalMappingStatus;
  /** Erasable counter address (octal in source; decimal here). */
  readonly counterAddress: number;
  readonly counterName: string;
  /** Increment types the HOST may drive for this counter. */
  readonly incrementTypes: readonly ("PINC" | "MINC" | "PCDU" | "MCDU" | "SHINC")[];
  /** Physical quantity one pulse represents, in `unit`. `null` = unresolved. */
  readonly unitPerPulse: number | null;
  readonly unit: string;
  readonly physicalMeaning: string;
  readonly sourceCitation: string;
  readonly hardwarePath: string;
  readonly validStates: string;
  readonly requiredForProfiles: readonly AgcMonitorProfile[];
}

export const MONITOR_COUNTER_REGISTRY: readonly MonitorCounterMapping[] = [
  {
    id: "pipa.x.delta-v-pulse",
    status: "mapped",
    counterAddress: 0o37,
    counterName: "PIPAX",
    incrementTypes: ["PINC", "MINC"],
    unitPerPulse: 0.01,
    unit: "m/s (exactly 1 cm/s)",
    physicalMeaning:
      "Stable-member X-axis ΔV increment sensed by the LM PIPA (PINC = +ΔV, MINC = -ΔV).",
    sourceCitation:
      "Draper 'Design Survey of the Apollo Inertial Subsystem' (Mar 1970, NTRS 19700018941) Fig.4-3 p.66 'AV LEM 1.0 CM/SEC/PULSE'; Luminary099/SERVICER.agc:192,219; docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md",
    hardwarePath: "agc_hw_input_apply — unprogrammed PINC/MINC on 0o37",
    validStates: "valid whenever the PIPAs are powered and not failed",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "pipa.y.delta-v-pulse",
    status: "mapped",
    counterAddress: 0o40,
    counterName: "PIPAY",
    incrementTypes: ["PINC", "MINC"],
    unitPerPulse: 0.01,
    unit: "m/s (exactly 1 cm/s)",
    physicalMeaning:
      "Stable-member Y-axis ΔV increment sensed by the LM PIPA.",
    sourceCitation:
      "Draper 'Design Survey of the Apollo Inertial Subsystem' (Mar 1970, NTRS 19700018941) Fig.4-3 p.66; Luminary099/SERVICER.agc:192,219",
    hardwarePath: "agc_hw_input_apply — unprogrammed PINC/MINC on 0o40",
    validStates: "valid whenever the PIPAs are powered and not failed",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "pipa.z.delta-v-pulse",
    status: "mapped",
    counterAddress: 0o41,
    counterName: "PIPAZ",
    incrementTypes: ["PINC", "MINC"],
    unitPerPulse: 0.01,
    unit: "m/s (exactly 1 cm/s)",
    physicalMeaning:
      "Stable-member Z-axis ΔV increment sensed by the LM PIPA.",
    sourceCitation:
      "Draper 'Design Survey of the Apollo Inertial Subsystem' (Mar 1970, NTRS 19700018941) Fig.4-3 p.66; Luminary099/SERVICER.agc:192,219",
    hardwarePath: "agc_hw_input_apply — unprogrammed PINC/MINC on 0o41",
    validStates: "valid whenever the PIPAs are powered and not failed",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "lr.range.rnrad-serial-word",
    status: "mapped",
    counterAddress: 0o46,
    counterName: "RNRAD",
    incrementTypes: ["SHINC"],
    unitPerPulse: 1.079 * 0.3048,
    unit: "m per RNRAD bit (HSCAL 1.079 ft/bit)",
    physicalMeaning:
      "Landing-radar RANGE (altitude) word shifted serially into RNRAD, answered by RADARUPT.",
    sourceCitation:
      "Luminary099/CONTROLLED_CONSTANTS.agc HSCAL; docs/M3_3B2_SCALE_ARCHAEOLOGY.md",
    hardwarePath: "agc_landing_radar_update_apply — 15 serial bits + RADARUPT",
    validStates:
      "valid only when AGC-solicited via CHAN13 select+ACTIVITY; no host-timed cadence is source-supported",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "cdu.x.angle",
    status: "unresolved",
    counterAddress: 0o32,
    counterName: "CDUX",
    incrementTypes: ["PCDU", "MCDU"],
    unitPerPulse: null,
    unit: "unresolved",
    physicalMeaning: "IMU CDU inner-gimbal angle increment.",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-4",
    hardwarePath: "agc_hw_input_apply — PCDU/MCDU on 0o32",
    validStates: "unresolved — CDU drain budget unproven",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "cdu.y.angle",
    status: "unresolved",
    counterAddress: 0o33,
    counterName: "CDUY",
    incrementTypes: ["PCDU", "MCDU"],
    unitPerPulse: null,
    unit: "unresolved",
    physicalMeaning: "IMU CDU middle-gimbal angle increment.",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-4",
    hardwarePath: "agc_hw_input_apply — PCDU/MCDU on 0o33",
    validStates: "unresolved — CDU drain budget unproven",
    requiredForProfiles: ["descent-monitor-v1"],
  },
  {
    id: "cdu.z.angle",
    status: "unresolved",
    counterAddress: 0o34,
    counterName: "CDUZ",
    incrementTypes: ["PCDU", "MCDU"],
    unitPerPulse: null,
    unit: "unresolved",
    physicalMeaning: "IMU CDU outer-gimbal angle increment.",
    sourceCitation: "docs/M3_3_IO_MAP.md#row-4",
    hardwarePath: "agc_hw_input_apply — PCDU/MCDU on 0o34",
    validStates: "unresolved — CDU drain budget unproven",
    requiredForProfiles: ["descent-monitor-v1"],
  },
] as const;

/** Every mapped counter required by `profile`. */
export function mappedCountersForProfile(
  profile: AgcMonitorProfile,
): readonly MonitorCounterMapping[] {
  return MONITOR_COUNTER_REGISTRY.filter(
    (c) => c.status === "mapped" && c.requiredForProfiles.includes(profile),
  );
}

/** Every unresolved counter required by `profile`. A non-empty result is a
 *  hard block for that profile. */
export function unresolvedCountersForProfile(
  profile: AgcMonitorProfile,
): readonly MonitorCounterMapping[] {
  return MONITOR_COUNTER_REGISTRY.filter(
    (c) => c.status === "unresolved" && c.requiredForProfiles.includes(profile),
  );
}

/** Structural validation for the counter table: unique ids, plausible
 *  erasable addresses, and a positive finite scale on every mapped row. */
export function validateCounterRegistry(
  registry: readonly MonitorCounterMapping[] = MONITOR_COUNTER_REGISTRY,
): readonly string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenAddresses = new Map<number, string>();
  for (const c of registry) {
    if (seenIds.has(c.id)) errors.push(`duplicate counter id ${c.id}`);
    seenIds.add(c.id);
    if (!Number.isInteger(c.counterAddress) || c.counterAddress < 0o30 || c.counterAddress > 0o60) {
      errors.push(
        `counter ${c.id} address 0o${c.counterAddress.toString(8)} outside the AGC counter block 0o30-0o60`,
      );
    }
    const prev = seenAddresses.get(c.counterAddress);
    if (prev !== undefined && prev !== c.id) {
      errors.push(
        `counter address 0o${c.counterAddress.toString(8)} claimed by both ${prev} and ${c.id}`,
      );
    }
    seenAddresses.set(c.counterAddress, c.id);
    if (c.incrementTypes.length === 0) {
      errors.push(`counter ${c.id} declares no increment types`);
    }
    if (c.status === "mapped") {
      if (c.unitPerPulse === null || !Number.isFinite(c.unitPerPulse) || c.unitPerPulse <= 0) {
        errors.push(`mapped counter ${c.id} has no positive finite scale`);
      }
    } else if (c.unitPerPulse !== null) {
      errors.push(`unresolved counter ${c.id} must not declare a scale`);
    }
  }
  return errors;
}


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
