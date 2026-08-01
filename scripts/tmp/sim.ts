import { stepLunarFlight, computeOrbitalValues } from "../../src/simulation/lunar2d";
import { computeReferenceGuidance } from "../../src/simulation/lunar2d/guidance";
import { DESCENT_MISSIONS } from "../../src/game/play/missions";
import { dpsThrottleEnvelope } from "../../src/game/play/ignitionSequence";
import * as tl from "../../src/game/play/descentTimeline";
console.log(Object.keys(tl));
console.log(DESCENT_MISSIONS.map((m:any)=>m.id));
