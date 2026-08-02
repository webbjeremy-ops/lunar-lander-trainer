// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.31 — Apollo 11 air-to-ground recordings, cued by story beat.
//
// Five restored clips from the landing tape play when the flight reaches the
// moment they belong to, not on a wall clock: ignition/throttle-up, the first
// 1202, "go for landing" with the first 1201, the sixty-second fuel call and
// contact light / engine shutdown. Each clip fires once per flight, and a clip
// already playing is never talked over — the later beat is dropped rather than
// doubled, exactly as the loop would have sounded on the comm channel.

import { useEffect, useRef, useState } from "react";
import ignitionClip from "@/assets/a11-ignition-throttle-up.mp3.asset.json";
import alarm1202Clip from "@/assets/a11-1202-alarm.mp3.asset.json";
import goForLandingClip from "@/assets/a11-go-for-landing-1201.mp3.asset.json";
import sixtySecondsClip from "@/assets/a11-sixty-seconds.mp3.asset.json";
import contactClip from "@/assets/a11-contact-shutdown.mp3.asset.json";

export type MissionAudioBeat =
  | "ignition"
  | "alarm-1202"
  | "go-for-landing-1201"
  | "sixty-seconds"
  | "contact";

export const MISSION_AUDIO_URLS: Record<MissionAudioBeat, string> = {
  ignition: ignitionClip.url,
  "alarm-1202": alarm1202Clip.url,
  "go-for-landing-1201": goForLandingClip.url,
  "sixty-seconds": sixtySecondsClip.url,
  contact: contactClip.url,
};

export interface MissionAudioInput {
  /** Mirrors the descent score's on/off toggle. */
  readonly enabled: boolean;
  /** DPS is lit — ignition and the throttle-up call. */
  readonly engineOn: boolean;
  /** Id of the currently lit program alarm, or null. */
  readonly activeAlarmId: string | null;
  /** Id of the crew callout the cockpit is showing, or null. */
  readonly calloutId: string | null;
  /** Footpad probes have touched the surface. */
  readonly contact: boolean;
  /** The vehicle hit the surface too hard — no touchdown call is earned. */
  readonly crashed?: boolean;
}

/**
 * Pure beat selection: which recording (if any) this state edge should fire.
 * Exported for tests; the hook below owns the playback side effects.
 */
export function beatFor(input: MissionAudioInput): MissionAudioBeat | null {
  if (input.crashed === true) return null;
  if (input.contact) return "contact";
  if (input.activeAlarmId === "alarm-1201-first") return "go-for-landing-1201";
  if (input.activeAlarmId === "alarm-1202-first") return "alarm-1202";
  if (input.calloutId === "quantity-light") return "sixty-seconds";
  if (input.engineOn) return "ignition";
  return null;
}

export interface MissionAudioApi {
  /** A recording is on the comm loop right now. */
  readonly speaking: boolean;
  /** Multiplier other cockpit audio should apply while a clip plays. */
  readonly duck: number;
}

/** Everything else drops to this fraction while the crew loop is talking. */
export const MISSION_AUDIO_DUCK = 0.25;

export function useMissionAudio(input: MissionAudioInput): MissionAudioApi {
  const playedRef = useRef<Set<MissionAudioBeat>>(new Set());
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      currentRef.current?.pause();
      currentRef.current = null;
    },
    [],
  );

  const { enabled, engineOn, activeAlarmId, calloutId, contact } = input;
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const beat = beatFor({ enabled, engineOn, activeAlarmId, calloutId, contact });
    if (beat === null || playedRef.current.has(beat)) return;

    const playing = currentRef.current;
    // The comm loop is one channel: never talk over a clip still running.
    if (playing && !playing.paused && !playing.ended) return;

    playedRef.current.add(beat);
    const el = new Audio(MISSION_AUDIO_URLS[beat]);
    el.volume = 1;
    currentRef.current = el;
    const done = () => {
      if (currentRef.current === el) setSpeaking(false);
    };
    el.addEventListener("ended", done);
    el.addEventListener("pause", done);
    el.addEventListener("error", done);
    setSpeaking(true);
    void el.play().catch(() => {
      done();
    });
  }, [enabled, engineOn, activeAlarmId, calloutId, contact]);

  // Muting the cockpit audio also silences the comm loop.
  useEffect(() => {
    if (enabled) return;
    currentRef.current?.pause();
    currentRef.current = null;
    setSpeaking(false);
  }, [enabled]);

  return { speaking, duck: speaking ? MISSION_AUDIO_DUCK : 1 };
}
