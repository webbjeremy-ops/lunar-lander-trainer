// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — Mission registry + scoring tests.

import { describe, expect, it } from "vitest";
import {
  angleForRange,
  DESCENT_LANDMARKS,
  downrangeToLandingZoneM,
  getMission,
  LANDING_LIMITS,
  LANDING_ZONE_ANGLE_RAD,
  MISSIONS,
  MISSION_IDS,
  scoreMission,
  scriptFor,
  type FlightSummary,
} from "@/game/play";
import { createLunarFlightState } from "@/simulation/lunar2d";

describe("mission registry", () => {
  it("exposes five missions in progression order", () => {
    expect(MISSION_IDS).toEqual([
      "landing-fundamentals",
      "terminal-descent",
      "high-gate-challenge",
      "apollo11-powered-descent",
      "free-flight",
    ]);
  });

  it("every mission declares an available default mode and a historical note", () => {
    for (const id of MISSION_IDS) {
      const m = getMission(id);
      expect(m.availableControlModes).toContain(m.defaultControlMode);
      expect(m.historicalNote.length).toBeGreaterThan(10);
      expect(m.initial.descentPropellantKg).toBeGreaterThan(0);
      expect(scriptFor(id, m.defaultControlMode)).toBeDefined();
    }
  });

  it("uses the published Apollo 11 landmark altitudes", () => {
    // ~7,600 ft high gate and ~500 ft low gate.
    expect(DESCENT_LANDMARKS.highGateM).toBe(2316);
    expect(DESCENT_LANDMARKS.lowGateM).toBe(152);
    expect(DESCENT_LANDMARKS.poweredDescentInitiationM).toBe(15742);
    expect(MISSIONS["terminal-descent"].initial.altitudeM).toBe(DESCENT_LANDMARKS.lowGateM);
    expect(MISSIONS["high-gate-challenge"].initial.altitudeM).toBe(DESCENT_LANDMARKS.highGateM);
  });

  it("downrange geometry round-trips through the central angle", () => {
    const range = 7_400;
    const angle = LANDING_ZONE_ANGLE_RAD - angleForRange(range);
    expect(downrangeToLandingZoneM(angle, LANDING_ZONE_ANGLE_RAD)).toBeCloseTo(range, 6);
  });

  it("gear limits tighten from instructor to commander", () => {
    expect(LANDING_LIMITS.instructor.verticalSpeedMps).toBeGreaterThan(
      LANDING_LIMITS.pilot.verticalSpeedMps,
    );
    expect(LANDING_LIMITS.pilot.verticalSpeedMps).toBeGreaterThan(
      LANDING_LIMITS.commander.verticalSpeedMps,
    );
    expect(LANDING_LIMITS.commander.landingZoneRadiusM).toBeLessThan(
      LANDING_LIMITS.instructor.landingZoneRadiusM,
    );
  });
});

function summaryWith(overrides: Partial<FlightSummary> = {}): FlightSummary {
  const base = createLunarFlightState({ altitudeM: 0, descentPropellantKg: 400 });
  return {
    missionId: "terminal-descent",
    controlMode: "agc-assisted",
    assistance: "pilot",
    finalState: {
      ...base,
      terminalState: "landed",
      touchdown: {
        classification: "landed",
        missionTimeUs: 60_000_000,
        verticalSpeedMps: -0.4,
        horizontalSpeedMps: 0.1,
        tiltRad: 0.01,
        violations: [],
      },
    },
    landingZoneErrorM: 20,
    descentPropellantRemainingKg: 400,
    descentPropellantInitialKg: 900,
    controlRoughness: 0.2,
    takeover: null,
    procedure: {
      required: 3,
      completed: 3,
      incorrectEntries: 0,
      hintsUsed: 0,
      skipped: false,
      meanResponseSeconds: 5,
    },
    limits: LANDING_LIMITS.pilot,
    ...overrides,
  };
}

describe("scoring", () => {
  it("is deterministic for identical summaries", () => {
    expect(scoreMission(summaryWith())).toEqual(scoreMission(summaryWith()));
  });

  it("grades a clean landing highly", () => {
    const s = scoreMission(summaryWith());
    expect(s.outcome).toBe("landed");
    expect(s.grade).toBe("A");
    expect(s.total).toBeGreaterThan(80);
    expect(s.headline).toContain("Eagle has landed");
  });

  it("gives a crash an F and zero touchdown/accuracy credit", () => {
    const s = scoreMission(
      summaryWith({
        finalState: {
          ...summaryWith().finalState,
          terminalState: "crashed",
          touchdown: {
            classification: "crashed",
            missionTimeUs: 1,
            verticalSpeedMps: -25,
            horizontalSpeedMps: 10,
            tiltRad: 0.9,
            violations: ["vertical-speed", "horizontal-speed", "tilt"],
          },
        },
      }),
    );
    expect(s.grade).toBe("F");
    expect(s.components.find((c) => c.id === "touchdown")!.points).toBe(0);
    expect(s.components.find((c) => c.id === "accuracy")!.points).toBe(0);
    expect(s.notes.length).toBeGreaterThan(0);
  });

  it("penalises wrong DSKY entries and hints", () => {
    const clean = scoreMission(summaryWith());
    const messy = scoreMission(
      summaryWith({
        procedure: {
          required: 3,
          completed: 3,
          incorrectEntries: 4,
          hintsUsed: 2,
          skipped: false,
          meanResponseSeconds: 20,
        },
      }),
    );
    expect(messy.components.find((c) => c.id === "procedure")!.points).toBeLessThan(
      clean.components.find((c) => c.id === "procedure")!.points,
    );
  });

  it("awards Quick Manual half procedure credit", () => {
    const s = scoreMission(
      summaryWith({
        controlMode: "quick-manual",
        procedure: {
          required: 0,
          completed: 0,
          incorrectEntries: 0,
          hintsUsed: 0,
          skipped: true,
          meanResponseSeconds: 0,
        },
      }),
    );
    const p = s.components.find((c) => c.id === "procedure")!;
    expect(p.points).toBeCloseTo(p.maxPoints / 2, 6);
  });

  it("flags an early takeover and a low propellant margin", () => {
    const s = scoreMission(
      summaryWith({
        descentPropellantRemainingKg: 10,
        takeover: {
          missionTimeUs: 1,
          altitudeM: 2_000,
          horizontalSpeedMps: 40,
          verticalSpeedMps: -20,
          descentPropellantKg: 500,
          early: true,
        },
      }),
    );
    expect(s.notes.some((n) => n.includes("early"))).toBe(true);
    expect(s.notes.some((n) => n.includes("25 seconds"))).toBe(true);
  });
});
