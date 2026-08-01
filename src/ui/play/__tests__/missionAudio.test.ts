// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.32 — story-beat selection for the Apollo 11 air-to-ground recordings.

import { describe, expect, it } from "vitest";
import {
  MISSION_AUDIO_DUCK,
  MISSION_AUDIO_URLS,
  beatFor,
  type MissionAudioInput,
} from "../useMissionAudio";

const base: MissionAudioInput = {
  enabled: true,
  engineOn: false,
  activeAlarmId: null,
  calloutId: null,
  contact: false,
};

describe("mission audio story beats", () => {
  it("stays silent before anything happens", () => {
    expect(beatFor(base)).toBeNull();
  });

  it("fires ignition when the DPS lights", () => {
    expect(beatFor({ ...base, engineOn: true })).toBe("ignition");
  });

  it("fires the 1202 clip on the first executive alarm", () => {
    expect(beatFor({ ...base, engineOn: true, activeAlarmId: "alarm-1202-first" })).toBe(
      "alarm-1202",
    );
  });

  it("fires go-for-landing on the first 1201", () => {
    expect(beatFor({ ...base, engineOn: true, activeAlarmId: "alarm-1201-first" })).toBe(
      "go-for-landing-1201",
    );
  });

  it("fires the sixty-second call on the quantity light", () => {
    expect(beatFor({ ...base, engineOn: true, calloutId: "quantity-light" })).toBe(
      "sixty-seconds",
    );
  });

  it("contact outranks every other beat", () => {
    expect(
      beatFor({
        ...base,
        engineOn: true,
        contact: true,
        activeAlarmId: "alarm-1201-first",
        calloutId: "quantity-light",
      }),
    ).toBe("contact");
  });

  it("has a distinct recording for every beat", () => {
    const urls = Object.values(MISSION_AUDIO_URLS);
    expect(urls).toHaveLength(5);
    expect(new Set(urls).size).toBe(5);
    for (const url of urls) expect(url).toMatch(/\.mp3$/);
  });

  it("ducks other audio down but never to silence", () => {
    expect(MISSION_AUDIO_DUCK).toBeGreaterThan(0);
    expect(MISSION_AUDIO_DUCK).toBeLessThan(1);
  });
});
