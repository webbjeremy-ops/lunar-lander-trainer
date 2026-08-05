// SPDX-License-Identifier: GPL-3.0-or-later
// TEMPORARY profile sampler (deleted before commit).
import { describe, it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "../index";
import { computeReferenceGuidance } from "../guidance";
import {
  getMission,
  angleForRange,
  downrangeToLandingZoneM,
  LANDING_ZONE_ANGLE_RAD,
  FULL_DESCENT_PDI_RANGE_M,
} from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import { PHASE_HIGH_GATE_M, descentPhaseFor } from "@/game/play/descentPhase";
import {
  nominalStateAt,
  altitudeTargetFor,
  nominalAltitudeForRangeM,
  nominalDownrangeSpeedForRange,
  nominalGlideSlopeForRange,
  approachPitchRadAt,
  approachAltitudeLeadM,
  nominalDownrangeSpeedAt,
  APPROACH_PITCH_START_SEC,
  HIGH_GATE_RANGE_M,
  HIGH_GATE_AIM,
  LOW_GATE_AIM,
} from "@/game/play/descentTimeline";

const FT = 0.3048;
const MARKS = [487, 507, 512, 526, 543, 578, 593, 604, 617, 683, 717, 746, 757];

describe("sampler", () => {
  it("prints", () => {
    const m = getMission("full-descent");
    let s = createLunarFlightState({
      altitudeM: m.initial.altitudeM,
      centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(FULL_DESCENT_PDI_RANGE_M),
      radialSpeedMps: m.initial.radialSpeedMps,
      tangentialSpeedMps: m.initial.tangentialSpeedMps,
      attitudeRad: m.initial.attitudeRad,
      descentPropellantKg: m.initial.descentPropellantKg,
    });
    const DT = 20_000;
    let terminal = false;
    const rows: string[] = [];
    for (let i = 0; i * DT < 900e6; i++) {
      const tSec = (i * DT) / 1e6;
      const o = computeOrbitalValues(s);
      const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
      const dbg = MARKS.includes(Math.round(tSec * 100) / 100) && Number.isInteger(tSec);
      if (false) {
        rows.push(
          `T+${tSec}  alt ${(o.altitudeM / FT).toFixed(0)} ft  lat ${(o.tangentialSpeedMps / FT).toFixed(0)} fps  rod ${(-o.radialSpeedMps / FT).toFixed(0)} fps  rng ${(rangeM / 1852).toFixed(2)} nmi  pitch ${((s.attitudeRad * 180) / Math.PI).toFixed(0)}`,
        );
      }
      if (o.altitudeM <= LOW_GATE_AIM.altitudeM) terminal = true;
      const env = dpsThrottleEnvelope(i * DT);
      const sched = nominalStateAt(tSec);
      let maxTiltRad: number | null = null;
      let minTiltRad: number | null = null;
      if (tSec >= APPROACH_PITCH_START_SEC && o.altitudeM > 60) {
        const walk = approachPitchRadAt(tSec);
        const headroom =
          tSec <= 530 ? 6 : tSec >= 612 ? 4 : 12 - 8 * Math.max(0, (tSec - 585) / 27);
        maxTiltRad = walk + headroom * (Math.PI / 180);
        minTiltRad = Math.max(0, walk - 6 * (Math.PI / 180));
      } else if (o.altitudeM <= PHASE_HIGH_GATE_M && o.altitudeM > 120) {
        const phasePitch = Math.abs(descentPhaseFor(o.altitudeM, { p64Selected: true }).pitchRad);
        const blend = Math.max(0, Math.min(1, (30 - Math.abs(o.tangentialSpeedMps)) / 26));
        maxTiltRad = phasePitch + (1 - blend) * 8 * (Math.PI / 180);
      }
      const cue = computeReferenceGuidance(
        s,
        undefined,
        terminal && Math.abs(rangeM) < 60 && Math.abs(o.tangentialSpeedMps) < 2
          ? null
          : {
              rangeToLandingZoneM: rangeM,
              targetAltitudeM: altitudeTargetFor(
                nominalAltitudeForRangeM(Math.abs(rangeM)),
                Math.max(0, sched.altitudeM + approachAltitudeLeadM(tSec)),
              ),
              scheduleRangeErrorM: rangeM - sched.rangeToLzM,
              maxTiltRad,
              minTiltRad,
              targetDownrangeSpeedMps: Math.min(
                nominalDownrangeSpeedForRange(Math.abs(rangeM)),
                nominalDownrangeSpeedAt(tSec) *
                  Math.max(
                    1,
                    Math.min(1.8, Math.abs(rangeM) / Math.max(200, sched.rangeToLzM)),
                  ),
              ),
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
      if (dbg) {
        rows.push(
          `T+${tSec} alt ${(o.altitudeM / FT).toFixed(0)} lat ${(o.tangentialSpeedMps / FT).toFixed(0)} rod ${(-o.radialSpeedMps / FT).toFixed(0)} rng ${(rangeM / 1852).toFixed(2)} pitch ${((s.attitudeRad * 180) / Math.PI).toFixed(0)}`,
        );
      }
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
        rows.push(`TOUCHDOWN T+${tSec.toFixed(1)} sink ${(-o.radialSpeedMps / FT).toFixed(1)} fps`);
        break;
      }
    }
    console.log(rows.join("\n"));
  });
});
