// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.44 — story-beat selection for the Apollo 11 air-to-ground recordings.

import { describe, expect, it } from "vitest";
import {
  MISSION_AUDIO_DUCK,
  MISSION_AUDIO_URLS,
  beatFor,
  dueBeats,
  type MissionAudioInput,
} from "../useMissionAudio";

const base: MissionAudioInput = {
  enabled: true,
  engineOn: false,
  activeAlarmId: null,
  calloutId: null,
  contact: false,
  altitudeM: 15_000,
};

describe("mission audio story beats", () => {
  it("opens the loop with Houston's two pre-PDI calls", () => {
    expect(dueBeats(base)).toEqual(["game-open", "go-for-pdi"]);
  });

  it("fires ignition a few seconds after the DPS lights", () => {
    expect(dueBeats({ ...base, engineOn: true, sinceIgnitionSec: 2 })).not.toContain("ignition");
    expect(dueBeats({ ...base, engineOn: true, sinceIgnitionSec: 8 })).toContain("ignition");
  });

  it("fires the AC-voltage call at T+161 s in the braking burn", () => {
    expect(dueBeats({ ...base, engineOn: true, sinceIgnitionSec: 75 })).not.toContain(
      "ac-voltage",
    );
    expect(dueBeats({ ...base, engineOn: true, sinceIgnitionSec: 165 })).toContain("ac-voltage");
  });

  it("fires the 1202 clip on the first executive alarm", () => {
    expect(dueBeats({ ...base, activeAlarmId: "alarm-1202-first" })).toContain("alarm-1202");
  });

  it("fires the radar-lock and Earth-in-the-window calls after the roll", () => {
    const due = dueBeats({ ...base, rollComplete: true });
    expect(due).toContain("radar-lock");
    expect(due.indexOf("earth-window")).toBeGreaterThan(due.indexOf("radar-lock"));
  });

  it("fires the P64 call at 5 000 ft and the go-for-landing call at 3 500 ft", () => {
    expect(dueBeats({ ...base, altitudeM: 1_500 })).toContain("p64-5000");
    expect(dueBeats({ ...base, altitudeM: 1_500 })).not.toContain("go-for-landing-1201");
    expect(dueBeats({ ...base, altitudeM: 1_000 })).toContain("go-for-landing-1201");
  });

  it("fires the sixty-second call on one minute of burn time, not altitude", () => {
    expect(dueBeats({ ...base, altitudeM: 20 })).not.toContain("sixty-seconds");
    expect(dueBeats({ ...base, burnTimeRemainingSec: 55 })).toContain("sixty-seconds");
  });

  it("fires the final-descent calls at 100 ft and 40 ft, altitude only", () => {
    expect(dueBeats({ ...base, altitudeM: 30 })).toContain("final-100");
    expect(dueBeats({ ...base, altitudeM: 30 })).not.toContain("dust-30");
    expect(dueBeats({ ...base, altitudeM: 12 })).toContain("dust-30");
    expect(dueBeats({ ...base, sinceIgnitionSec: 900, altitudeM: 15_000 })).not.toContain(
      "final-100",
    );
  });

  it("contact outranks every other beat", () => {
    expect(
      beatFor({
        ...base,
        engineOn: true,
        contact: true,
        altitudeM: 1,
        activeAlarmId: "alarm-1201-first",
        burnTimeRemainingSec: 30,
      }),
    ).toBe("contact");
  });

  it("says nothing once the vehicle is wrecked", () => {
    expect(dueBeats({ ...base, contact: true, crashed: true })).toEqual([]);
  });

  it("has a distinct recording for every beat", () => {
    const urls = Object.values(MISSION_AUDIO_URLS);
    expect(urls).toHaveLength(17);
    expect(new Set(urls).size).toBe(17);
    for (const url of urls) expect(url).toMatch(/\.mp3$/);
  });

  it("ducks other audio down but never to silence", () => {
    expect(MISSION_AUDIO_DUCK).toBeGreaterThan(0);
    expect(MISSION_AUDIO_DUCK).toBeLessThan(1);
  });
});

describe("training missions", () => {
  it("stays off the loop until touchdown, then calls the landing", () => {
    const training = { ...base, touchdownOnly: true, engineOn: true, rollComplete: true };
    expect(dueBeats(training)).toEqual([]);
    expect(dueBeats({ ...training, contact: true, altitudeM: 1 })).toEqual(["eagle-landed"]);
    expect(dueBeats({ ...training, contact: true, crashed: true })).toEqual([]);
  });
});
