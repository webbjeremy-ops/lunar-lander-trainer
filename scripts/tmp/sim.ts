import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "../../src/simulation/lunar2d";
import { computeReferenceGuidance } from "../../src/simulation/lunar2d/guidance";
import { getMission, angleForRange, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD } from "../../src/game/play/missions";
import { dpsThrottleEnvelope } from "../../src/game/play/ignitionSequence";
import { nominalAltitudeForRangeM, nominalDownrangeSpeedForRange, HIGH_GATE_RANGE_M } from "../../src/game/play/descentTimeline";

const m = getMission("full-descent" as any);
let s = createLunarFlightState({
  altitudeM: m.initial.altitudeM,
  centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(m.initial.rangeToLandingZoneM),
  radialSpeedMps: m.initial.radialSpeedMps,
  tangentialSpeedMps: m.initial.tangentialSpeedMps,
  attitudeRad: m.initial.attitudeRad,
  descentPropellantKg: m.initial.descentPropellantKg,
});
const DT = 20_000;
for (let i = 0; i * DT < 800e6; i++) {
  const t = (i * DT) / 1e6;
  const o = computeOrbitalValues(s);
  const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
  const env = dpsThrottleEnvelope(i * DT);
  const useProfile = o.altitudeM > 60;
  const cue = computeReferenceGuidance(s, undefined, !useProfile ? null : {
    rangeToLandingZoneM: rangeM,
    targetAltitudeM: nominalAltitudeForRangeM(Math.abs(rangeM)),
    targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
    handoverRangeM: HIGH_GATE_RANGE_M,
    fixedThrottle: env.min === env.max ? env.min : null,
  });
  let throttle = cue.recommendedThrottle;
  if (throttle > env.max) throttle = env.max;
  if (throttle > 0 && throttle < env.min) throttle = env.min;
  const err = cue.recommendedAttitudeRad - s.attitudeRad;
  const att = Math.max(-1, Math.min(1, err * 3 - s.angularRateRadPerSec * 2.5));
  if (t % 30 < 0.02) console.log(`t=${t.toFixed(0)} alt=${(o.altitudeM).toFixed(0)} rng=${(rangeM/1000).toFixed(2)}km v=${o.tangentialSpeedMps.toFixed(1)} vr=${o.radialSpeedMps.toFixed(1)} thr=${throttle.toFixed(2)} pitch=${(cue.recommendedAttitudeRad*180/Math.PI).toFixed(0)} nomAlt=${nominalAltitudeForRangeM(Math.abs(rangeM)).toFixed(0)} nomV=${nominalDownrangeSpeedForRange(Math.abs(rangeM)).toFixed(0)}`);
  s = stepLunarFlight(s, { throttle, engineCommand: throttle>0?"descent":"off", attitudeCommand: att }, DT);
  if (s.terminalState) { console.log("TERMINAL", s.terminalState, t); break; }
}
