// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — read-only shadow observables and the delivered-vs-consumed
// distinction.
//
// Two separate concepts that must NEVER be merged into one indicator:
//
//   DELIVERED  — the host handed a pulse / word to the hardware interface.
//   CONSUMED   — the rope itself read, drained or acted on it.
//
// Consumption is only ever asserted from a source-cited rope behaviour, never
// inferred from a counter changing after a reset or a pad load.

import { THRUST_SEMANTICS_WARNING } from "./shadowProfile";

export type ObservableConfidence = "source-derived" | "probable" | "unresolved";

export interface ShadowMonitorField {
  readonly symbol: string;
  readonly addressOrChannel: string;
  /** `null` means the scale is UNRESOLVED and the value stays raw octal. */
  readonly scale: string | null;
  readonly meaning: string;
  readonly ropeCitations: readonly string[];
  readonly confidence: ObservableConfidence;
}

const ROPE = "Luminary099 @911e5c0283c629c50cb97666f34065e8c07d71a5";

export const SHADOW_MONITOR_FIELDS: readonly ShadowMonitorField[] = [
  {
    symbol: "MODREG",
    addressOrChannel: "0o1011",
    scale: "integer major mode",
    meaning: "Current major mode (63 = P63). Observed only; never written.",
    ropeCitations: [`${ROPE} ERASABLE_ASSIGNMENTS.agc`, `${ROPE} THE_LUNAR_LANDING.agc:40`],
    confidence: "source-derived",
  },
  {
    symbol: "FLAGWRD7 / AVEGFBIT",
    addressOrChannel: "0o103 bit5 (0o20)",
    scale: "flag bit",
    meaning: "AVEGFLAG — Average-G (Servicer) desired.",
    ropeCitations: [`${ROPE} FLAGWORD_ASSIGNMENTS.agc:809-810`, `${ROPE} SERVICER.agc:53`],
    confidence: "source-derived",
  },
  {
    symbol: "PHASE5",
    addressOrChannel: "0o763",
    scale: "restart-group phase",
    meaning:
      "Non-zero when the Servicer restart group is running. Zero proves the Average-G loop was never started.",
    ropeCitations: [
      `${ROPE} SERVICER.agc:42-100 (PREREAD/GNUFAZE5)`,
      `${ROPE} BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:339-343 (REDO4.2 checks PHASE5)`,
    ],
    confidence: "source-derived",
  },
  {
    symbol: "WCHPHASE",
    addressOrChannel: "0o1351",
    scale: "-1 = pre-ignition, 0 = braking, 1 = approach, 2 = P66",
    meaning: "P63/P64/P66 guidance phase selector.",
    ropeCitations: [`${ROPE} THE_LUNAR_LANDING.agc:52-54`],
    confidence: "probable",
  },
  {
    symbol: "PIPAX / PIPAY / PIPAZ",
    addressOrChannel: "0o37 / 0o40 / 0o41",
    scale: "1 pulse = 0.01 m/s",
    meaning: "Native PIPA counters. Drained by PIPASR inside READACCS.",
    ropeCitations: [`${ROPE} SERVICER.agc:79-96 (READACCS -> PIPASR)`],
    confidence: "source-derived",
  },
  {
    symbol: "RN",
    addressOrChannel: "0o1220",
    scale: null,
    meaning: "Navigation position vector. UNRESOLVED SCALE — displayed as raw octal.",
    ropeCitations: [`${ROPE} ERASABLE_ASSIGNMENTS.agc`],
    confidence: "unresolved",
  },
  {
    symbol: "VN",
    addressOrChannel: "0o1226",
    scale: null,
    meaning: "Navigation velocity vector. UNRESOLVED SCALE — displayed as raw octal.",
    ropeCitations: [`${ROPE} ERASABLE_ASSIGNMENTS.agc`],
    confidence: "unresolved",
  },
  {
    symbol: "PIPTIME",
    addressOrChannel: "0o1234",
    scale: null,
    meaning: "Time tag of the last PIPA read. Written by the rope, never by the host.",
    ropeCitations: [`${ROPE} SERVICER.agc:48-49`],
    confidence: "probable",
  },
  {
    symbol: "FAILREG",
    addressOrChannel: "0o375..0o377",
    scale: "octal program-alarm codes",
    meaning: "Program-alarm history. Observed for alarm/restart loops.",
    ropeCitations: [`${ROPE} ALARM_AND_ABORT.agc`],
    confidence: "source-derived",
  },
  {
    symbol: "ALMCADR",
    addressOrChannel: "0o1363",
    scale: "raw CADR",
    meaning: "Address that raised the most recent alarm.",
    ropeCitations: [`${ROPE} ALARM_AND_ABORT.agc`],
    confidence: "probable",
  },
  {
    symbol: "THRUST (out-counter 0o55)",
    addressOrChannel: "output counter 0o55",
    scale: null,
    meaning: THRUST_SEMANTICS_WARNING,
    ropeCitations: ["docs/M3_3B2_FREEZE.md", "src/simulation/agcio/actuatorDecoder.ts"],
    confidence: "unresolved",
  },
  {
    symbol: "CHAN13 radar solicitation",
    addressOrChannel: "output channel 0o13",
    scale: "discrete bits",
    meaning:
      "Rope-generated landing-radar request. The host answers ONLY this; there is no host radar timer.",
    ropeCitations: ["docs/M3_3E_HARDWARE_INTERFACE_LAB_FREEZE.md"],
    confidence: "source-derived",
  },
];

export function monitorField(symbol: string): ShadowMonitorField {
  const f = SHADOW_MONITOR_FIELDS.find((x) => x.symbol === symbol);
  if (!f) throw new Error(`undeclared shadow monitor field: ${symbol}`);
  return f;
}

/** Raw octal presentation for any field whose scale is unresolved. */
export function presentObservable(field: ShadowMonitorField, raw: number): string {
  if (field.scale === null) return `0o${(raw & 0o77777).toString(8)} (UNRESOLVED SCALE)`;
  return String(raw);
}

// ---------------------------------------------------------------------------
// Delivered vs consumed
// ---------------------------------------------------------------------------

export interface SensorDeliveryCounts {
  readonly pipaPulsesDelivered: number;
  readonly pipaBatchesRefused: number;
  /** ΔV retained because a batch was refused, in PIPA pulses. */
  readonly pipaResidualPulses: number;
  readonly radarRequestsObserved: number;
  readonly radarResponsesDelivered: number;
  readonly radarUpdatesAccepted: number;
  /** No dynamic CDU interface exists in HW-I/O v4. */
  readonly cduStatus: "static-reconstructed" | "dynamic";
}

export type ConsumptionVerdict = "consumed" | "not-consumed" | "indeterminate";

export interface RopeConsumptionEvidence {
  readonly pipa: ConsumptionVerdict;
  /** Number of observed decreases of a PIPA counter across a stepped window. */
  readonly pipaDrainEvents: number;
  readonly averageGActive: boolean;
  /** PHASE5 non-zero proves the Servicer restart group is live. */
  readonly servicerRunning: boolean;
  readonly navigationStateEvolved: boolean;
  readonly radar: ConsumptionVerdict;
  readonly notes: readonly string[];
}

/**
 * Consumption is asserted ONLY from a rope-side drain, never from delivery.
 * A counter that only ever increases is proof of NON-consumption.
 */
export function classifyPipaConsumption(input: {
  readonly pulsesDelivered: number;
  readonly drainEvents: number;
  readonly servicerRunning: boolean;
}): ConsumptionVerdict {
  if (input.pulsesDelivered === 0) return "indeterminate";
  if (input.drainEvents > 0) return "consumed";
  return "not-consumed";
}

export function classifyRadarConsumption(input: {
  readonly requestsObserved: number;
  readonly responsesDelivered: number;
  readonly updatesAccepted: number;
}): ConsumptionVerdict {
  if (input.requestsObserved === 0) return "indeterminate";
  if (input.updatesAccepted > 0) return "consumed";
  return "not-consumed";
}
