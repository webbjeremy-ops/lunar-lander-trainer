// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  APOLLO11_ALARM_TEACHING,
  APOLLO11_DESCENT_PHASE_ANCHORS,
  APOLLO11_DESCENT_TIMELINE,
  APOLLO11_TEACHING_PROGRESSION,
  APOLLO11_WORKBOOK_SOURCE_ID,
  anchorById,
  buildContactComparison,
  getToSeconds,
} from "@/content/apollo11PoweredDescentReference";
import { SOURCE_REGISTRY } from "@/lessons/SourceRegistry";
import { ALL_LESSONS } from "@/lessons/content";

describe("Apollo 11 powered-descent curated reference", () => {
  it("registers the workbook as a secondary reconstruction", () => {
    const entry = SOURCE_REGISTRY[APOLLO11_WORKBOOK_SOURCE_ID];
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("secondary-reconstruction");
  });

  it("carries provenance on every imported item", () => {
    const items = [
      ...APOLLO11_DESCENT_PHASE_ANCHORS,
      ...APOLLO11_DESCENT_TIMELINE,
      ...APOLLO11_ALARM_TEACHING,
    ];
    for (const item of items) {
      expect(item.provenance.workbookSheet.length).toBeGreaterThan(0);
      expect(Number.isInteger(item.provenance.workbookRow)).toBe(true);
      expect(item.provenance.workbookRow).toBeGreaterThan(0);
      expect([
        "source-derived-reconstruction",
        "secondary-explanation",
        "author-inference",
      ]).toContain(item.provenance.classification);
    }
  });

  it("pins the five phase anchors to the documented values", () => {
    expect(anchorById("pdi-p63")).toMatchObject({
      get: "102:33:05",
      altitudeFt: 49_971,
      totalVelocityFtPerSec: 5_559.7,
      tFromPdiSec: 0,
    });
    expect(anchorById("throttle-down")).toMatchObject({
      get: "102:39:31",
      altitudeFt: 22_984,
    });
    expect(anchorById("p64")).toMatchObject({
      get: "102:41:31",
      altitudeFt: 7_129,
      descentRateFtPerSec: 124.9,
    });
    expect(anchorById("p66")).toMatchObject({
      get: "102:43:22",
      altitudeFt: 410,
      horizontalVelocityFtPerSec: 60.3,
      descentRateFtPerSec: 10,
    });
    expect(anchorById("contact")).toMatchObject({
      get: "102:45:40",
      altitudeFt: 10,
      horizontalVelocityFtPerSec: 2.7,
      descentRateFtPerSec: 0.2,
    });
  });

  it("keeps anchors and timeline monotonic in GET", () => {
    const secs = APOLLO11_DESCENT_PHASE_ANCHORS.map((a) => getToSeconds(a.get));
    expect([...secs].sort((a, b) => a - b)).toEqual(secs);
    const evs = APOLLO11_DESCENT_TIMELINE.map((e) => getToSeconds(e.get));
    expect([...evs].sort((a, b) => a - b)).toEqual(evs);
  });

  it("classifies every timeline event", () => {
    for (const e of APOLLO11_DESCENT_TIMELINE) {
      expect(["transcript-derived", "telemetry-derived", "explanatory"]).toContain(e.kind);
    }
    const ids = APOLLO11_DESCENT_TIMELINE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the required curated events", () => {
    const ids = new Set(APOLLO11_DESCENT_TIMELINE.map((e) => e.id));
    for (const required of [
      "p63-ignition",
      "throttle-up",
      "face-up-yaw",
      "lr-data-good",
      "v16-n68-deltah",
      "alarm-1202-first",
      "v57-lr-accept",
      "throttle-down",
      "p64-transition",
      "landing-site-assessment",
      "att-hold",
      "p66-takeover",
      "lr-dropout",
      "fuel-low-level",
      "contact-light",
      "engine-stop",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("teaches the full historical progression", () => {
    expect(APOLLO11_TEACHING_PROGRESSION.map((p) => p.id)).toEqual([
      "p63-prep",
      "ignition-auth",
      "post-ignition-display",
      "delta-h",
      "lr-accept",
      "alarm-recognition",
      "p64-auto",
      "site-assessment",
      "att-hold-rod",
      "p66-control",
    ]);
  });

  it("never imports a Verb/Noun dictionary or rope cadence claims", () => {
    const blob = JSON.stringify([
      APOLLO11_DESCENT_PHASE_ANCHORS,
      APOLLO11_DESCENT_TIMELINE,
      APOLLO11_ALARM_TEACHING,
      APOLLO11_TEACHING_PROGRESSION,
    ]);
    for (const forbidden of [
      "N60",
      "N61",
      "N63",
      "N64",
      "READACCS",
      "SERVICER",
      "every two seconds",
    ]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("builds a debrief comparison against the contact anchor", () => {
    const rows = buildContactComparison({
      descentRateMps: -1.2,
      horizontalSpeedMps: 0.4,
      altitudeM: 120,
    });
    expect(rows.map((r) => r.id)).toEqual(["descent-rate", "lateral", "p66-alt"]);
    expect(rows[0]!.historical).toContain("0.2 ft/s");
    expect(rows[0]!.player).toBe("1.20 m/s");
  });

  it("adds the M4.2 lesson without disturbing existing lessons", () => {
    // The M4.2 campaign added further lessons; the first seven M2/M4.2-workbook
    // lessons must remain in place and in order.
    expect(ALL_LESSONS.length).toBeGreaterThanOrEqual(7);
    const l = ALL_LESSONS.find((x) => x.id === "lesson-07-powered-descent-timeline")!;
    expect(l).toBeDefined();

    expect(l.steps.every((s) => s.kind === "reading")).toBe(true);
    expect(JSON.stringify(l)).toContain("HISTORICALLY GROUNDED PROCEDURE BRIDGE");
  });
});
