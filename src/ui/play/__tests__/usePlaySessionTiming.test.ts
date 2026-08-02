// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  createIgnitionState,
  reduceIgnition,
  getMission,
  insertionStateForMission,
  PRE_IGNITION_COAST_SEC,
  angleForRange,
  downrangeToLandingZoneM,
  LANDING_ZONE_ANGLE_RAD,
} from "@/game/play";
import { computeOrbitalValues } from "@/simulation/lunar2d";
import { shouldAdvanceFlightPhysics } from "../usePlaySession";

describe("Full Descent pre-TIG coast", () => {
  it("keeps integrating through the countdown instead of freezing", () => {
    const countdown = reduceIgnition(createIgnitionState(), { kind: "start" });
    expect(shouldAdvanceFlightPhysics("full-descent", countdown, false)).toBe(true);
  });

  it("still integrates at ignition", () => {
    let ignition = reduceIgnition(createIgnitionState(), { kind: "start" });
    ignition = reduceIgnition(ignition, { kind: "arm", on: true });
    ignition = reduceIgnition(ignition, { kind: "tick", dtUs: 115_000_000 });
    ignition = reduceIgnition(ignition, { kind: "proceed" });
    ignition = reduceIgnition(ignition, { kind: "tick", dtUs: 35_000_000 });
    expect(shouldAdvanceFlightPhysics("full-descent", ignition, false)).toBe(true);
  });

  it("inserts uprange of PDI at descent-orbit speed", () => {
    const m = getMission("full-descent");
    const s = insertionStateForMission(m, PRE_IGNITION_COAST_SEC);
    const o = computeOrbitalValues(s);
    // Already moving fast — about 1,698 m/s (5,570 ft/s) before the burn.
    expect(o.tangentialSpeedMps).toBeGreaterThan(1_650);
    // And short of the PDI point by roughly a coast-length of ground track.
    const range = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    expect(range).toBeGreaterThan(m.initial.rangeToLandingZoneM + 200_000);
    expect(angleForRange(range)).toBeGreaterThan(0);
  });

  it("coasts back onto the PDI state at TIG", () => {
    const m = getMission("full-descent");
    const s = insertionStateForMission(m, 0);
    const o = computeOrbitalValues(s);
    expect(o.altitudeM).toBeCloseTo(m.initial.altitudeM, 0);
    expect(o.tangentialSpeedMps).toBeCloseTo(m.initial.tangentialSpeedMps, 0);
  });
});
