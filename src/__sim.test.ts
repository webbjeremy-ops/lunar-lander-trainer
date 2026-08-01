import { it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues, computeReferenceGuidance } from "@/simulation/lunar2d";
import { MISSIONS, angleForRange, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD, nominalAltitudeForRangeM, HIGH_GATE_RANGE_M, dpsThrottleEnvelope } from "@/game/play";

it("guided full descent", () => {
  const m = MISSIONS["full-descent"]!;
  let s = createLunarFlightState({
    altitudeM: m.initial.altitudeM,
    centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(m.initial.rangeToLandingZoneM),
    radialSpeedMps: m.initial.radialSpeedMps,
    tangentialSpeedMps: m.initial.tangentialSpeedMps,
    attitudeRad: m.initial.attitudeRad,
    descentPropellantKg: m.initial.descentPropellantKg,
  });
  const STEP=20_000; let t=0; let hg=false;
  for (let i=0;i<45000 && s.terminalState===null;i++){
    const o=computeOrbitalValues(s);
    const range=downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    const env0=dpsThrottleEnvelope(t);
    const env=env0;
    const useProfile=o.altitudeM>60;
    const cue=computeReferenceGuidance(s,undefined,useProfile?{rangeToLandingZoneM:range,targetAltitudeM:nominalAltitudeForRangeM(Math.abs(range)),handoverRangeM:HIGH_GATE_RANGE_M,fixedThrottle: env.min===env.max?env.min:null}:null);
    let throttle=Math.min(cue.recommendedThrottle, env.max);
    if (throttle>0 && throttle<env.min) throttle=env.min;
    const err=cue.recommendedAttitudeRad - s.attitudeRad;
    const cmd=Math.max(-1,Math.min(1,err*3 - s.angularRateRadPerSec*2.5));
    s=stepLunarFlight(s,{throttle,engineCommand: throttle>0?"descent":"off",attitudeCommand:cmd},STEP);
    t+=STEP;
    if (i%1500===0) console.log((t/1e6).toFixed(0),"s alt",o.altitudeM.toFixed(0),"vh",o.tangentialSpeedMps.toFixed(0),"vr",o.radialSpeedMps.toFixed(1),"rng",(range/1000).toFixed(1),"km thr",throttle.toFixed(2),"pitch",(s.attitudeRad*57.3).toFixed(0));
    if(!hg && o.altitudeM<2316){hg=true;console.log("HIGH GATE at t",(t/1e6).toFixed(0),"range km",(range/1000).toFixed(2),"vh",o.tangentialSpeedMps.toFixed(0));}
  }
  const o=computeOrbitalValues(s);
  console.log("END", s.terminalState, "t",(t/1e6).toFixed(0),"alt",o.altitudeM.toFixed(1),"range km",(downrangeToLandingZoneM(o.centralAngleRad,LANDING_ZONE_ANGLE_RAD)/1000).toFixed(2),"vr",o.radialSpeedMps.toFixed(2),"prop",s.descentPropellantKg.toFixed(0));
});
