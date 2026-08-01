// SPDX-License-Identifier: GPL-3.0-or-later
//
// The braking phase must arrive at high gate ON range: the historical failure
// mode of this simulation was sailing tens of kilometres past the site.

import { describe, expect, it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "../index";
import { computeReferenceGuidance } from "../guidance";
import {
  getMission,
  angleForRange,
  downrangeToLandingZoneM,
  LANDING_ZONE_ANGLE_RAD,
} from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import {
  nominalAltitudeForRangeM,
  nominalDownrangeSpeedForRange,
  HIGH_GATE_RANGE_M,
} from "@/game/play/descentTimeline";

describe("guided powered descent", () => {
  it("reaches high gate on range and lands without overshooting the site", () => {
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
    let highGateSec: number | null = null;
    let worstOvershootM = 0;
    let landedSec: number | null = null;

    for (let i = 0; i * DT < 900e6; i++) {
      const tSec = (i * DT) / 1e6;
      const o = computeOrbitalValues(s);
      const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
      if (highGateSec === null && Math.abs(rangeM) <= HIGH_GATE_RANGE_M) highGateSec = tSec;
      if (rangeM < 0) worstOvershootM = Math.max(worstOvershootM, -rangeM);

      const env = dpsThrottleEnvelope(i * DT);
      const cue = computeReferenceGuidance(
        s,
        undefined,
        o.altitudeM <= 60
          ? null
          : {
              rangeToLandingZoneM: rangeM,
              targetAltitudeM: nominalAltitudeForRangeM(Math.abs(rangeM)),
              targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
              handoverRangeM: HIGH_GATE_RANGE_M,
              fixedThrottle: env.min === env.max ? env.min : null,
            },
      );
      let throttle = cue.recommendedThrottle;
      if (throttle > env.max) throttle = env.max;
      if (throttle > 0 && throttle < env.min) throttle = env.min;
      const err = cue.recommendedAttitudeRad - s.attitudeRad;
      const attitudeCommand = Math.max(
        -1,
        Math.min(1, err * 3 - s.angularRateRadPerSec * 2.5),
      );
      s = stepLunarFlight(
        s,
        { throttle, engineCommand: throttle > 0 ? "descent" : "off", attitudeCommand },
        DT,
      );
      if (s.terminalState !== null) {
        landedSec = tSec;
        break;
      }
    }

    expect(s.terminalState).toBe("landed");
    expect(highGateSec).not.toBeNull();
    // High gate is nominally T+08:26; allow a minute of guidance slack.
    expect(highGateSec!).toBeGreaterThan(440);
    expect(highGateSec!).toBeLessThan(580);
    // Never sail past the landing site.
    expect(worstOvershootM).toBeLessThan(500);
    expect(landedSec!).toBeLessThan(830);
  });
});
