import { test } from "vitest";
import { runAscentProfile, ascentOrbit, ASCENT_MISSION_IDS, ASCENT_MISSIONS, targetForMission } from "@/game/ascent";
test("tune", () => {
  for (const id of ASCENT_MISSION_IDS) {
    const m = ASCENT_MISSIONS[id];
    const r = runAscentProfile(m, { maxSeconds: 900, coastSeconds: 0 });
    const o = ascentOrbit(r.finalState, m);
    const t = targetForMission(m);
    console.log(id, r.outcome, "t=", (r.cutoffMissionTimeUs??0)/1e6,
      "peri", (o.periapsisAltitudeM/1000).toFixed(1), "apo", ((o.apoapsisAltitudeM??0)/1000).toFixed(1),
      "target", (t.periapsisAltitudeM/1000).toFixed(1), (t.apoapsisAltitudeM/1000).toFixed(1),
      "prop", r.finalState.ascentPropellantKg.toFixed(0), "vr", o.radialSpeedMps.toFixed(1), "alt", (o.altitudeM/1000).toFixed(1));
  }
});
