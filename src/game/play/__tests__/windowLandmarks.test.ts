// SPDX-License-Identifier: GPL-3.0-or-later
// M4.34 — commander's-window terrain model.

import { describe, expect, it } from "vitest";
import {
  DUST_ONSET_M,
  SHADOW_ONSET_M,
  buildLandmarks,
  dustDensity,
  horizonY,
  projectSurfacePoint,
  shadowEnvelope,
  seedForMission,
} from "@/game/play/windowLandmarks";

const PROJ = {
  width: 400,
  height: 320,
  altitudeM: 300,
  pitchRad: 0.6,
};

describe("landmark table", () => {
  it("is deterministic for a mission id", () => {
    expect(buildLandmarks("apollo11-powered-descent")).toEqual(
      buildLandmarks("apollo11-powered-descent"),
    );
    expect(seedForMission("a")).not.toBe(seedForMission("b"));
  });

  it("gives different missions different terrain", () => {
    const a = buildLandmarks("apollo11-powered-descent");
    const b = buildLandmarks("landing-fundamentals");
    expect(a.map((m) => m.lateralM)).not.toEqual(b.map((m) => m.lateralM));
  });

  it("always seeds West Crater just uprange of the landing zone", () => {
    const marks = buildLandmarks("apollo11-powered-descent");
    const west = marks.find((m) => m.id === "west-crater");
    expect(west).toBeDefined();
    expect(west!.trackRangeM).toBeGreaterThan(0);
    expect(west!.trackRangeM).toBeLessThan(1500);
  });

  it("is sorted far-to-near so nearer features paint last", () => {
    const marks = buildLandmarks("apollo11-powered-descent");
    for (let i = 1; i < marks.length; i += 1) {
      expect(marks[i - 1]!.trackRangeM).toBeGreaterThanOrEqual(marks[i]!.trackRangeM);
    }
  });
});

describe("projection", () => {
  it("moves a surface point down-frame as the vehicle closes on it", () => {
    const far = projectSurfacePoint(4000, 0, PROJ);
    const near = projectSurfacePoint(600, 0, PROJ);
    expect(far.visible && near.visible).toBe(true);
    expect(near.y).toBeGreaterThan(far.y);
  });

  it("magnifies features as they approach", () => {
    expect(projectSurfacePoint(500, 0, PROJ).scale).toBeGreaterThan(
      projectSurfacePoint(5000, 0, PROJ).scale,
    );
  });

  it("puts right-of-track points right of centre", () => {
    expect(projectSurfacePoint(1000, 200, PROJ).x).toBeGreaterThan(PROJ.width / 2);
    expect(projectSurfacePoint(1000, -200, PROJ).x).toBeLessThan(PROJ.width / 2);
  });

  it("refuses points behind the camera", () => {
    expect(projectSurfacePoint(-100000, 0, { ...PROJ, pitchRad: 1.5 }).visible).toBe(false);
  });

  it("raises the horizon as the vehicle pitches upright", () => {
    const pitchedBack = horizonY({ ...PROJ, pitchRad: 1.3 });
    const upright = horizonY({ ...PROJ, pitchRad: 0.3 });
    expect(pitchedBack).toBeGreaterThan(upright);
  });
});

describe("shadow and dust envelopes", () => {
  it("keeps the shadow hidden above its onset altitude", () => {
    expect(shadowEnvelope(SHADOW_ONSET_M + 1).intensity).toBe(0);
  });

  it("grows the shadow monotonically as the vehicle settles", () => {
    const a = shadowEnvelope(40).intensity;
    const b = shadowEnvelope(20).intensity;
    const c = shadowEnvelope(2).intensity;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThanOrEqual(1);
  });

  it("slides the shadow in toward the vehicle as altitude drops", () => {
    expect(shadowEnvelope(5).offsetM).toBeLessThan(shadowEnvelope(40).offsetM);
  });

  it("raises dust only under the engine near the surface", () => {
    expect(dustDensity(DUST_ONSET_M + 1, 1)).toBe(0);
    expect(dustDensity(10, 0.4)).toBeGreaterThan(0);
    expect(dustDensity(2, 0.4)).toBeGreaterThan(dustDensity(10, 0.4));
    expect(dustDensity(2, 1)).toBeLessThanOrEqual(1);
  });
});
