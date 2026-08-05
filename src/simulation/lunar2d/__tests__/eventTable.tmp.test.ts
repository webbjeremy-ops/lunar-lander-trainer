// SPDX-License-Identifier: GPL-3.0-or-later
// Temporary reporting harness: prints the flown state at each scripted event.
import { describe, it } from "vitest";
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
  nominalGlideSlopeForRange,
  HIGH_GATE_RANGE_M,
  HIGH_GATE_AIM,
  LOW_GATE_AIM,
  DESCENT_TIMELINE,
} from "@/game/play/descentTimeline";

const MARKS = [
  0, 6, 26, 161, 221, 299, 315, 317, 357, 386, 487, 507, 510, 526, 543, 553, 578, 593, 604, 617,
];

describe("event table", () => {
  it("prints", () => {
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
    const rows: string[] = [];
    let terminal = false;
    let mi = 0;
    for (let i = 0; i * DT < 900e6; i++) {
      const tSec = (i * DT) / 1e6;
      const o = computeOrbitalValues(s);
      const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
      if (mi < MARKS.length && tSec >= MARKS[mi]!) {
        const massLb =
          (s.dryMassKg + s.descentPropellantKg + s.ascentPropellantKg + s.rcsPropellantKg) *
          2.20462;
        rows.push(
          [
            `T+${MARKS[mi]}`,
            (o.altitudeM / 0.3048).toFixed(0),
            (o.tangentialSpeedMps / 0.3048).toFixed(0),
            (-o.radialSpeedMps / 0.3048).toFixed(0),
            (rangeM / 1852).toFixed(2),
            massLb.toFixed(0),
            ((s.attitudeRad * 180) / Math.PI).toFixed(1),
            (s.descentPropellantKg / 8200).toFixed(3),
          ].join("\t"),
        );
        mi++;
      }
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
      if (s.terminalState !== null) break;
    }
    console.log("T\taltFt\thorizFps\tsinkFps\trangeNmi\tmassLb\tattDeg\tpropFrac");
    console.log(rows.join("\n"));
    console.log("initial", JSON.stringify(m.initial), DESCENT_TIMELINE.length);
  });
});
