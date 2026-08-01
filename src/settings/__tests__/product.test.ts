// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — Product-layer acceptance: settings, units, onboarding and the
// bounded trajectory history. Every module under test is pure and total:
// corrupt or hostile input must degrade to defaults, never throw.

import { describe, expect, it } from "vitest";
import {
  SETTINGS_SCHEMA,
  SETTINGS_VERSION,
  coerceSettings,
  defaultSettings,
  migrateSettings,
  parseSettings,
  reduceSettings,
  serializeSettings,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
} from "@/settings/settings";
import {
  KG_PER_LB,
  M_PER_FT,
  M_PER_NMI,
  distanceUnitLabel,
  formatDistance,
  formatMass,
  formatSpeed,
  massUnitLabel,
  speedUnitLabel,
} from "@/settings/units";
import {
  ONBOARDING_STEPS,
  emptyOnboarding,
  onboardingDestination,
  parseOnboarding,
  reduceOnboarding,
  serializeOnboarding,
} from "@/onboarding/onboarding";
import {
  MAX_TRAJECTORY_SAMPLES,
  MIN_TRAJECTORY_SPACING_US,
  emptyTrajectory,
  pushTrajectorySample,
} from "@/ui/shell/trajectoryHistory";

describe("M4.4 settings", () => {
  it("defaults are metric, instructor, sound on", () => {
    const d = defaultSettings();
    expect(d.units).toBe("metric");
    expect(d.defaultAssistance).toBe("instructor");
    expect(d.soundEffects).toBe(true);
    expect(d.schema).toBe(SETTINGS_SCHEMA);
    expect(d.version).toBe(SETTINGS_VERSION);
  });

  it("clamps out-of-range numbers instead of trusting them", () => {
    const s = coerceSettings({ masterVolume: 42, controlSensitivity: -9 });
    expect(s.masterVolume).toBe(1);
    expect(s.controlSensitivity).toBe(SENSITIVITY_MIN);
    const t = coerceSettings({ controlSensitivity: 999 });
    expect(t.controlSensitivity).toBe(SENSITIVITY_MAX);
  });

  it("rejects unknown enum members and falls back", () => {
    const s = coerceSettings({ units: "furlongs", keyboardMap: "dvorak", touchControlSize: "xl" });
    expect(s.units).toBe("metric");
    expect(s.keyboardMap).toBe("arrows");
    expect(s.touchControlSize).toBe("medium");
  });

  it("survives hostile input types without throwing", () => {
    for (const bad of [null, undefined, 7, "text", [], { units: {} }]) {
      expect(() => coerceSettings(bad)).not.toThrow();
    }
    expect(coerceSettings([]).units).toBe("metric");
  });

  it("reducer returns the same reference for a no-op patch", () => {
    const s = defaultSettings();
    expect(reduceSettings(s, { kind: "set", patch: { units: "metric" } })).toBe(s);
    expect(reduceSettings(s, { kind: "set", patch: { units: "apollo" } })).not.toBe(s);
  });

  it("reset restores the shipped defaults", () => {
    const s = reduceSettings(defaultSettings(), {
      kind: "set",
      patch: { units: "apollo", highContrast: true },
    });
    expect(reduceSettings(s, { kind: "reset" })).toEqual(defaultSettings());
  });

  it("serialization is deterministic and round-trips", () => {
    const s = reduceSettings(defaultSettings(), {
      kind: "set",
      patch: { units: "apollo", masterVolume: 0.25, defaultAssistance: "commander" },
    });
    const a = serializeSettings(s);
    expect(a).toBe(serializeSettings(s));
    const parsed = parseSettings(a);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.settings).toEqual(s);
  });

  it("migrates a v1 payload and refuses a future one", () => {
    const v1 = migrateSettings({
      schema: SETTINGS_SCHEMA,
      version: 1,
      units: "apollo",
      masterVolume: 0.4,
    });
    expect(v1.ok).toBe(true);
    if (v1.ok) {
      expect(v1.migrated).toBe(true);
      expect(v1.settings.units).toBe("apollo");
      expect(v1.settings.keyboardMap).toBe("arrows");
    }
    const future = migrateSettings({ schema: SETTINGS_SCHEMA, version: SETTINGS_VERSION + 1 });
    expect(future.ok).toBe(false);
  });

  it("refuses foreign schemas and malformed text", () => {
    expect(parseSettings("{").ok).toBe(false);
    expect(parseSettings("[]").ok).toBe(false);
    expect(parseSettings(JSON.stringify({ schema: "someone-else", version: 1 })).ok).toBe(false);
  });
});

describe("M4.4 unit presentation", () => {
  it("metric is unchanged SI", () => {
    expect(formatSpeed(12.34, "metric")).toBe("12.3 m/s");
    expect(formatDistance(950, "metric")).toBe("950 m");
    expect(formatDistance(15_000, "metric")).toBe("15.0 km");
    expect(formatMass(7000, "metric")).toBe("7000 kg");
  });

  it("apollo units convert with the documented constants", () => {
    expect(formatSpeed(1, "apollo")).toBe(`${(1 / M_PER_FT).toFixed(1)} fps`);
    expect(formatDistance(100, "apollo")).toBe(`${Math.round(100 / M_PER_FT)} ft`);
    expect(formatDistance(100_000, "apollo")).toBe(`${(100_000 / M_PER_NMI).toFixed(1)} nmi`);
    expect(formatMass(1000, "apollo")).toBe(`${Math.round(1000 / KG_PER_LB)} lb`);
  });

  it("labels match the selected system", () => {
    expect(speedUnitLabel("metric")).toBe("m/s");
    expect(speedUnitLabel("apollo")).toBe("fps");
    expect(distanceUnitLabel("apollo")).toBe("ft");
    expect(massUnitLabel("apollo")).toBe("lb");
  });

  it("non-finite values render as an em dash, never NaN", () => {
    expect(formatSpeed(Number.NaN, "metric")).toBe("—");
    expect(formatDistance(Number.POSITIVE_INFINITY, "apollo")).toBe("—");
    expect(formatMass(Number.NaN, "apollo")).toBe("—");
  });
});

describe("M4.4 onboarding", () => {
  it("walks intent → assistance → controls → launch", () => {
    let s = emptyOnboarding();
    expect(s.step).toBe("intent");
    s = reduceOnboarding(s, { kind: "chooseIntent", intent: "learn" });
    expect(s.step).toBe("assistance");
    s = reduceOnboarding(s, { kind: "chooseAssistance", assistance: "pilot" });
    expect(s.step).toBe("controls");
    s = reduceOnboarding(s, { kind: "next" });
    expect(s.step).toBe("launch");
    s = reduceOnboarding(s, { kind: "complete" });
    expect(s.completed).toBe(true);
  });

  it("cannot step outside the declared sequence", () => {
    let s = emptyOnboarding();
    for (let i = 0; i < 20; i += 1) s = reduceOnboarding(s, { kind: "next" });
    expect(s.step).toBe(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]);
    for (let i = 0; i < 20; i += 1) s = reduceOnboarding(s, { kind: "back" });
    expect(s.step).toBe(ONBOARDING_STEPS[0]);
  });

  it("sends learners to /learn and pilots to /play", () => {
    const learn = reduceOnboarding(emptyOnboarding(), { kind: "chooseIntent", intent: "learn" });
    expect(onboardingDestination(learn).to).toBe("/learn");
    const fly = reduceOnboarding(emptyOnboarding(), { kind: "chooseIntent", intent: "fly" });
    expect(onboardingDestination(fly).to).toBe("/play");
  });

  it("round-trips and rejects corrupt state", () => {
    const s = reduceOnboarding(emptyOnboarding(), { kind: "complete" });
    const parsed = parseOnboarding(serializeOnboarding(s));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(s);
    expect(parseOnboarding("nope").ok).toBe(false);
    expect(parseOnboarding(JSON.stringify({ schema: "other", version: 1 })).ok).toBe(false);
  });

  it("restart clears completion but keeps the player's choices", () => {
    const done = reduceOnboarding(
      reduceOnboarding(emptyOnboarding(), { kind: "chooseAssistance", assistance: "commander" }),
      { kind: "complete" },
    );
    const again = reduceOnboarding(done, { kind: "restart" });
    expect(again.completed).toBe(false);
    expect(again.assistance).toBe("commander");
    expect(again.step).toBe("intent");
  });
});

describe("M4.4 trajectory history (performance limit)", () => {
  const sample = (tUs: number) => ({ tUs, x: tUs / 1000, y: -tUs / 2000 });

  it("thins samples closer together than the spacing rule", () => {
    let h = emptyTrajectory();
    h = pushTrajectorySample(h, sample(0));
    const before = h;
    h = pushTrajectorySample(h, sample(MIN_TRAJECTORY_SPACING_US - 1));
    expect(h).toBe(before);
    h = pushTrajectorySample(h, sample(MIN_TRAJECTORY_SPACING_US));
    expect(h.length).toBe(2);
  });

  it("never exceeds the cap over a long flight", () => {
    let h = emptyTrajectory();
    for (let i = 0; i < 20_000; i += 1) {
      h = pushTrajectorySample(h, sample(i * MIN_TRAJECTORY_SPACING_US));
    }
    expect(h.length).toBeLessThanOrEqual(MAX_TRAJECTORY_SAMPLES);
    // Decimation keeps the full span, not just a recent tail.
    expect(h[0]!.tUs).toBe(0);
  });

  it("ignores non-finite points and time running backwards", () => {
    let h = pushTrajectorySample(emptyTrajectory(), sample(0));
    h = pushTrajectorySample(h, { tUs: 1_000_000, x: Number.NaN, y: 0 });
    expect(h.length).toBe(1);
    h = pushTrajectorySample(h, sample(5_000_000));
    const after = h;
    h = pushTrajectorySample(h, sample(1_000_000));
    expect(h).toBe(after);
  });
});
