// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Pure scoring for the lunar-ascent game.
// Deterministic: the same AscentSummary always produces the same score.

import type { AssistanceLevel } from "@/game/play/types";
import type { AscentSummary } from "./types";

export interface AscentScoreComponent {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly note: string;
}

export type AscentGrade = "A" | "B" | "C" | "D" | "F";

export interface AscentScore {
  readonly outcome: AscentSummary["outcome"];
  readonly headline: string;
  readonly total: number;
  readonly maxTotal: number;
  readonly grade: AscentGrade;
  readonly components: readonly AscentScoreComponent[];
  readonly notes: readonly string[];
}

const ASSISTANCE_WEIGHT: Record<AssistanceLevel, number> = {
  instructor: 0.4,
  pilot: 0.75,
  commander: 1,
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function gradeFor(fraction: number, outcome: AscentSummary["outcome"]): AscentGrade {
  if (outcome === "surface-impact") return "F";
  if (fraction >= 0.9) return "A";
  if (fraction >= 0.75) return "B";
  if (fraction >= 0.6) return "C";
  if (fraction >= 0.4) return "D";
  return "F";
}

export function scoreAscent(summary: AscentSummary): AscentScore {
  const { target, outcome } = summary;
  const components: AscentScoreComponent[] = [];
  const notes: string[] = [];

  // --- Orbit achieved --------------------------------------------------------
  const achieved = outcome === "orbit-achieved";
  components.push({
    id: "orbit",
    label: "Orbit achieved",
    points: achieved ? 25 : 0,
    maxPoints: 25,
    note: achieved
      ? "Engine-off trajectory clears the surface all the way round."
      : outcomeNote(outcome),
  });

  // --- Periapsis safety ------------------------------------------------------
  const peri = summary.periapsisAltitudeM;
  const safetyFraction = clamp01(peri / Math.max(1, target.periapsisAltitudeM));
  components.push({
    id: "periapsis",
    label: "Periapsis safety",
    points: round(20 * (outcome === "surface-impact" ? 0 : safetyFraction)),
    maxPoints: 20,
    note: `Low point ${(peri / 1000).toFixed(1)} km (target ${(target.periapsisAltitudeM / 1000).toFixed(1)} km).`,
  });

  // --- Target apoapsis -------------------------------------------------------
  const apo = summary.apoapsisAltitudeM;
  const apoTol = Math.max(2_000, target.apoapsisAltitudeM * 0.2);
  const apoFraction =
    apo === null ? 0 : clamp01(1 - Math.abs(apo - target.apoapsisAltitudeM) / apoTol);
  components.push({
    id: "apoapsis",
    label: "Target apoapsis",
    points: round(20 * apoFraction),
    maxPoints: 20,
    note:
      apo === null
        ? "Trajectory is not bound to the Moon — no apoapsis."
        : `High point ${(apo / 1000).toFixed(1)} km (target ${(target.apoapsisAltitudeM / 1000).toFixed(1)} km).`,
  });

  // --- Propellant remaining --------------------------------------------------
  const propFraction = clamp01(
    summary.ascentPropellantRemainingKg /
      Math.max(1, summary.ascentPropellantInitialKg * 0.15),
  );
  components.push({
    id: "propellant",
    label: "Propellant remaining",
    points: round(15 * propFraction),
    maxPoints: 15,
    note: `${summary.ascentPropellantRemainingKg.toFixed(0)} kg APS left · ${summary.deltaVRemainingMps.toFixed(0)} m/s of delta-v.`,
  });

  // --- Cutoff timing ---------------------------------------------------------
  // A clean insertion cuts off with the radial rate close to zero: that is what
  // puts the low point where the engine stopped instead of far below it.
  const radial = Math.abs(summary.cutoffRadialSpeedMps ?? 0);
  const cutoffFraction =
    summary.cutoffMissionTimeUs === null ? 0 : clamp01(1 - radial / 60);
  components.push({
    id: "cutoff",
    label: "Cutoff timing",
    points: round(10 * cutoffFraction),
    maxPoints: 10,
    note:
      summary.cutoffMissionTimeUs === null
        ? "No commanded cutoff was recorded."
        : `${radial.toFixed(1)} m/s radial rate at cutoff, ${((summary.cutoffAltitudeM ?? 0) / 1000).toFixed(1)} km altitude.`,
  });

  // --- Smoothness ------------------------------------------------------------
  const smoothFraction = clamp01(1 - summary.controlRoughness / 2.5);
  components.push({
    id: "smoothness",
    label: "Control smoothness",
    points: round(5 * smoothFraction),
    maxPoints: 5,
    note: `Roughness ${summary.controlRoughness.toFixed(2)} (mean command change per second).`,
  });

  // --- Assistance ------------------------------------------------------------
  const assistWeight = summary.demonstrationUsed
    ? 0
    : ASSISTANCE_WEIGHT[summary.assistance];
  components.push({
    id: "assistance",
    label: "Assistance",
    points: round(5 * assistWeight),
    maxPoints: 5,
    note: summary.demonstrationUsed
      ? "Demonstration autopilot flew part of this ascent — no assistance credit."
      : `Flown at ${summary.assistance}.`,
  });

  if (!summary.staged) {
    notes.push(
      "The descent stage was never jettisoned; the ascent engine cannot fire beneath it.",
    );
  }
  if (summary.demonstrationUsed) {
    notes.push(
      "This flight used the demonstration autopilot. It is the game's own advisory guidance, not the AGC.",
    );
  }
  if (outcome === "insufficient-periapsis") {
    notes.push(
      "A high apoapsis is not an orbit: with the low point inside the Moon the vehicle comes back down half a revolution later.",
    );
  }
  if (outcome === "propellant-depleted") {
    notes.push(
      "Delta-v ran out before the orbit closed. Pitching over earlier converts thrust into horizontal speed sooner.",
    );
  }

  const total = round(components.reduce((s, c) => s + c.points, 0));
  const maxTotal = components.reduce((s, c) => s + c.maxPoints, 0);
  const fraction = maxTotal > 0 ? total / maxTotal : 0;

  return {
    outcome,
    headline: headlineFor(outcome, summary),
    total,
    maxTotal,
    grade: gradeFor(fraction, outcome),
    components,
    notes,
  };
}

function outcomeNote(outcome: AscentSummary["outcome"]): string {
  switch (outcome) {
    case "surface-impact":
      return "The vehicle returned to the surface.";
    case "insufficient-periapsis":
      return "Periapsis is below the safe floor — the trajectory intersects the Moon.";
    case "propellant-depleted":
      return "The APS ran dry before insertion.";
    default:
      return "Flight is still in progress.";
  }
}

function headlineFor(
  outcome: AscentSummary["outcome"],
  summary: AscentSummary,
): string {
  switch (outcome) {
    case "orbit-achieved":
      return `Insertion — ${((summary.periapsisAltitudeM) / 1000).toFixed(1)} x ${((summary.apoapsisAltitudeM ?? 0) / 1000).toFixed(1)} km`;
    case "insufficient-periapsis":
      return "No orbit — the low point is inside the Moon";
    case "surface-impact":
      return "Impact — the ascent stage came back down";
    case "propellant-depleted":
      return "APS depleted before insertion";
    default:
      return "Ascent in progress";
  }
}
