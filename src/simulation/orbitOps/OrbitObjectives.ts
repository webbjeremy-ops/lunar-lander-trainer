// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Objective evaluation, scoring and debrief text.
//
// Pure: every function is a total function of the scenario definition and the
// current physical state. Nothing here reads AGC state.

import type { LunarFlightState } from "@/simulation/lunar2d/types";
import {
  INTERCEPT_CLOSING_RATE_MPS,
  INTERCEPT_COMPLETE_LABEL,
  INTERCEPT_CONTINUES_LABEL,
  orbitNumber,
} from "./OrbitConstants";
import { closingRateMps } from "./RelativeMotion";
import type {
  OrbitScenario,
  OrbitalElements,
  RelativeState,
  OrbitAccuracyClass,
} from "./types";

export type OrbitOutcome =
  | "in-progress"
  | "objectives-met"
  | "intercept-setup-complete"
  | "surface-impact"
  | "propellant-exhausted"
  | "escape";

export interface ConditionStatus {
  readonly id: string;
  readonly description: string;
  readonly met: boolean;
}

export interface OrbitEvaluation {
  readonly outcome: OrbitOutcome;
  readonly conditions: readonly ConditionStatus[];
  readonly safePeriapsis: boolean;
  readonly interceptReady: boolean;
  /** The two mandated strings when the intercept boundary is reached. */
  readonly terminalBanner: readonly string[] | null;
}

export function evaluateOrbitScenario(
  scenario: Readonly<OrbitScenario>,
  lm: Readonly<LunarFlightState>,
  elements: Readonly<OrbitalElements>,
  rel: Readonly<RelativeState> | null,
  targetElements: Readonly<OrbitalElements> | null,
): OrbitEvaluation {
  const safePeriapsis =
    elements.valid && elements.periapsisAltitudeM >= scenario.safePeriapsisAltitudeM;

  const interceptReady =
    rel !== null &&
    rel.rangeM <= orbitNumber("intercept-range") &&
    Math.abs(closingRateMps(rel)) <= INTERCEPT_CLOSING_RATE_MPS;

  const conditions: ConditionStatus[] = scenario.successConditions.map((c) => {
    switch (c.kind) {
      case "periapsis-above":
        return {
          id: c.id,
          description: c.description,
          met: elements.valid && elements.periapsisAltitudeM >= (c.valueM ?? 0),
        };
      case "circular-within": {
        const apo = elements.apoapsisAltitudeM;
        return {
          id: c.id,
          description: c.description,
          met:
            apo !== null &&
            Math.abs(apo - elements.periapsisAltitudeM) <= (c.valueM ?? 0),
        };
      }
      case "apoapsis-within": {
        const apo = elements.apoapsisAltitudeM;
        const want = targetElements?.apoapsisAltitudeM ?? null;
        return {
          id: c.id,
          description: c.description,
          met:
            apo !== null &&
            want !== null &&
            Math.abs(apo - want) <= (c.valueM ?? 0),
        };
      }
      case "period-within": {
        const p = elements.orbitalPeriodS;
        const want = targetElements?.orbitalPeriodS ?? null;
        return {
          id: c.id,
          description: c.description,
          met: p !== null && want !== null && Math.abs(p - want) <= (c.valueS ?? 0),
        };
      }
      case "intercept-setup":
        return { id: c.id, description: c.description, met: interceptReady };
      case "manual-review":
        return { id: c.id, description: c.description, met: true };
    }
  });

  let outcome: OrbitOutcome = "in-progress";
  if (lm.terminalState === "crashed" || lm.terminalState === "hard-landing" || lm.terminalState === "landed") {
    outcome = "surface-impact";
  } else if (!elements.valid || elements.shape === "escape") {
    outcome = "escape";
  } else if (
    conditions.length > 0 &&
    conditions.every((c) => c.met) &&
    !scenario.sandbox
  ) {
    outcome = scenario.successConditions.some((c) => c.kind === "intercept-setup")
      ? "intercept-setup-complete"
      : "objectives-met";
  } else if (lm.ascentPropellantKg <= 0 && !scenario.sandbox) {
    outcome = "propellant-exhausted";
  }

  return {
    outcome,
    conditions,
    safePeriapsis,
    interceptReady,
    terminalBanner:
      outcome === "intercept-setup-complete"
        ? [INTERCEPT_COMPLETE_LABEL, INTERCEPT_CONTINUES_LABEL]
        : null,
  };
}

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------

export interface OrbitFlightRecord {
  readonly scenarioId: string;
  readonly assistance: string;
  readonly outcome: OrbitOutcome;
  readonly elements: OrbitalElements;
  readonly targetElements: OrbitalElements | null;
  readonly relative: RelativeState | null;
  readonly burnCount: number;
  readonly totalDeltaVMps: number;
  readonly plannedDeltaVMps: number;
  readonly achievedDeltaVMps: number;
  readonly propellantRemainingKg: number;
  readonly propellantInitialKg: number;
  readonly bestRangeM: number | null;
  /** Absolute seconds between the planned ignition and the actual ignition. */
  readonly burnTimingErrorS: number | null;
  readonly attitudeAlignmentErrorRad: number;
  readonly missionTimeS: number;
}

export interface OrbitScoreLine {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly detail: string;
}

export interface OrbitScore {
  readonly total: number;
  readonly maxTotal: number;
  readonly grade: string;
  readonly lines: readonly OrbitScoreLine[];
  readonly passed: boolean;
}

const band = (error: number, tolerance: number, max: number): number => {
  if (!Number.isFinite(error)) return 0;
  const q = Math.max(0, 1 - Math.abs(error) / Math.max(1e-9, tolerance));
  return Math.round(q * max);
};

export function scoreOrbitOperations(
  scenario: Readonly<OrbitScenario>,
  record: Readonly<OrbitFlightRecord>,
): OrbitScore {
  const lines: OrbitScoreLine[] = [];
  const el = record.elements;

  const safe =
    el.valid && el.periapsisAltitudeM >= scenario.safePeriapsisAltitudeM;
  lines.push({
    id: "safe-periapsis",
    label: "Safe periapsis",
    points: safe ? 25 : 0,
    maxPoints: 25,
    detail: safe
      ? `Periapsis ${(el.periapsisAltitudeM / 1000).toFixed(1)} km.`
      : "Periapsis below the safety altitude.",
  });

  const wantsIntercept = scenario.successConditions.some(
    (c) => c.kind === "intercept-setup",
  );
  if (wantsIntercept) {
    const range = record.bestRangeM ?? Number.POSITIVE_INFINITY;
    lines.push({
      id: "closest-approach",
      label: "Closest approach",
      points: band(range, orbitNumber("intercept-range") * 2, 20),
      maxPoints: 20,
      detail: Number.isFinite(range)
        ? `Best range ${(range / 1000).toFixed(1)} km.`
        : "No approach achieved.",
    });
    const closing = record.relative ? Math.abs(closingRateMps(record.relative)) : Infinity;
    lines.push({
      id: "closing-rate",
      label: "Closing rate",
      points: band(closing, INTERCEPT_CLOSING_RATE_MPS * 2, 10),
      maxPoints: 10,
      detail: Number.isFinite(closing)
        ? `${closing.toFixed(1)} m/s at the boundary.`
        : "Not evaluated.",
    });
    const phase = record.relative ? Math.abs(record.relative.phaseAngleRad) : Math.PI;
    lines.push({
      id: "phase-angle",
      label: "Phase angle",
      points: band(phase, 0.5, 10),
      maxPoints: 10,
      detail: `${((phase * 180) / Math.PI).toFixed(1)} deg from the target.`,
    });
  } else {
    const apo = el.apoapsisAltitudeM;
    const wantApo = record.targetElements?.apoapsisAltitudeM ?? apo;
    lines.push({
      id: "apoapsis-error",
      label: "Apoapsis error",
      points:
        apo === null || wantApo === null
          ? 0
          : band(apo - wantApo, orbitNumber("apoapsis-tolerance") * 3, 20),
      maxPoints: 20,
      detail:
        apo === null ? "No apoapsis." : `${(apo / 1000).toFixed(1)} km.`,
    });
    const per = el.orbitalPeriodS;
    const wantPer = record.targetElements?.orbitalPeriodS ?? per;
    lines.push({
      id: "period-error",
      label: "Period error",
      points:
        per === null || wantPer === null
          ? 0
          : band(per - wantPer, orbitNumber("period-tolerance") * 6, 20),
      maxPoints: 20,
      detail: per === null ? "Unbound." : `${(per / 60).toFixed(2)} min.`,
    });
  }

  lines.push({
    id: "burn-timing",
    label: "Burn timing",
    points:
      record.burnTimingErrorS === null ? 5 : band(record.burnTimingErrorS, 60, 10),
    maxPoints: 10,
    detail:
      record.burnTimingErrorS === null
        ? "No planned node to compare."
        : `${record.burnTimingErrorS.toFixed(1)} s from the planned ignition.`,
  });

  const dvError = record.achievedDeltaVMps - record.plannedDeltaVMps;
  lines.push({
    id: "delta-v-efficiency",
    label: "Delta-v efficiency",
    points: band(dvError, Math.max(5, record.plannedDeltaVMps * 0.5), 10),
    maxPoints: 10,
    detail:
      record.plannedDeltaVMps > 0
        ? `Planned ${record.plannedDeltaVMps.toFixed(1)}, flew ${record.achievedDeltaVMps.toFixed(1)} m/s.`
        : "No planned delta-v.",
  });

  const fuelFraction =
    record.propellantInitialKg > 0
      ? record.propellantRemainingKg / record.propellantInitialKg
      : 0;
  lines.push({
    id: "fuel-remaining",
    label: "Propellant remaining",
    points: Math.round(Math.max(0, Math.min(1, fuelFraction)) * 10),
    maxPoints: 10,
    detail: `${record.propellantRemainingKg.toFixed(1)} kg left.`,
  });

  lines.push({
    id: "correction-burns",
    label: "Correction burns",
    points: Math.max(0, 10 - Math.max(0, record.burnCount - 1) * 3),
    maxPoints: 10,
    detail: `${record.burnCount} burn${record.burnCount === 1 ? "" : "s"}.`,
  });

  lines.push({
    id: "attitude-alignment",
    label: "Attitude alignment",
    points: band(record.attitudeAlignmentErrorRad, 0.35, 5),
    maxPoints: 5,
    detail: `${((record.attitudeAlignmentErrorRad * 180) / Math.PI).toFixed(1)} deg mean error.`,
  });

  const assistPenalty =
    record.assistance === "instructor" ? 10 : record.assistance === "pilot" ? 5 : 0;
  lines.push({
    id: "assistance",
    label: "Assistance used",
    points: 10 - assistPenalty,
    maxPoints: 10,
    detail: `${record.assistance} mode.`,
  });

  const total = lines.reduce((s, l) => s + l.points, 0);
  const maxTotal = lines.reduce((s, l) => s + l.maxPoints, 0);
  const pct = maxTotal > 0 ? total / maxTotal : 0;
  const grade =
    record.outcome === "surface-impact"
      ? "F"
      : pct >= 0.9
        ? "A"
        : pct >= 0.75
          ? "B"
          : pct >= 0.6
            ? "C"
            : pct >= 0.45
              ? "D"
              : "E";

  return {
    total,
    maxTotal,
    grade,
    lines,
    passed:
      record.outcome === "objectives-met" ||
      record.outcome === "intercept-setup-complete",
  };
}

// -----------------------------------------------------------------------------
// Debrief narrative
// -----------------------------------------------------------------------------

export interface DebriefEntry {
  readonly heading: string;
  readonly body: string;
  readonly classification: OrbitAccuracyClass;
}

export function buildOrbitDebrief(
  scenario: Readonly<OrbitScenario>,
  record: Readonly<OrbitFlightRecord>,
  before: Readonly<OrbitalElements> | null,
): readonly DebriefEntry[] {
  const el = record.elements;
  const out: DebriefEntry[] = [];

  const dPeri =
    before === null ? null : el.periapsisAltitudeM - before.periapsisAltitudeM;
  const dApo =
    before === null || before.apoapsisAltitudeM === null || el.apoapsisAltitudeM === null
      ? null
      : el.apoapsisAltitudeM - before.apoapsisAltitudeM;
  const dPeriod =
    before === null || before.orbitalPeriodS === null || el.orbitalPeriodS === null
      ? null
      : el.orbitalPeriodS - before.orbitalPeriodS;

  out.push({
    heading: "What the burn changed",
    body:
      dPeri === null
        ? "No burn was flown, so the orbit is unchanged."
        : `Periapsis moved ${(dPeri / 1000).toFixed(2)} km and apoapsis moved ${
            dApo === null ? "—" : (dApo / 1000).toFixed(2) + " km"
          }. Total delta-v spent: ${record.totalDeltaVMps.toFixed(1)} m/s over ${record.burnCount} burn(s).`,
    classification: "educational-approximation",
  });

  out.push({
    heading: "Why the burn location mattered",
    body:
      "A burn changes the orbit most strongly on the opposite side. Thrusting " +
      "near periapsis mainly moves apoapsis; thrusting near apoapsis mainly " +
      "moves periapsis. Burning halfway between the apsides mostly rotates the " +
      "ellipse instead of resizing it.",
    classification: "educational-approximation",
  });

  out.push({
    heading: "Prograde or retrograde",
    body:
      "Adding speed along the velocity vector raises the far side of the orbit; " +
      "removing speed lowers it. Radial thrust mostly rotates the ellipse and is " +
      "an expensive way to change altitude.",
    classification: "educational-approximation",
  });

  out.push({
    heading: "Orbital period",
    body:
      dPeriod === null
        ? "Period unchanged."
        : `Period changed by ${dPeriod.toFixed(1)} s. Period depends only on the ` +
          "semi-major axis, so any burn that changes orbit size changes your timing.",
    classification: "source-derived",
  });

  if (record.relative) {
    const gained = (dPeriod ?? 0) < 0;
    out.push({
      heading: "Phase",
      body:
        `${gained ? "A shorter period means you gained on the Command Module." : "A longer period means you fell behind the Command Module."} ` +
        `Phase angle is now ${((record.relative.phaseAngleRad * 180) / Math.PI).toFixed(1)} deg with a range of ${(record.relative.rangeM / 1000).toFixed(1)} km.`,
      classification: "educational-approximation",
    });
    out.push({
      heading: "Intercept",
      body:
        record.outcome === "intercept-setup-complete"
          ? `${INTERCEPT_COMPLETE_LABEL}. ${INTERCEPT_CONTINUES_LABEL}.`
          : "The intercept window was not reached: range or closing rate stayed outside the limits.",
      classification: "gameplay-tuned",
    });
  }

  out.push({
    heading: "Was the orbit safe?",
    body:
      el.periapsisAltitudeM < 0
        ? "No. The final trajectory intersects the surface."
        : el.periapsisAltitudeM < scenario.safePeriapsisAltitudeM
          ? "Marginal. Periapsis is above the surface but below the safety altitude."
          : "Yes. Periapsis is above the safety altitude.",
    classification: "gameplay-tuned",
  });

  out.push({
    heading: "One recommended correction",
    body: recommendCorrection(scenario, record),
    classification: "educational-approximation",
  });

  return out;
}

function recommendCorrection(
  scenario: Readonly<OrbitScenario>,
  record: Readonly<OrbitFlightRecord>,
): string {
  const el = record.elements;
  if (el.periapsisAltitudeM < scenario.safePeriapsisAltitudeM) {
    return "Coast to apoapsis and add a small prograde delta-v to lift periapsis above the safety altitude before anything else.";
  }
  if (record.burnCount > 2) {
    return "Plan one larger burn at the correct apsis instead of several small corrections — each extra burn costs alignment time and propellant.";
  }
  const apo = el.apoapsisAltitudeM;
  if (apo !== null && Math.abs(apo - el.periapsisAltitudeM) > 20_000) {
    return "Circularize: burn at the apsis that comes first, prograde at apoapsis or retrograde at periapsis.";
  }
  if (record.relative && record.relative.rangeM > orbitNumber("intercept-range")) {
    return "Make a small period change and let two or three revolutions close the phase angle rather than chasing the target directly.";
  }
  return "Hold this orbit and verify the readout across a full revolution before planning anything further.";
}
