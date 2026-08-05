import { it } from "vitest";
import { computeOrbitalValues, stepLunarFlight } from "@/simulation/lunar2d";
import { computeReferenceGuidance } from "@/simulation/lunar2d/guidance";
import { getMission, insertionStateForMission, downrangeToLandingZoneM, LANDING_ZONE_ANGLE_RAD } from "@/game/play/missions";
import { dpsThrottleEnvelope } from "@/game/play/ignitionSequence";
import { PHASE_HIGH_GATE_M, descentPhaseFor } from "@/game/play/descentPhase";
import { nominalStateAt, altitudeTargetFor, nominalAltitudeForRangeM, nominalDownrangeSpeedForRange, nominalGlideSlopeForRange, HIGH_GATE_RANGE_M, HIGH_GATE_AIM, LOW_GATE_AIM } from "@/game/play/descentTimeline";

it("profile", () => {
  const m = getMission("full-descent");
  let s = insertionStateForMission(m);
  const DT = 20_000;
  // coast 150 s
  for (let t = 0; t < 150e6; t += DT) s = stepLunarFlight(s, { throttle: 0, engineCommand: "off", attitudeCommand: 0 }, DT);
  let o = computeOrbitalValues(s);
  console.log("TIG alt ft", (o.altitudeM*3.28084)|0, "range nmi", (downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD)/1852)|0);
  for (let i = 0; i*DT < 800e6; i++) {
    const tSec = (i*DT)/1e6;
    o = computeOrbitalValues(s);
    if (o.altitudeM <= 0) { console.log("touchdown", tSec|0); break; }
    const rangeM = downrangeToLandingZoneM(o.centralAngleRad, LANDING_ZONE_ANGLE_RAD);
    const sched = nominalStateAt(tSec);
    const env = dpsThrottleEnvelope(i*DT);
    let maxTiltRad: number | null = null;
    if (o.altitudeM <= PHASE_HIGH_GATE_M && o.altitudeM > 120) {
      const pp = Math.abs(descentPhaseFor(o.altitudeM, { p64Selected: true }).pitchRad);
      const blend = Math.max(0, Math.min(1, (30 - Math.abs(o.tangentialSpeedMps))/26));
      maxTiltRad = pp + (1-blend)*8*(Math.PI/180);
    }
    const cue = computeReferenceGuidance(s, undefined, {
      rangeToLandingZoneM: rangeM,
      targetAltitudeM: altitudeTargetFor(nominalAltitudeForRangeM(Math.abs(rangeM)), sched.altitudeM),
      targetDownrangeSpeedMps: nominalDownrangeSpeedForRange(Math.abs(rangeM)),
      targetGlideSlope: nominalGlideSlopeForRange(Math.abs(rangeM)),
      handoverRangeM: HIGH_GATE_RANGE_M,
      handoverSpeedMps: HIGH_GATE_AIM.downrangeSpeedMps,
      approachAimRangeM: LOW_GATE_AIM.rangeToLzM,
      approachAimSpeedMps: LOW_GATE_AIM.downrangeSpeedMps,
      fixedThrottle: env.min === env.max ? env.min : null,
      throttleMinFraction: env.min, throttleMaxFraction: env.max,
      scheduleRangeErrorM: rangeM - sched.rangeToLzM,
      maxTiltRad,
    });
    if ([300,400,487,507,510,526,543,578,617].includes(Math.round(tSec)))
      console.log("T+"+Math.round(tSec), "alt ft", (o.altitudeM*3.28084)|0, "rng nmi", (rangeM/1852).toFixed(1), "pitch", (s.attitudeRad*180/Math.PI).toFixed(0));
    const err = cue.recommendedAttitudeRad - s.attitudeRad;
    s = stepLunarFlight(s, { throttle: cue.recommendedThrottle, engineCommand: "on", attitudeCommand: Math.max(-1, Math.min(1, err*3 - s.angularRateRadPerSec*2.5)) }, DT);
  }
});
