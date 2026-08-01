// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.20 — Canonical 13-minute powered-descent timeline (PURE).
//
// HISTORICALLY GROUNDED PROCEDURE BRIDGE
// --------------------------------------
// One table, one timebase. Every scripted event in /play — crew callouts,
// program alarms, the windows-up roll, the P64 pitch-over and the landing
// radar antenna reposition — is keyed to ignition-relative time AND to the
// altitude / range-to-landing-zone the vehicle should have at that time, so
// the story, the trajectory and the map agree.
//
// Anchors (Apollo 11, PDI at GET 102:33:05, touchdown 102:45:40):
//   T+000  ignition, ~50,000 ft, ~260 nmi to run
//   T+026  throttle up to FTP
//   T+200  yaw-around: windows up, landing radar looking at the surface
//   T+300  radar lock / Delta-H converged
//   T+318  first 1202, T+357 second 1202
//   T+386  THROTTLE RECOVERY: guidance leaves the 92.5 % fixed throttle point
//          and drops straight to ~57 %, below the 65-92.5 % erosion band
//   T+506  HIGH GATE — P63 hands to P64, pitch-over, SETPOS2 (radar to
//          antenna position 2), ~7,600 ft and ~4.1 nmi from the aim point
//   T+553 / T+578  the two 1201s in the approach phase
//   T+642  LOW GATE — 500 ft, P66 rate-of-descent, manual landing
//   T+700  "sixty seconds", T+731 "thirty seconds"
//   T+755  contact / touchdown  (12:35 from PDI)
//
// Pure module: no timers, no side effects, no AGC access.

const FT = 0.3048;
const NMI = 1852;

export type DescentProgram = "P63" | "P64" | "P66";

export interface DescentMilestone {
  readonly id: string;
  /** Seconds since ignition (TIG / PDI). */
  readonly tSec: number;
  readonly label: string;
  readonly program: DescentProgram;
  /** Nominal altitude above the surface, metres. */
  readonly altitudeM: number;
  /** Nominal range still to run to the landing zone, metres. */
  readonly rangeToLzM: number;
  /** What the crew is doing, in one line. */
  readonly note: string;
}

function m(
  id: string,
  tSec: number,
  label: string,
  program: DescentProgram,
  altitudeFt: number,
  rangeNmi: number,
  note: string,
): DescentMilestone {
  return {
    id,
    tSec,
    label,
    program,
    altitudeM: altitudeFt * FT,
    rangeToLzM: rangeNmi * NMI,
    note,
  };
}

export const DESCENT_TIMELINE: readonly DescentMilestone[] = [
  m("ignition", 0, "PDI · IGNITION", "P63", 49_971, 259,
    "DPS lights at 10 % thrust; the vehicle is on its back, windows down."),
  m("throttle-up", 26, "THROTTLE UP · FTP", "P63", 48_000, 236,
    "Guidance takes the engine to the fixed throttle point for braking."),
  m("yaw-around", 200, "YAW-AROUND · WINDOWS UP", "P63", 42_426, 109,
    "Roll face-up so the landing radar sees the surface."),
  m("radar-lock", 300, "LANDING RADAR LOCK · DELTA-H", "P63", 37_462, 58,
    "Radar altitude agrees with the state vector; V57 accepts it."),
  m("alarm-1202-first", 318, "1202 PROGRAM ALARM", "P63", 34_069, 51,
    "Executive overflow — no core sets. Read it, reset it, keep flying."),
  m("alarm-1202-second", 357, "1202 PROGRAM ALARM", "P63", 26_977, 37,
    "Recurring overload; guidance and displays stay healthy."),
  m("throttle-down", 386, "THROTTLE RECOVERY · 92.5 % → 57 %", "P63", 24_000, 30,
    "Guidance leaves the fixed throttle point and steps straight down to the " +
    "variable range, skipping the 65-92.5 % nozzle-erosion band."),
  m("high-gate", 506, "HIGH GATE · P64 · SETPOS2", "P64", 7_600, 4.1,
    "P63 hands to P64: pitch-over brings the site into the window and the " +
    "landing radar antenna is cranked to position 2 for the descent."),
  m("alarm-1201-first", 553, "1201 PROGRAM ALARM", "P64", 3_000, 2.2,
    "Executive overflow — no VAC areas, taken in the approach phase."),
  m("alarm-1201-second", 578, "1201 PROGRAM ALARM", "P64", 1_600, 1.3,
    "Last of the descent alarms, landing point already in the window."),
  m("redesignate", 620, "LPD REDESIGNATION", "P64", 700, 0.7,
    "Commander flies past the rocky area, moving the aim point downrange."),
  m("low-gate", 642, "LOW GATE · P66", "P66", 500, 0.3,
    "Rate-of-descent landing: hold the sink rate, null forward velocity."),
  m("sixty-seconds", 683, "SIXTY SECONDS", "P66", 250, 0.15,
    "Propellant call from Houston — burn time remaining, not tank quantity."),
  m("thirty-seconds", 713, "THIRTY SECONDS", "P66", 60, 0.05,
    "Final propellant call; the vehicle is essentially over the site."),
  m("contact", 755, "CONTACT · ENGINE STOP", "P66", 0, 0,
    "A probe touches, the contact light comes on, the engine is shut down."),
] as const;

/** Total scripted descent duration, seconds (12:35 from PDI). */
export const DESCENT_DURATION_SEC =
  DESCENT_TIMELINE[DESCENT_TIMELINE.length - 1]!.tSec;

export const TIMELINE_CITATION = {
  label: "Apollo 11 Mission Report / air-to-ground transcript / Luminary 099",
  detail:
    "Times are ignition-relative (PDI at GET 102:33:05). High gate, the P64 " +
    "hand-over and the SETPOS2 antenna reposition are at T+506 s (8:26), ~7,600 ft " +
    "and ~4.1 nmi from the aim point. The timeline is raised by the game as a " +
    "bridged overlay, never by the pinned rope.",
} as const;

/** Seconds since ignition for a milestone id. */
export function milestoneSec(id: string): number {
  const found = DESCENT_TIMELINE.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown descent milestone: ${id}`);
  return found.tSec;
}

export function milestoneById(id: string): DescentMilestone | null {
  return DESCENT_TIMELINE.find((e) => e.id === id) ?? null;
}

/** The most recent milestone at or before t. */
export function currentMilestone(tSec: number): DescentMilestone {
  let out = DESCENT_TIMELINE[0]!;
  for (const e of DESCENT_TIMELINE) if (tSec >= e.tSec) out = e;
  return out;
}

/** The next milestone after t, or null once the script is complete. */
export function nextMilestone(tSec: number): DescentMilestone | null {
  return DESCENT_TIMELINE.find((e) => e.tSec > tSec) ?? null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export interface NominalState {
  /** Nominal altitude above the surface, metres. */
  readonly altitudeM: number;
  /** Nominal range still to run to the landing zone, metres. */
  readonly rangeToLzM: number;
  readonly program: DescentProgram;
}

export type HighGateStatus = "pending" | "ready" | "missed";

/**
 * Shared P63→P64 gate. The clock may announce high gate only while the landing
 * site is still ahead and the vehicle is inside the high-gate approach box.
 * Passing the site before satisfying the box is a missed gate, not P64.
 */
export function highGateStatus(
  sinceIgnitionUs: number,
  altitudeM: number,
  rangeToLzM: number,
): HighGateStatus {
  if (rangeToLzM <= 0) return "missed";
  if (sinceIgnitionUs < milestoneSec("high-gate") * 1_000_000) return "pending";
  const altitudeCeilingM = milestoneById("high-gate")!.altitudeM * 1.5;
  const rangeCeilingM = HIGH_GATE_RANGE_M * 2;
  return altitudeM <= altitudeCeilingM && rangeToLzM <= rangeCeilingM
    ? "ready"
    : "pending";
}

/**
 * Nominal altitude and range-to-go for a time since ignition, linearly
 * interpolated between milestones. Used to show the player how their descent
 * compares with the flown profile — never to drive the physics.
 */
export function nominalStateAt(tSec: number): NominalState {
  const first = DESCENT_TIMELINE[0]!;
  const last = DESCENT_TIMELINE[DESCENT_TIMELINE.length - 1]!;
  if (tSec <= first.tSec) {
    return { altitudeM: first.altitudeM, rangeToLzM: first.rangeToLzM, program: first.program };
  }
  if (tSec >= last.tSec) {
    return { altitudeM: last.altitudeM, rangeToLzM: last.rangeToLzM, program: last.program };
  }
  for (let i = 0; i < DESCENT_TIMELINE.length - 1; i++) {
    const a = DESCENT_TIMELINE[i]!;
    const b = DESCENT_TIMELINE[i + 1]!;
    if (tSec >= a.tSec && tSec <= b.tSec) {
      const f = (tSec - a.tSec) / (b.tSec - a.tSec);
      return {
        altitudeM: lerp(a.altitudeM, b.altitudeM, f),
        rangeToLzM: lerp(a.rangeToLzM, b.rangeToLzM, f),
        program: a.program,
      };
    }
  }
  return { altitudeM: last.altitudeM, rangeToLzM: last.rangeToLzM, program: last.program };
}

/** "T+08:34" caption for a milestone or any ignition-relative time. */
export function formatT(tSec: number): string {
  const s = Math.max(0, Math.round(tSec));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The altitude the canonical profile wants at a given range still to run to
 * the landing zone, metres. This is the link between the 13-minute timeline
 * and the flown trajectory: guided flight uses it as its braking-phase
 * altitude target so the vehicle arrives at high gate over the site instead of
 * sailing past it. Advisory only — it never enters the AGC.
 */
export function nominalAltitudeForRangeM(rangeToLzM: number): number {
  const first = DESCENT_TIMELINE[0]!;
  if (rangeToLzM >= first.rangeToLzM) return first.altitudeM;
  if (rangeToLzM <= 0) return 0;
  for (let i = 0; i < DESCENT_TIMELINE.length - 1; i++) {
    const a = DESCENT_TIMELINE[i]!;
    const b = DESCENT_TIMELINE[i + 1]!;
    if (rangeToLzM <= a.rangeToLzM && rangeToLzM >= b.rangeToLzM) {
      const span = a.rangeToLzM - b.rangeToLzM;
      const f = span > 0 ? (a.rangeToLzM - rangeToLzM) / span : 0;
      return lerp(a.altitudeM, b.altitudeM, f);
    }
  }
  return 0;
}

/**
 * Nominal downrange (closing) speed for a range still to run, m/s — the slope
 * of the canonical range-versus-time profile in the segment that contains this
 * range. Guided flight brakes ONTO this speed instead of simply nulling
 * velocity, which is what keeps the burn on the 13-minute clock instead of
 * arriving over the site early and slow. Advisory only.
 */
export function nominalDownrangeSpeedForRange(rangeToLzM: number): number {
  const clamped = Math.max(0, rangeToLzM);
  for (let i = 0; i < DESCENT_TIMELINE.length - 1; i++) {
    const a = DESCENT_TIMELINE[i]!;
    const b = DESCENT_TIMELINE[i + 1]!;
    if (clamped <= a.rangeToLzM && clamped >= b.rangeToLzM) {
      const dt = b.tSec - a.tSec;
      return dt > 0 ? (a.rangeToLzM - b.rangeToLzM) / dt : 0;
    }
  }
  const first = DESCENT_TIMELINE[0]!;
  const second = DESCENT_TIMELINE[1]!;
  return (first.rangeToLzM - second.rangeToLzM) / (second.tSec - first.tSec);
}

/** Range to the landing zone at which the braking phase hands to P64, metres. */
export const HIGH_GATE_RANGE_M = milestoneById("high-gate")!.rangeToLzM;
