// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.44 — Apollo 11 air-to-ground recordings, cued by story beat.
//
// Restored clips from the landing tape play when the flight reaches the moment
// they belong to, not on a wall clock. The comm loop is a single channel: when
// two beats come due at once the later one waits in a queue rather than being
// talked over or dropped, which is how the loop actually sounded. Each clip
// fires once per flight.

import { useCallback, useEffect, useRef, useState } from "react";
import openClip from "@/assets/a11-open-looking-good.mp3.asset.json";
import goForPdiClip from "@/assets/a11-go-for-pdi.mp3.asset.json";
import ignitionClip from "@/assets/a11-ignition-throttle-up.mp3.asset.json";
import acVoltageClip from "@/assets/a11-ac-voltage.mp3.asset.json";
import alarm1202Clip from "@/assets/a11-1202-alarm.mp3.asset.json";
import radarLockClip from "@/assets/a11-radar-lock.mp3.asset.json";
import earthWindowClip from "@/assets/a11-earth-window.mp3.asset.json";
import p64Clip from "@/assets/a11-p64-5000.mp3.asset.json";
import goForLandingClip from "@/assets/a11-1201-were-go.mp3.asset.json";
import sixtySecondsClip from "@/assets/a11-sixty-seconds.mp3.asset.json";
import final100Clip from "@/assets/a11-final-100ft.mp3.asset.json";
import dustClip from "@/assets/a11-dust-30ft.mp3.asset.json";
import contactClip from "@/assets/a11-touchdown-contact.mp3.asset.json";
import eagleLandedClip from "@/assets/eagle-has-landed.mp3.asset.json";

export type MissionAudioBeat =
  | "game-open"
  | "go-for-pdi"
  | "ignition"
  | "ac-voltage"
  | "alarm-1202"
  | "radar-lock"
  | "earth-window"
  | "p64-5000"
  | "go-for-landing-1201"
  | "sixty-seconds"
  | "final-100"
  | "dust-30"
  | "contact"
  | "eagle-landed";

export const MISSION_AUDIO_URLS: Record<MissionAudioBeat, string> = {
  "game-open": openClip.url,
  "go-for-pdi": goForPdiClip.url,
  ignition: ignitionClip.url,
  "ac-voltage": acVoltageClip.url,
  "alarm-1202": alarm1202Clip.url,
  "radar-lock": radarLockClip.url,
  "earth-window": earthWindowClip.url,
  "p64-5000": p64Clip.url,
  "go-for-landing-1201": goForLandingClip.url,
  "sixty-seconds": sixtySecondsClip.url,
  "final-100": final100Clip.url,
  "dust-30": dustClip.url,
  contact: contactClip.url,
  "eagle-landed": eagleLandedClip.url,
};

export interface MissionAudioInput {
  /** Mirrors the descent score's on/off toggle. */
  readonly enabled: boolean;
  /** DPS is lit — ignition and the throttle-up call. */
  readonly engineOn: boolean;
  /** Seconds since TIG (0 while the DPS is cold). */
  readonly sinceIgnitionSec?: number;
  /** Id of the currently lit program alarm, or null. */
  readonly activeAlarmId: string | null;
  /** Id of the crew callout the cockpit is showing, or null. */
  readonly calloutId: string | null;
  /** The windows-up roll has been flown. */
  readonly rollComplete?: boolean;
  /** Radar altitude, metres. */
  readonly altitudeM?: number;
  /** Footpad probes have touched the surface. */
  readonly contact: boolean;
  /** The vehicle hit the surface too hard — no touchdown call is earned. */
  readonly crashed?: boolean;
  /**
   * M4.50 — training missions (Landing Fundamentals, Free Flight) fly without
   * the air-to-ground loop: no Houston chatter at all, just the touchdown call
   * once the footpads are down. Only Full Descent carries the whole tape.
   */
  readonly touchdownOnly?: boolean;
}

/** Silence between the previous clip ending and this one keying up. */
const GAP_MS: Partial<Record<MissionAudioBeat, number>> = {
  "go-for-pdi": 2_500, // ~10 s after the opening call keys up
  "earth-window": 3_000,
};

/** Ordered beat table; each predicate is a one-way gate on the flight state. */
const BEATS: ReadonlyArray<{
  readonly id: MissionAudioBeat;
  readonly due: (i: MissionAudioInput) => boolean;
}> = [
  { id: "game-open", due: () => true },
  { id: "go-for-pdi", due: () => true },
  // T+6 s — the engine is lit and settled at 10 %.
  { id: "ignition", due: (i) => i.engineOn && (i.sinceIgnitionSec ?? 0) >= 6 },
  // T+161 s — the AC bus voltage exchange, mid braking phase.
  { id: "ac-voltage", due: (i) => i.engineOn && (i.sinceIgnitionSec ?? 0) >= 161 },
  { id: "alarm-1202", due: (i) => i.activeAlarmId === "alarm-1202-first" },
  // T+299 s — radar lock, keyed off the completed windows-up roll.
  { id: "radar-lock", due: (i) => i.rollComplete === true },
  // T+315 s — Earth in the window, once the vehicle is face-up.
  { id: "earth-window", due: (i) => i.rollComplete === true },
  // T+526 s / 5,000 ft — P64 pitch-over and the manual attitude check.
  {
    id: "p64-5000",
    due: (i) => (i.altitudeM ?? Infinity) <= 1_524 || (i.sinceIgnitionSec ?? 0) >= 526,
  },
  // T+543 s / 3,500 ft — "you're go for landing", running into the first 1201.
  {
    id: "go-for-landing-1201",
    due: (i) =>
      (i.altitudeM ?? Infinity) <= 1_067 ||
      (i.sinceIgnitionSec ?? 0) >= 543 ||
      i.activeAlarmId === "alarm-1201-first",
  },
  // T+700 s / 100 ft.
  {
    id: "final-100",
    due: (i) => (i.altitudeM ?? Infinity) <= 33 || (i.sinceIgnitionSec ?? 0) >= 700,
  },
  // T+717 s — the sixty-second propellant call (~70 ft).
  {
    id: "sixty-seconds",
    due: (i) =>
      i.calloutId === "quantity-light" ||
      (i.altitudeM ?? Infinity) <= 21 ||
      (i.sinceIgnitionSec ?? 0) >= 717,
  },
  // T+732 s / 40 ft — dust, running into the thirty-second call.
  {
    id: "dust-30",
    due: (i) => (i.altitudeM ?? Infinity) <= 13 || (i.sinceIgnitionSec ?? 0) >= 732,
  },
  { id: "contact", due: (i) => i.contact },
];

/** Every beat this state satisfies, in loop order. */
export function dueBeats(input: MissionAudioInput): MissionAudioBeat[] {
  if (input.crashed === true) return [];
  // M4.53 — training missions get the "Eagle has landed" call, nothing else.
  if (input.touchdownOnly === true) return input.contact ? ["eagle-landed"] : [];
  return BEATS.filter((b) => b.due(input)).map((b) => b.id);
}

/** Highest-priority beat for this state, or null. Kept for tests. */
export function beatFor(input: MissionAudioInput): MissionAudioBeat | null {
  const due = dueBeats(input);
  return due.length > 0 ? due[due.length - 1]! : null;
}

export interface MissionAudioApi {
  /** A recording is on the comm loop right now. */
  readonly speaking: boolean;
  /** Multiplier other cockpit audio should apply while a clip plays. */
  readonly duck: number;
  /** Beats that have already keyed up this flight. */
  readonly played: ReadonlySet<MissionAudioBeat>;
}

/** Everything else drops to this fraction while the crew loop is talking. */
export const MISSION_AUDIO_DUCK = 0.25;

export function useMissionAudio(input: MissionAudioInput): MissionAudioApi {
  const claimedRef = useRef<Set<MissionAudioBeat>>(new Set());
  const queueRef = useRef<MissionAudioBeat[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef<Set<MissionAudioBeat>>(new Set());
  const [speaking, setSpeaking] = useState(false);
  const [played, setPlayed] = useState<Set<MissionAudioBeat>>(new Set());

  const drain = useCallback(() => {
    if (typeof window === "undefined") return;
    if (timerRef.current !== null) return;
    const playing = currentRef.current;
    if (playing && !playing.paused && !playing.ended) return;
    let beat = queueRef.current.shift();
    // M4.49 — a beat can only ever key up once per flight. Without this guard
    // a re-entrant drain (or a re-queued beat) could play the same recording
    // twice, which is how the Earth-in-the-window call was heard doubled.
    while (beat !== undefined && startedRef.current.has(beat)) {
      beat = queueRef.current.shift();
    }
    if (beat === undefined) return;
    const chosen = beat;

    const start = () => {
      timerRef.current = null;
      if (startedRef.current.has(chosen)) return;
      startedRef.current.add(chosen);
      const el = new Audio(MISSION_AUDIO_URLS[chosen]);
      el.volume = 1;
      currentRef.current = el;
      setPlayed((prev) => new Set(prev).add(chosen));
      const done = () => {
        if (currentRef.current !== el) return;
        setSpeaking(false);
        currentRef.current = null;
        drain();
      };
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
      setSpeaking(true);
      void el.play().catch(done);
    };

    const gap = GAP_MS[chosen] ?? 350;
    timerRef.current = window.setTimeout(start, gap);
  }, []);

  useEffect(
    () => () => {
      currentRef.current?.pause();
      currentRef.current = null;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  const {
    enabled,
    engineOn,
    sinceIgnitionSec,
    activeAlarmId,
    calloutId,
    rollComplete,
    altitudeM,
    contact,
    crashed,
    touchdownOnly,
  } = input;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const due = dueBeats({
      enabled,
      engineOn,
      sinceIgnitionSec,
      activeAlarmId,
      calloutId,
      rollComplete,
      altitudeM,
      contact,
      crashed,
      touchdownOnly,
    });
    let queued = false;
    for (const beat of due) {
      if (claimedRef.current.has(beat)) continue;
      claimedRef.current.add(beat);
      // Touchdown outranks anything still waiting to be said.
      if (beat === "contact" || beat === "eagle-landed") queueRef.current.length = 0;
      queueRef.current.push(beat);
      queued = true;
    }
    if (queued) drain();
  }, [
    enabled,
    engineOn,
    sinceIgnitionSec,
    activeAlarmId,
    calloutId,
    rollComplete,
    altitudeM,
    contact,
    crashed,
    touchdownOnly,
    drain,
  ]);

  // Muting the cockpit audio — or crashing — silences the comm loop.
  useEffect(() => {
    if (enabled && crashed !== true) return;
    currentRef.current?.pause();
    currentRef.current = null;
    queueRef.current.length = 0;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setSpeaking(false);
  }, [enabled, crashed]);

  return { speaking, duck: speaking ? MISSION_AUDIO_DUCK : 1, played };
}
