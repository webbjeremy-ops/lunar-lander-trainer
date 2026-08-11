// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.12 — Bridged descent-monitor registers (PURE).
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// Luminary 099 runs authentically here, but it is not flying the vehicle, so
// the rope never enters P63/P64/P66 and never drives R1/R2/R3 with descent
// data. This module reproduces the register content the crew would have seen,
// from the game's own flight state, in Apollo display units. It is drawn as a
// clearly-labelled bridged strip and is NEVER injected into the AGC.
//
// Noun selection follows the published descent monitoring sequence:
//   before ignition   V06 N62  velocity / time-to-ignition / dV
//   P63 braking       V06 N63  velocity / altitude rate / altitude
//   P64 approach      V06 N64  time-to-go / LPD angle / altitude rate
//   P66 landing       V06 N60  forward velocity / altitude rate / altitude

const FT_PER_M = 1 / 0.3048;

/** ~7,600 ft high gate: P63 hands over to the approach phase. */
const HIGH_GATE_M = 7_600 * 0.3048;
/** ~500 ft low gate: the commander takes P66 rate-of-descent. */
const LOW_GATE_M = 500 * 0.3048;

export interface DescentMonitorInput {
  readonly altitudeM: number;
  /** Positive = climbing. */
  readonly radialSpeedMps: number;
  /** Downrange (horizontal) speed, m/s. */
  readonly tangentialSpeedMps: number;
  /** Microseconds until ignition; <= 0 once the burn has started. */
  readonly tigOffsetUs: number;
  /** Microseconds since ignition; 0 before TIG. */
  readonly sinceIgnitionUs: number;
  readonly burning: boolean;
  readonly terminal: boolean;
  /** True while the flashing V99 N62 ignition request is up (TIG-35 s → PRO). */
  readonly ignitionRequestFlashing?: boolean;
  /** Accumulated ΔV since the burn started, m/s (N62 R3). */
  readonly accumulatedDvMps?: number;
}

export interface DescentMonitorView {
  readonly program: string;
  readonly verb: string;
  readonly noun: string;
  readonly r1: string;
  readonly r2: string;
  readonly r3: string;
  /** Unit captions for R1/R2/R3, in the same order. */
  readonly units: readonly [string, string, string];
  readonly caption: string;
  /** True while the AGC is requesting a response (flashing verb/noun). */
  readonly flashing?: boolean;
}

/** Apollo-style 5-digit signed register text, e.g. "+00427". */
export function formatRegister(value: number, signed = true): string {
  const rounded = Math.round(Math.abs(value));
  const clamped = Math.min(99_999, rounded);
  const digits = String(clamped).padStart(5, "0");
  if (!signed) return digits;
  return `${value < 0 ? "-" : "+"}${digits}`;
}

/**
 * Luminary VEL3 scaling: XXXX.X ft/s shown as five digits with an implied
 * tenths place, e.g. 5569.0 ft/s → "+55690".
 */
export function formatTenths(value: number): string {
  return formatRegister(value * 10);
}

/**
 * Luminary MIN/SEC format: D1-D2 minutes, D3 blank, D4-D5 seconds
 * — e.g. 150 s → "+02 30".
 */
export function formatMinSec(seconds: number): string {
  const s = Math.max(0, Math.min(59 * 60 + 59, Math.round(Math.abs(seconds))));
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${seconds < 0 ? "-" : "+"}${String(mm).padStart(2, "0")} ${String(ss).padStart(2, "0")}`;
}

/** MMSS clock text used by the time registers (N64 R1). */
export function formatClockRegister(seconds: number): string {
  const s = Math.max(0, Math.min(59 * 60 + 59, Math.round(Math.abs(seconds))));
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${seconds < 0 ? "-" : "+"}${String(mm).padStart(2, "0")}${String(ss).padStart(2, "0")}0`;
}

export function descentMonitorFor(input: DescentMonitorInput): DescentMonitorView {
  const ft = (m: number) => m * FT_PER_M;
  const altFt = ft(Math.max(0, input.altitudeM));
  const rateFt = ft(input.radialSpeedMps);
  const totalFt = ft(Math.hypot(input.radialSpeedMps, input.tangentialSpeedMps));
  const fwdFt = ft(input.tangentialSpeedMps);

  if (!input.burning && input.sinceIgnitionUs <= 0) {
    // Pre-ignition monitoring: V16 N62, or the flashing V99 N62 ignition
    // request once P63 raises it ahead of TIG.
    const tfiS = -input.tigOffsetUs / 1_000_000;
    const flashing = input.ignitionRequestFlashing === true;
    return {
      program: "63",
      verb: flashing ? "99" : "16",
      noun: "62",
      r1: formatTenths(totalFt),
      r2: formatMinSec(tfiS),
      r3: formatTenths(ft(input.accumulatedDvMps ?? 0)),
      units: ["ft/s velocity", "TFI mm ss", "ft/s ΔV"],
      caption: flashing
        ? "Ignition request — flashing V99 N62"
        : "Pre-ignition monitor — V16 N62",
      flashing,
    };
  }

  if (input.altitudeM > HIGH_GATE_M) {
    return {
      program: "63",
      verb: "06",
      noun: "63",
      r1: formatTenths(totalFt),
      r2: formatTenths(rateFt),
      r3: formatRegister(altFt),
      units: ["ft/s velocity", "ft/s alt rate", "ft altitude"],
      caption: "P63 braking — V06 N63",
    };
  }


  if (input.altitudeM > LOW_GATE_M) {
    // Approach phase: time-to-go is estimated from the current sink rate.
    const sink = Math.max(0.5, -input.radialSpeedMps);
    const tgoS = input.altitudeM / sink;
    // LPD look angle from the vehicle to the landing point, degrees.
    const lpdDeg = (Math.atan2(Math.max(1, input.altitudeM), Math.max(1, Math.abs(input.tangentialSpeedMps) * tgoS)) * 180) / Math.PI;
    return {
      program: "64",
      verb: "06",
      noun: "64",
      r1: formatClockRegister(tgoS),
      r2: formatRegister(lpdDeg),
      r3: formatRegister(rateFt),
      units: ["TGO mm:ss", "deg LPD", "ft/s alt rate"],
      caption: "P64 approach — V06 N64",
    };
  }

  return {
    program: input.terminal ? "68" : "66",
    verb: "06",
    noun: "60",
    r1: formatRegister(fwdFt),
    r2: formatRegister(rateFt),
    r3: formatRegister(altFt),
    units: ["ft/s forward", "ft/s alt rate", "ft altitude"],
    caption: input.terminal ? "Touchdown — V06 N60" : "P66 landing — V06 N60",
  };
}
