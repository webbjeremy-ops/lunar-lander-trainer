import { it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "@/simulation/lunar2d/index";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";
import { getMission, angleForRange, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD } from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import { nominalAltitudeForRangeM, nominalDownrangeSpeedForRange, nominalGlideSlopeForRange, HIGH_GATE_RANGE_M, HIGH_GATE_AIM, LOW_GATE_AIM } from "@/game/play/descentTimeline";
it("steps", () => {
  const m = getMission("full-descent");
  let s = createLunarFlightState({ altitudeM: m.initial.altitudeM, centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(m.initial.rangeToLandingZoneM), radialSpeedMps: m.initial.radialSpeedMps, tangentialSpeedMps: m.initial.tangentialSpeedMps, attitudeRad: m.initial.attitudeRad, descentPropellantKg: m.initial.descentPropellantKg });
  const DT = 20_000; let prev: number | null = null;
  for (let i = 0; i * DT < 900e6; i++) {
    const t = (i*DT)/1e6; const o = computeOrbitalValues(s);
    const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    const env = dpsThrottleEnvelope(i*DT);
    const cue = computeReferenceGuidance(s, undefined, o.altitudeM <= LOW_GATE_AIM.altitudeM ? null : { rangeToLandingZoneM: rangeM, targetAltitudeM: nominalAltitudeForRangeM(Math.abs(rangeM)), targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)), targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)), handoverRangeM: HIGH_GATE_RANGE_M, handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps, approachAimRangeM: LOW_GATE_AIM.rangeToLzM, approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps, fixedThrottle: env.min===env.max?env.min:null, throttleMinFraction: env.min, throttleMaxFraction: env.max });
    if (prev !== null && Math.abs(cue.recommendedAttitudeRad - prev) > 0.15 && o.altitudeM > LOW_GATE_AIM.altitudeM) console.log("STEP t",t.toFixed(2),"alt",o.altitudeM.toFixed(0),"rng",(rangeM/1000).toFixed(2),"vh",o.tangentialSpeedMps.toFixed(1),"prev",prev.toFixed(2),"now",cue.recommendedAttitudeRad.toFixed(2),"thr",cue.recommendedThrottle.toFixed(2));
    prev = cue.recommendedAttitudeRad;
    let thr = cue.recommendedThrottle; if (thr>env.max) thr=env.max; if (thr>0&&thr<env.min) thr=env.min;
    const err = cue.recommendedAttitudeRad - s.attitudeRad;
    s = stepLunarFlight(s, { throttle: thr, engineCommand: thr>0?"descent":"off", attitudeCommand: Math.max(-1,Math.min(1,err*3 - s.angularRateRadPerSec*2.5)) }, DT);
    if (s.terminalState) { console.log("END", s.terminalState, t.toFixed(0)); break; }
  }
});
