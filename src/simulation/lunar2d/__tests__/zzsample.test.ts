import { describe, it } from "vitest";
import { createLunarFlightState, stepLunarFlight, computeOrbitalValues } from "@/simulation/lunar2d/index";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";
import { getMission, angleForRange, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD, FULL_DESCENT_PDI_RANGE_M } from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import { PHASE_HIGH_GATE_M, descentPhaseFor } from "@/game/play/descentPhase";
import { nominalStateAt, altitudeTargetFor, nominalAltitudeForRangeM, nominalDownrangeSpeedForRange, nominalGlideSlopeForRange, HIGH_GATE_RANGE_M, HIGH_GATE_AIM, LOW_GATE_AIM } from "@/game/play/descentTimeline";

describe("sample", () => { it("prints", () => {
  const m = getMission("full-descent");
  let s = createLunarFlightState({ altitudeM: m.initial.altitudeM, centralAngleRad: LANDING_ZONE_ANGLE_RAD - angleForRange(FULL_DESCENT_PDI_RANGE_M), radialSpeedMps: m.initial.radialSpeedMps, tangentialSpeedMps: m.initial.tangentialSpeedMps, attitudeRad: m.initial.attitudeRad, descentPropellantKg: m.initial.descentPropellantKg });
  const DT = 20_000; let terminal = false;
  const marks = [0,100,200,300,317,357,386,487,507,517,543,553,578,617,650,700,755];
  for (let i = 0; i * DT < 900e6; i++) {
    const tSec = (i*DT)/1e6;
    const o = computeOrbitalValues(s);
    const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    if (marks.includes(Math.round(tSec*100)/100) && Number.isInteger(tSec)) console.log(`T+${tSec} alt=${(o.altitudeM/0.3048).toFixed(0)}ft rng=${(rangeM/1852).toFixed(2)}nmi vh=${(o.tangentialSpeedMps/0.3048).toFixed(0)}fps sink=${(-o.radialSpeedMps/0.3048).toFixed(0)}fps`);
    if (o.altitudeM <= LOW_GATE_AIM.altitudeM) terminal = true;
    const env = dpsThrottleEnvelope(i*DT);
    const cue = computeReferenceGuidance(s, undefined, terminal && Math.abs(rangeM)<60 && Math.abs(o.tangentialSpeedMps)<2 ? null : {
      rangeToLandingZoneM: rangeM,
      targetAltitudeM: altitudeTargetFor(nominalAltitudeForRangeM(Math.abs(rangeM)), nominalStateAt(tSec).altitudeM),
      scheduleRangeErrorM: rangeM - nominalStateAt(tSec).rangeToLzM,
      maxTiltRad: o.altitudeM <= PHASE_HIGH_GATE_M && o.altitudeM > 120 ? Math.abs(descentPhaseFor(o.altitudeM,{p64Selected:true}).pitchRad) + (1-Math.max(0,Math.min(1,(30-Math.abs(o.tangentialSpeedMps))/26)))*8*(Math.PI/180) : null,
      targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
      targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)),
      handoverRangeM: HIGH_GATE_RANGE_M, handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps,
      approachAimRangeM: LOW_GATE_AIM.rangeToLzM, approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps,
      fixedThrottle: env.min===env.max?env.min:null, throttleMinFraction: env.min, throttleMaxFraction: env.max });
    let throttle = cue.recommendedThrottle;
    if (throttle > env.max) throttle = env.max;
    if (throttle > 0 && throttle < env.min) throttle = env.min;
    const err = cue.recommendedAttitudeRad - s.attitudeRad;
    const attitudeCommand = Math.max(-1, Math.min(1, err*3 - s.angularRateRadPerSec*2.5));
    s = stepLunarFlight(s, { throttle, engineCommand: throttle>0?"descent":"off", attitudeCommand }, DT);
    if (s.terminalState !== null) { console.log("terminal", s.terminalState, "at", tSec); break; }
  }
}); });
