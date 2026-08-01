// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { createIgnitionState, reduceIgnition } from "@/game/play";
import { shouldAdvanceFlightPhysics } from "../usePlaySession";

describe("Full Descent pre-TIG physics gate", () => {
  it("holds the configured PDI state throughout the countdown", () => {
    const countdown = reduceIgnition(createIgnitionState(), { kind: "start" });
    expect(shouldAdvanceFlightPhysics("full-descent", countdown, false)).toBe(false);
  });

  it("starts physical integration at ignition", () => {
    let ignition = reduceIgnition(createIgnitionState(), { kind: "start" });
    ignition = reduceIgnition(ignition, { kind: "arm", on: true });
    ignition = reduceIgnition(ignition, { kind: "tick", dtUs: 25_000_000 });
    ignition = reduceIgnition(ignition, { kind: "proceed" });
    ignition = reduceIgnition(ignition, { kind: "tick", dtUs: 35_000_000 });
    expect(shouldAdvanceFlightPhysics("full-descent", ignition, false)).toBe(true);
  });

  it("does not freeze other missions or an abort trajectory", () => {
    const countdown = reduceIgnition(createIgnitionState(), { kind: "start" });
    expect(shouldAdvanceFlightPhysics("free-flight", countdown, false)).toBe(true);
    expect(shouldAdvanceFlightPhysics("full-descent", countdown, true)).toBe(true);
  });
});