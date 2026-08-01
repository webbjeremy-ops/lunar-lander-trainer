// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.29 — The braking phase must DELIVER the vehicle to the historical high
// gate: altitude, range, speed and time together, not merely "get low". The
// original failure mode was sailing past the site; the second was arriving
// low, short and slow. This test pins the flown geometry at both gates and at
// touchdown, using exactly the guidance inputs the cockpit session passes.

import { describe, expect, it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "../index";
import { computeReferenceGuidance } from "../guidance";
import {
  getMission,
  angleForRange,
  downrangeToLandingZoneM,
  LANDING_ZONE_ANGLE_RAD,
  LANDING_LIMITS,
} from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import {
  nominalAltitudeForRangeM,
  nominalDownrangeSpeedForRange,
  nominalGlideSlopeForRange,
  HIGH_GATE_RANGE_M,
  HIGH_GATE_AIM,
  LOW_GATE_AIM,
} from "@/game/play/descentTimeline";

interface Sample {
  readonly tSec: number;
  readonly altitudeM: number;
  readonly rangeM: number;
  readonly downrangeSpeedMps: number;
  readonly sinkMps: number;
}

function flyGuidedDescent() {
  const m = getMission("full-descent");
  let s = createLunarFlightState({
    altitudeM: m.initial.altitudeM,
    centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(m.initial.rangeToLandingZoneM),
    radialSpeedMps: m.initial.radialSpeedMps,
    tangentialSpeedMps: m.initial.tangentialSpeedMps,
    attitudeRad: m.initial.attitudeRad,
    descentPropellantKg: m.initial.descentPropellantKg,
  });
  const DT = 20_000;
  let highGate: Sample | null = null;
  let lowGate: Sample | null = null;
  let touchdown: Sample | null = null;
  let worstOvershootM = 0;
  let worstPitchStepRad = 0;
  let previousCommandRad: number | null = null;
  // Once below low gate the vehicle stays in the terminal law: without the
  // latch it chatters between profile and terminal guidance and hovers.
  let terminal = false;

  for (let i = 0; i * DT < 900e6; i++) {
    const tSec = (i * DT) / 1e6;
    const o = computeOrbitalValues(s);
    const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    const sample: Sample = {
      tSec,
      altitudeM: o.altitudeM,
      rangeM,
      downrangeSpeedMps: o.tangentialSpeedMps,
      sinkMps: -o.radialSpeedMps,
    };
    if (highGate === null && o.altitudeM <= HIGH_GATE_AIM.altitudeM) highGate = sample;
    if (lowGate === null && o.altitudeM <= LOW_GATE_AIM.altitudeM) lowGate = sample;
    if (rangeM < 0) worstOvershootM = Math.max(worstOvershootM, -rangeM);

    // Below low gate guidance keeps the range-aware target — the vehicle must
    // still FLY to the site, not settle wherever it happens to be.
    if (o.altitudeM <= LOW_GATE_AIM.altitudeM) terminal = true;
    const env = dpsThrottleEnvelope(i * DT);
    const cue = computeReferenceGuidance(
      s,
      undefined,
      terminal && Math.abs(rangeM) < 60 && Math.abs(o.tangentialSpeedMps) < 2
        ? null
        : {
            rangeToLandingZoneM: rangeM,
            targetAltitudeM: nominalAltitudeForRangeM(Math.abs(rangeM)),
            targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
            targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)),
            handoverRangeM: HIGH_GATE_RANGE_M,
            handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps,
            approachAimRangeM: LOW_GATE_AIM.rangeToLzM,
            approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps,
            fixedThrottle: env.min === env.max ? env.min : null,
            throttleMinFraction: env.min,
            throttleMaxFraction: env.max,
          },
    );
    // Commanded pitch must be continuous — no step at throttle recovery.
    if (previousCommandRad !== null && !terminal) {
      worstPitchStepRad = Math.max(
        worstPitchStepRad,
        Math.abs(cue.recommendedAttitudeRad - previousCommandRad),
      );
    }
    previousCommandRad = cue.recommendedAttitudeRad;

    let throttle = cue.recommendedThrottle;
    if (throttle > env.max) throttle = env.max;
    if (throttle > 0 && throttle < env.min) throttle = env.min;
    const err = cue.recommendedAttitudeRad - s.attitudeRad;
    const attitudeCommand = Math.max(-1, Math.min(1, err * 3 - s.angularRateRadPerSec * 2.5));
    s = stepLunarFlight(
      s,
      { throttle, engineCommand: throttle > 0 ? "descent" : "off", attitudeCommand },
      DT,
    );
    if (s.terminalState !== null) {
      touchdown = sample;
      break;
    }
  }

  return { state: s, highGate, lowGate, touchdown, worstOvershootM, worstPitchStepRad };
}

describe("guided powered descent", () => {
  const run = flyGuidedDescent();

  it("lands, and never sails past the landing site", () => {
    expect(run.state.terminalState).toBe("landed");
    expect(run.worstOvershootM).toBeLessThan(500);
  });

  it("arrives at the historical high-gate aim point", () => {
    const hg = run.highGate;
    expect(hg).not.toBeNull();
    // T+08:26 nominal.
    expect(Math.abs(hg!.tSec - HIGH_GATE_AIM.tSec)).toBeLessThanOrEqual(40);
    // 4.1 nmi still to run, closing at ~500 ft/s.
    expect(Math.abs(hg!.rangeM - HIGH_GATE_AIM.rangeToLzM)).toBeLessThanOrEqual(1_500);
    expect(
      Math.abs(hg!.downrangeSpeedMps - HIGH_GATE_AIM.downrangeSpeedMps),
    ).toBeLessThanOrEqual(30);
    // Descending, not ballooning: the pre-M4.29 law climbed ~700 m after PDI.
    expect(hg!.sinkMps).toBeGreaterThan(0);
  });

  it("arrives at low gate settled and over the site", () => {
    const lg = run.lowGate;
    expect(lg).not.toBeNull();
    expect(Math.abs(lg!.tSec - LOW_GATE_AIM.tSec)).toBeLessThanOrEqual(45);
    expect(Math.abs(lg!.rangeM)).toBeLessThanOrEqual(900);
    expect(Math.abs(lg!.downrangeSpeedMps)).toBeLessThanOrEqual(35);
  });

  it("touches down near the historical time, inside the landing zone and gear limits", () => {
    const td = run.touchdown;
    expect(td).not.toBeNull();
    expect(td!.tSec).toBeGreaterThan(640);
    expect(td!.tSec).toBeLessThan(830);
    expect(Math.abs(td!.rangeM)).toBeLessThan(LANDING_LIMITS.pilot.landingZoneRadiusM);
    expect(td!.sinkMps).toBeLessThan(LANDING_LIMITS.pilot.verticalSpeedMps);
    expect(Math.abs(td!.downrangeSpeedMps)).toBeLessThan(
      LANDING_LIMITS.pilot.horizontalSpeedMps,
    );
  });

  it("commands a continuous pitch profile through throttle recovery", () => {
    expect(run.worstPitchStepRad).toBeLessThan(0.55); // no pitch-over snap
  });

  it("still has descent propellant at contact", () => {
    expect(run.state.descentPropellantKg).toBeGreaterThan(150);
  });
});
