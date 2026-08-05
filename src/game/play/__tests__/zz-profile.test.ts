import { describe, it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "@/simulation/lunar2d";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";
import { totalMassKg } from "@/simulation/lunar2d/physics";
import { getMission, angleForRange, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD, FULL_DESCENT_PDI_RANGE_M } from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import { PHASE_HIGH_GATE_M, descentPhaseFor } from "@/game/play/descentPhase";
import * as T from "@/game/play/descentTimeline";

describe("sample", () => { it("prints", () => {
  const m = getMission("full-descent");
  let s = createLunarFlightState({ altitudeM: m.initial.altitudeM,
    centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(FULL_DESCENT_PDI_RANGE_M),
    radialSpeedMps: m.initial.radialSpeedMps, tangentialSpeedMps: m.initial.tangentialSpeedMps,
    attitudeRad: m.initial.attitudeRad, descentPropellantKg: m.initial.descentPropellantKg });
  const DT = 20_000; const want = new Set([0,26,221,299,386,487,507,510,512,526,543,553,578,593,604,617,650,683,700,717,732,746,755,770,790]);
  let terminal = false;
  for (let i=0; i*DT < 900e6; i++) {
    const tSec = (i*DT)/1e6; const o = computeOrbitalValues(s);
    const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    if (want.has(Math.round(tSec)) && Math.abs(tSec-Math.round(tSec))<1e-6)
      console.log(`T+${Math.round(tSec)}\talt ${(o.altitudeM/0.3048).toFixed(0)} ft\tlat ${(o.tangentialSpeedMps/0.3048).toFixed(0)} fps\tROD ${(-o.radialSpeedMps/0.3048).toFixed(0)} fps\trng ${(rangeM/1852).toFixed(2)} nmi\tmass ${(totalMassKg(s)*2.20462).toFixed(0)} lb\tpitch ${(s.attitudeRad*180/Math.PI).toFixed(0)}`);
    if (o.altitudeM <= T.LOW_GATE_AIM.altitudeM) terminal = true;
    const env = dpsThrottleEnvelope(i*DT);
    const sched = T.nominalStateAt(tSec);
    let maxTilt: number|null = null, minTilt: number|null = null;
    if (tSec >= T.APPROACH_PITCH_START_SEC && o.altitudeM > 60) {
      const w = T.approachPitchRadAt(tSec); const tol = 6*Math.PI/180;
      maxTilt = w+tol; minTilt = Math.max(0,w-tol);
    } else if (o.altitudeM <= PHASE_HIGH_GATE_M && o.altitudeM > 120) {
      maxTilt = Math.abs(descentPhaseFor(o.altitudeM,{p64Selected:true}).pitchRad) + (1-Math.max(0,Math.min(1,(30-Math.abs(o.tangentialSpeedMps))/26)))*8*Math.PI/180;
    }
    const cue = computeReferenceGuidance(s, undefined,
      terminal && Math.abs(rangeM) < 60 && Math.abs(o.tangentialSpeedMps) < 2 ? null : {
        rangeToLandingZoneM: rangeM,
        targetAltitudeM: T.altitudeTargetFor(T.nominalAltitudeForRangeM(Math.abs(rangeM)), sched.altitudeM),
        scheduleRangeErrorM: rangeM - sched.rangeToLzM,
        maxTiltRad: maxTilt, minTiltRad: minTilt,
        targetDownrangeSpeedMps: T.nominalDownrangeSpeedForRange(Math.abs(rangeM)),
        targetGlideSlope: T.nominalGlideSlopeForRange(Math.abs(rangeM)),
        handoverRangeM: T.HIGH_GATE_RANGE_M, handoverSpeedMps: T.HIGH_GATE_AIM.downrangeSpeedMps,
        approachAimRangeM: T.LOW_GATE_AIM.rangeToLzM, approachAimSpeedMps: T.LOW_GATE_AIM.downrangeSpeedMps,
        fixedThrottle: env.min===env.max?env.min:null, throttleMinFraction: env.min, throttleMaxFraction: env.max });
    let throttle = cue.recommendedThrottle;
    if (throttle > env.max) throttle = env.max;
    if (throttle > 0 && throttle < env.min) throttle = env.min;
    const err = cue.recommendedAttitudeRad - s.attitudeRad;
    const attitudeCommand = Math.max(-1, Math.min(1, err*3 - s.angularRateRadPerSec*2.5));
    s = stepLunarFlight(s, { throttle, engineCommand: throttle>0?"descent":"off", attitudeCommand }, DT);
    if (s.terminalState !== null) { console.log("TERMINAL", s.terminalState, "at T+"+tSec.toFixed(0), (computeOrbitalValues(s).radialSpeedMps/0.3048).toFixed(1)+" fps"); break; }
  }
}); });
