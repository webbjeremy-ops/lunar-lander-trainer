// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Pure scoring and debrief generation.
//
// Deterministic: the same FlightSummary always produces the same MissionScore.

import type { FlightSummary } from "./types";

export interface ScoreComponent {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly note: string;
}

export type MissionGrade = "A" | "B" | "C" | "D" | "F";

export interface MissionScore {
  readonly outcome: "landed" | "hard-landing" | "crashed" | "incomplete";
  readonly headline: string;
  readonly total: number;
  readonly maxTotal: number;
  readonly grade: MissionGrade;
  readonly components: readonly ScoreComponent[];
  readonly notes: readonly string[];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function gradeFor(fraction: number, outcome: MissionScore["outcome"]): MissionGrade {
  if (outcome === "crashed") return "F";
  if (fraction >= 0.9) return "A";
  if (fraction >= 0.75) return "B";
  if (fraction >= 0.6) return "C";
  if (fraction >= 0.4) return "D";
  return "F";
}

export function scoreMission(summary: FlightSummary): MissionScore {
  const { finalState, limits } = summary;
  const td = finalState.touchdown;
  const outcome: MissionScore["outcome"] =
    td?.classification ??
    (finalState.terminalState === "propellant-depleted" ? "incomplete" : "incomplete");

  const components: ScoreComponent[] = [];

  // --- Touchdown quality -----------------------------------------------------
  const vs = Math.abs(td?.verticalSpeedMps ?? 0);
  const hs = Math.abs(td?.horizontalSpeedMps ?? 0);
  const tilt = Math.abs(td?.tiltRad ?? 0);
  const touchdownFraction =
    td === null
      ? 0
      : clamp01(1 - vs / limits.verticalSpeedMps) * 0.5 +
        clamp01(1 - hs / limits.horizontalSpeedMps) * 0.3 +
        clamp01(1 - tilt / limits.tiltRad) * 0.2;
  components.push({
    id: "touchdown",
    label: "Touchdown quality",
    points: round(40 * (outcome === "crashed" ? 0 : touchdownFraction)),
    maxPoints: 40,
    note:
      td === null
        ? "No touchdown recorded."
        : `${vs.toFixed(2)} m/s down · ${hs.toFixed(2)} m/s lateral · ${((tilt * 180) / Math.PI).toFixed(1)}° tilt`,
  });

  // --- Landing accuracy ------------------------------------------------------
  const miss = Math.abs(summary.landingZoneErrorM);
  const accuracyFraction = clamp01(1 - miss / (limits.landingZoneRadiusM * 4));
  components.push({
    id: "accuracy",
    label: "Landing accuracy",
    points: round(20 * (outcome === "crashed" ? 0 : accuracyFraction)),
    maxPoints: 20,
    note: `${miss.toFixed(0)} m from the zone centre (target radius ${limits.landingZoneRadiusM} m)`,
  });

  // --- Propellant margin -----------------------------------------------------
  const used = Math.max(
    0,
    summary.descentPropellantInitialKg - summary.descentPropellantRemainingKg,
  );
  const marginFraction =
    summary.descentPropellantInitialKg > 0
      ? clamp01(summary.descentPropellantRemainingKg / summary.descentPropellantInitialKg)
      : 0;
  components.push({
    id: "propellant",
    label: "Propellant margin",
    points: round(20 * marginFraction),
    maxPoints: 20,
    note: `${summary.descentPropellantRemainingKg.toFixed(0)} kg left · ${used.toFixed(0)} kg burned`,
  });

  // --- Procedure discipline --------------------------------------------------
  const p = summary.procedure;
  let procedureFraction: number;
  let procedureNote: string;
  if (p.skipped || p.required === 0) {
    procedureFraction = 0.5;
    procedureNote = "Quick Manual — DSKY procedure not flown (half credit).";
  } else {
    const completion = clamp01(p.completed / p.required);
    const penalty = clamp01(p.incorrectEntries * 0.08 + p.hintsUsed * 0.05);
    procedureFraction = clamp01(completion - penalty);
    procedureNote =
      `${p.completed}/${p.required} steps · ${p.incorrectEntries} wrong entries · ` +
      `${p.hintsUsed} hints · ${p.meanResponseSeconds.toFixed(1)} s mean response`;
  }
  components.push({
    id: "procedure",
    label: "Procedure discipline",
    points: round(15 * procedureFraction),
    maxPoints: 15,
    note: procedureNote,
  });

  // --- Control smoothness ----------------------------------------------------
  const smoothFraction = clamp01(1 - summary.controlRoughness / 2);
  components.push({
    id: "smoothness",
    label: "Control smoothness",
    points: round(5 * smoothFraction),
    maxPoints: 5,
    note: `roughness index ${summary.controlRoughness.toFixed(2)}`,
  });

  const total = round(components.reduce((s, c) => s + c.points, 0));
  const maxTotal = components.reduce((s, c) => s + c.maxPoints, 0);
  const grade = gradeFor(total / maxTotal, outcome);

  const headline =
    outcome === "landed"
      ? "The Eagle has landed."
      : outcome === "hard-landing"
        ? "Down hard — the vehicle is on the surface, but outside gear limits."
        : outcome === "crashed"
          ? "Impact. No survivors would have walked away from that."
          : finalState.terminalState === "propellant-depleted"
            ? "Descent propellant exhausted before touchdown."
            : "Flight ended without a touchdown.";

  return {
    outcome,
    headline,
    total,
    maxTotal,
    grade,
    components,
    notes: buildNotes(summary, outcome),
  };
}

function buildNotes(
  summary: FlightSummary,
  outcome: MissionScore["outcome"],
): readonly string[] {
  const notes: string[] = [];
  const td = summary.finalState.touchdown;
  if (td) {
    for (const v of td.violations) {
      notes.push(
        v === "vertical-speed"
          ? "Sink rate at contact exceeded the gear limit — start the flare earlier."
          : v === "horizontal-speed"
            ? "Lateral drift at contact exceeded the gear limit — null it above 30 m."
            : "Tilt at contact exceeded the gear limit — level the vehicle before touchdown.",
      );
    }
  }
  if (Math.abs(summary.landingZoneErrorM) > summary.limits.landingZoneRadiusM) {
    notes.push(
      "You landed outside the marked zone. Trade a little propellant earlier " +
        "to correct downrange error while you still have altitude.",
    );
  }
  if (
    summary.descentPropellantInitialKg > 0 &&
    summary.descentPropellantRemainingKg / summary.descentPropellantInitialKg < 0.05
  ) {
    notes.push("Propellant margin was critically low — Apollo 11 landed with about 25 seconds of fuel remaining.");
  }
  if (summary.takeover?.early) {
    notes.push(
      "You took manual control well above low gate. That is legal, but it " +
        "costs propellant compared with letting guidance fly the braking phase.",
    );
  }
  if (summary.controlRoughness > 1.2) {
    notes.push("Control inputs were jerky. Smaller, held corrections settle the vehicle faster.");
  }
  if (outcome === "landed" && notes.length === 0) {
    notes.push("Clean approach, clean touchdown. Nothing to correct.");
  }
  return notes;
}
