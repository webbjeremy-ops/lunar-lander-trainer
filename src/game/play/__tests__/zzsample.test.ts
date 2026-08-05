// SPDX-License-Identifier: GPL-3.0-or-later
// TEMPORARY measurement harness — mirrors the guided branch of usePlaySession.
import { describe, it } from "vitest";
import {
  createLunarFlightState,
  stepLunarFlight,
  computeOrbitalValues,
  totalMassKg,
} from "@/simulation/lunar2d";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";
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
  nominalDownrangeSpeedAt,
  nominalGlideSlopeForRange,
  approachPitchRadAt,
  approachAltitudeLeadM,
  APPROACH_PITCH_START_SEC,
  HIGH_GATE_RANGE_M,
  HIGH_GATE_AIM,
  LOW_GATE_AIM,
} from "@/game/play/descentTimeline";

const FT = 0.3048;
const NMI = 1852;
const MARKS = [0, 26, 286, 386, 487, 507, 512, 526, 543, 553, 578, 593, 604, 617];

describe("sample descent", () => {
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
    let mi = 0;
    for (let i = 0; i * DT < 700e6; i++) {
      const tSec = (i * DT) / 1e6;
      const o = computeOrbitalValues(s);
      const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
      if (mi < MARKS.length && tSec >= MARKS[mi]!) {
        rows.push(
          `T+${String(MARKS[mi]).padStart(3, "0")} alt=${(o.altitudeM / FT).toFixed(0)}ft ` +
            `lat=${(o.tangentialSpeedMps / FT).toFixed(0)}fps sink=${(-o.radialSpeedMps / FT).toFixed(0)}fps ` +
            `rng=${(rangeM / NMI).toFixed(2)}nmi mass=${(totalMassKg(s) * 2.2046).toFixed(0)}lb ` +
            `pitch=${((-Math.abs(s.attitudeRad) * 180) / Math.PI).toFixed(0)}deg`,
        );
        mi++;
      }
      if (o.altitudeM <= LOW_GATE_AIM.altitudeM) terminal = true;
      const useProfile = !terminal || Math.abs(rangeM) >= 60 || Math.abs(o.tangentialSpeedMps) >= 2;
      const env = dpsThrottleEnvelope(i * DT);
      const schedSec = tSec;
      const sched = nominalStateAt(schedSec);
      let maxTiltRad: number | null = null;
      let minTiltRad: number | null = null;
      const corridorSec =
        schedSec >= APPROACH_PITCH_START_SEC && o.altitudeM > 60 ? schedSec : null;
      if (corridorSec !== null) {
        const walk = approachPitchRadAt(corridorSec);
        const headroom =
          corridorSec <= 530
            ? 4
            : corridorSec >= 610
              ? 3
              : 7 - 4 * Math.max(0, (corridorSec - 590) / 20);
        maxTiltRad = walk + headroom * (Math.PI / 180);
        minTiltRad = Math.max(0, walk - 3 * (Math.PI / 180));
      } else if (o.altitudeM <= PHASE_HIGH_GATE_M && o.altitudeM > 120) {
        const phasePitch = Math.abs(descentPhaseFor(o.altitudeM, { p64Selected: true }).pitchRad);
        const blend = Math.max(0, Math.min(1, (30 - Math.abs(o.tangentialSpeedMps)) / 26));
        maxTiltRad = phasePitch + (1 - blend) * 8 * (Math.PI / 180);
      }
      const cue = computeReferenceGuidance(s, undefined, !useProfile ? null : {
        rangeToLandingZoneM: rangeM,
        targetAltitudeM: altitudeTargetFor(
          nominalAltitudeForRangeM(Math.abs(rangeM)),
          Math.max(0, sched.altitudeM + approachAltitudeLeadM(schedSec)),
        ),
        targetDownrangeSpeedMps: Math.min(
          nominalDownrangeSpeedForRange(Math.abs(rangeM)),
          nominalDownrangeSpeedAt(schedSec) *
            Math.max(1, Math.min(1.8, Math.abs(rangeM) / Math.max(200, sched.rangeToLzM))),
        ),
        handoverRangeM: HIGH_GATE_RANGE_M,
        fixedThrottle: env.min === env.max ? env.min : null,
        handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps,
        approachAimRangeM: LOW_GATE_AIM.rangeToLzM,
        approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps,
        targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)),
        throttleMinFraction: env.min,
        throttleMaxFraction: env.max,
        scheduleRangeErrorM: rangeM - sched.rangeToLzM,
        maxTiltRad,
        minTiltRad,
      });
      let throttle = cue.recommendedThrottle;
      if (throttle > env.max) throttle = env.max;
      if (throttle > 0 && throttle < env.min) throttle = env.min;
      const err = cue.recommendedAttitudeRad - s.attitudeRad;
      const attitudeCommand = Math.max(-1, Math.min(1, err * 3 - s.angularRateRadPerSec * 2.5));
      s = stepLunarFlight(s, { throttle, engineCommand: throttle > 0 ? "descent" : "off", attitudeCommand }, DT);
      if (s.terminalState !== null) break;
    }
    console.log("\n" + rows.join("\n"));
  });
});
