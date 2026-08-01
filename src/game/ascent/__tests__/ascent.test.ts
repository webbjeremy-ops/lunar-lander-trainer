// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Acceptance tests for the lunar-ascent game layer.
//
// These are independent of the UI: they exercise the pure orbital math, the
// deterministic profile runner, the failure modes and the physics firewall.

import { describe, expect, it } from "vitest";
import {
  ASCENT_MISSIONS,
  ASCENT_MISSION_IDS,
  ASCENT_TEACHING_NOTES,
  ascentOrbit,
  attitudeCommandFor,
  computeAscentGuidance,
  createAscentInitialState,
  evaluateAscentOutcome,
  getAscentTarget,
  NMI_M,
  parametersForAscentMission,
  remainingAscentDeltaVMps,
  runAscentProfile,
  sampleCoastArc,
  scoreAscent,
  targetForMission,
  targetOrbitError,
  timeToApoapsisSeconds,
  type AscentSummary,
} from "@/game/ascent";
import {
  computeOrbitalValues,
  createLunarFlightState,
  totalMassKg,
} from "@/simulation/lunar2d";
import { DEFAULT_LUNAR_FLIGHT_PARAMETERS as P } from "@/simulation/lunar2d/LunarMissionConstants";

const R = P.terrain.meanRadiusM;
const MU = P.environment.gravitationalParameterM3S2.value;

function circularState(altitudeM: number) {
  const r = R + altitudeM;
  return createLunarFlightState(
    {
      altitudeM,
      radialSpeedMps: 0,
      tangentialSpeedMps: Math.sqrt(MU / r),
      configuration: "ascent-stage",
      ascentPropellantKg: 200,
    },
    P,
  );
}

describe("M4.3 — orbital evaluation (independent of the flight loop)", () => {
  it("computes a circular orbit with matching apsides", () => {
    const o = computeOrbitalValues(circularState(50_000), P);
    expect(o.eccentricity).toBeLessThan(1e-6);
    expect(o.periapsisAltitudeM).toBeCloseTo(50_000, 0);
    expect(o.apoapsisAltitudeM ?? 0).toBeCloseTo(50_000, 0);
  });

  it("time to apoapsis is half the period from periapsis", () => {
    const rp = R + 20_000;
    const ra = R + 100_000;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(MU * (2 / rp - 1 / a));
    const state = createLunarFlightState(
      {
        altitudeM: rp - R,
        radialSpeedMps: 0,
        tangentialSpeedMps: vp,
        configuration: "ascent-stage",
      },
      P,
    );
    const o = computeOrbitalValues(state, P);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
    const t = timeToApoapsisSeconds(o, P);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(period / 2 - 1);
    expect(t!).toBeLessThan(period / 2 + 1);
  });

  it("time to apoapsis is zero for a circular orbit", () => {
    expect(timeToApoapsisSeconds(computeOrbitalValues(circularState(80_000), P), P)).toBe(0);
  });

  it("remaining delta-v follows the Tsiolkovsky equation", () => {
    const s = circularState(60_000);
    const ve =
      P.ascentEngine.specificImpulseS.value * P.environment.standardGravityMps2.value;
    const m0 = totalMassKg(s);
    const expected = ve * Math.log(m0 / (m0 - s.ascentPropellantKg));
    expect(remainingAscentDeltaVMps(s, P)).toBeCloseTo(expected, 6);
  });

  it("delta-v is not fuel quantity: the same propellant is worth more on a lighter vehicle", () => {
    const heavy = createLunarFlightState(
      { altitudeM: 20_000, configuration: "ascent-stage", ascentPropellantKg: 300, rcsPropellantKg: 200 },
      P,
    );
    const light = createLunarFlightState(
      { altitudeM: 20_000, configuration: "ascent-stage", ascentPropellantKg: 300, rcsPropellantKg: 0 },
      P,
    );
    expect(remainingAscentDeltaVMps(light, P)).toBeGreaterThan(
      remainingAscentDeltaVMps(heavy, P),
    );
  });

  it("target error is signed and peaks at the target orbit", () => {
    const target = getAscentTarget("apollo11-insertion-9x45");
    const onTarget = computeOrbitalValues(
      (() => {
        const rp = R + target.periapsisAltitudeM;
        const ra = R + target.apoapsisAltitudeM;
        const a = (rp + ra) / 2;
        return createLunarFlightState(
          {
            altitudeM: rp - R,
            radialSpeedMps: 0,
            tangentialSpeedMps: Math.sqrt(MU * (2 / rp - 1 / a)),
            configuration: "ascent-stage",
          },
          P,
        );
      })(),
      P,
    );
    const err = targetOrbitError(onTarget, target);
    expect(Math.abs(err.periapsisErrorM)).toBeLessThan(50);
    expect(Math.abs(err.apoapsisErrorM ?? 1e9)).toBeLessThan(50);
    expect(err.quality).toBeGreaterThan(0.99);

    const low = targetOrbitError(computeOrbitalValues(circularState(5_000), P), target);
    expect(low.periapsisErrorM).toBeLessThan(0);
    expect(low.quality).toBeLessThan(err.quality);
  });

  it("samples a closed coast conic that stays finite", () => {
    const arc = sampleCoastArc(computeOrbitalValues(circularState(50_000), P), 64, P);
    expect(arc.length).toBeGreaterThan(60);
    for (const p of arc) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThan(R * 0.9);
      expect(Number.isFinite(r)).toBe(true);
    }
  });
});

describe("M4.3 — mission registry and provenance", () => {
  it("registers four missions with resolvable, labelled targets", () => {
    expect(ASCENT_MISSION_IDS).toHaveLength(4);
    for (const id of ASCENT_MISSION_IDS) {
      const m = ASCENT_MISSIONS[id];
      const t = targetForMission(m);
      expect(t.classification).toBeTruthy();
      expect(t.rationale.length).toBeGreaterThan(10);
      expect(m.historicalNote.length).toBeGreaterThan(10);
    }
  });

  it("uses the published Apollo 11 insertion and phasing targets", () => {
    const ins = getAscentTarget("apollo11-insertion-9x45");
    expect(ins.periapsisAltitudeM / NMI_M).toBeCloseTo(9, 1);
    expect(ins.apoapsisAltitudeM / NMI_M).toBeCloseTo(45, 1);
    const ph = getAscentTarget("apollo11-phasing-49x45");
    expect(ph.apoapsisAltitudeM / NMI_M).toBeCloseTo(49, 1);
    expect(ph.periapsisAltitudeM / NMI_M).toBeCloseTo(45, 1);
  });

  it("ships the required teaching notes", () => {
    const ids = ASCENT_TEACHING_NOTES.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "why-pitch-over",
        "high-apoapsis-low-periapsis",
        "cutoff-timing",
        "mass-loss",
        "delta-v",
        "phasing",
      ]),
    );
  });
});

describe("M4.3 — staging and liftoff", () => {
  it("starts as a complete LM on the surface with a spent descent stage", () => {
    const m = ASCENT_MISSIONS["liftoff-fundamentals"];
    const s = createAscentInitialState(m);
    expect(s.configuration).toBe("complete-lm");
    expect(s.descentPropellantKg).toBe(0);
    expect(s.ascentPropellantKg).toBeCloseTo(m.ascentPropellantKg, 6);
    expect(computeOrbitalValues(s, parametersForAscentMission(m)).altitudeM).toBeCloseTo(0, 3);
  });

  it("leaves the descent stage on the surface after separation", () => {
    const m = ASCENT_MISSIONS["liftoff-fundamentals"];
    const r = runAscentProfile(m, { maxSeconds: 30 });
    expect(r.finalState.configuration).toBe("ascent-stage");
    const stage = r.finalState.separatedDescentStage;
    expect(stage).not.toBeNull();
    const stageAlt = Math.hypot(stage!.positionM[0], stage!.positionM[1]) - R;
    expect(Math.abs(stageAlt)).toBeLessThan(50);
    // The ascent stage has climbed away from it.
    expect(ascentOrbit(r.finalState, m).altitudeM).toBeGreaterThan(stageAlt + 100);
  });

  it("climbs vertically before the pitch-over cue appears", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const s = createAscentInitialState(m);
    const cue = computeAscentGuidance(s, m, targetForMission(m), 2, true);
    expect(cue.phase).toBe("vertical-rise");
    expect(cue.recommendedPitchRad).toBe(0);
  });
});

describe("M4.3 — insertion, determinism and failure modes", () => {
  it("reaches the Apollo 11 insertion target within tolerance", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const t = targetForMission(m);
    const r = runAscentProfile(m);
    expect(r.outcome).toBe("orbit-achieved");
    const o = ascentOrbit(r.finalState, m);
    expect(o.periapsisAltitudeM).toBeGreaterThanOrEqual(m.safePeriapsisAltitudeM);
    expect(Math.abs((o.apoapsisAltitudeM ?? 0) - t.apoapsisAltitudeM)).toBeLessThan(
      t.apoapsisAltitudeM * 0.15,
    );
    // The historical main burn ran about seven minutes.
    const burnS = (r.cutoffMissionTimeUs ?? 0) / 1_000_000;
    expect(burnS).toBeGreaterThan(300);
    expect(burnS).toBeLessThan(600);
    expect(r.finalState.ascentPropellantKg).toBeGreaterThan(0);
  });

  it("is bit-identical when replayed", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const a = runAscentProfile(m);
    const b = runAscentProfile(m);
    expect(JSON.stringify(a.finalState)).toBe(JSON.stringify(b.finalState));
    expect(a.cutoffMissionTimeUs).toBe(b.cutoffMissionTimeUs);
  });

  it("fails with insufficient periapsis when cutoff comes too early", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const r = runAscentProfile(m, { forcedCutoffSeconds: 240 });
    expect(r.outcome).toBe("insufficient-periapsis");
    expect(ascentOrbit(r.finalState, m).periapsisAltitudeM).toBeLessThan(
      m.safePeriapsisAltitudeM,
    );
  });

  it("impacts the surface when the vehicle never pitches over", () => {
    const m = ASCENT_MISSIONS["liftoff-fundamentals"];
    const r = runAscentProfile(m, {
      fixedPitchRad: 0,
      burnToDepletion: true,
      coastSeconds: 4_000,
      maxSeconds: 900,
    });
    expect(r.outcome).toBe("surface-impact");
  });

  it("reports propellant depletion when the burn never stops", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const r = runAscentProfile(m, { burnToDepletion: true, maxSeconds: 900 });
    expect(r.finalState.ascentPropellantKg).toBeCloseTo(0, 6);
  });
});

describe("M4.3 — firewall and purity", () => {
  it("guidance never mutates the flight state or the control input", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const s = createAscentInitialState(m);
    const before = JSON.stringify(s);
    const cue = computeAscentGuidance(s, m, targetForMission(m), 30, true);
    expect(JSON.stringify(s)).toBe(before);
    // Producing an attitude command from the cue is also pure.
    attitudeCommandFor(s, cue.recommendedPitchRad);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("the attitude command is bounded and drives toward the cue", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    const s = createAscentInitialState(m);
    expect(attitudeCommandFor(s, Math.PI / 2)).toBeGreaterThan(0);
    expect(attitudeCommandFor(s, Math.PI / 2)).toBeLessThanOrEqual(1);
    expect(attitudeCommandFor(s, -Math.PI / 2)).toBeGreaterThanOrEqual(-1);
  });

  it("no module in the ascent game layer imports AGC state", async () => {
    const files = import.meta.glob("../*.ts", { query: "?raw", import: "default", eager: true });
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).not.toMatch(/@\/agc\//);
      expect(src, name).not.toMatch(/AgcWorkerClient|useAgcSession/);
    }
  });
});

describe("M4.3 — scoring", () => {
  const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
  const base = (over: Partial<AscentSummary> = {}): AscentSummary => {
    const r = runAscentProfile(m);
    const o = ascentOrbit(r.finalState, m);
    return {
      missionId: m.id,
      assistance: "pilot",
      outcome: r.outcome,
      finalState: r.finalState,
      target: targetForMission(m),
      periapsisAltitudeM: o.periapsisAltitudeM,
      apoapsisAltitudeM: o.apoapsisAltitudeM,
      cutoffMissionTimeUs: r.cutoffMissionTimeUs,
      cutoffAltitudeM: o.altitudeM,
      cutoffRadialSpeedMps: o.radialSpeedMps,
      staged: true,
      stagingMissionTimeUs: 0,
      ascentPropellantRemainingKg: r.finalState.ascentPropellantKg,
      ascentPropellantInitialKg: m.ascentPropellantKg,
      rcsPropellantRemainingKg: r.finalState.rcsPropellantKg,
      deltaVRemainingMps: remainingAscentDeltaVMps(r.finalState),
      controlRoughness: 0.2,
      demonstrationUsed: false,
      ...over,
    };
  };

  it("is deterministic and rewards a clean insertion", () => {
    const s = base();
    const a = scoreAscent(s);
    expect(scoreAscent(s)).toEqual(a);
    expect(a.outcome).toBe("orbit-achieved");
    expect(a.total).toBeGreaterThan(a.maxTotal * 0.6);
  });

  it("gives no orbit credit and a teaching note for an unsafe periapsis", () => {
    const a = scoreAscent(
      base({ outcome: "insufficient-periapsis", periapsisAltitudeM: -4_000 }),
    );
    expect(a.components.find((c) => c.id === "orbit")!.points).toBe(0);
    expect(a.notes.join(" ")).toMatch(/high apoapsis is not an orbit/i);
  });

  it("removes assistance credit when the demonstration autopilot flew", () => {
    const withDemo = scoreAscent(base({ demonstrationUsed: true }));
    expect(withDemo.components.find((c) => c.id === "assistance")!.points).toBe(0);
    expect(withDemo.notes.join(" ")).toMatch(/demonstration autopilot/i);
  });

  it("grades an impact as F", () => {
    expect(scoreAscent(base({ outcome: "surface-impact" })).grade).toBe("F");
  });
});

describe("M4.3 — outcome evaluation", () => {
  it("is in-flight while the ascent engine is commanded", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    expect(evaluateAscentOutcome(circularState(80_000), m, true)).toBe("in-flight");
  });

  it("is orbit-achieved once the engine is off above the floor", () => {
    const m = ASCENT_MISSIONS["orbital-insertion-trainer"];
    expect(evaluateAscentOutcome(circularState(80_000), m, false)).toBe("orbit-achieved");
  });
});
