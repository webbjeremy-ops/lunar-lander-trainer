// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Cabin tape player.
//
// The crew's own music, carried aboard on tape. While a track is playing it
// replaces the procedural descent score entirely; the cockpit sound effects
// and the air-to-ground loop stay up, just a little quieter. Taking manual
// control stows the player and hands the cabin back to the game score.

import { useCallback, useEffect, useRef, useState } from "react";

import motherCountry from "@/assets/mother-country.mp3.asset.json";
import galveston from "@/assets/galveston.mp3.asset.json";
import people from "@/assets/people.mp3.asset.json";
import angelOfTheMorning from "@/assets/angel-of-the-morning.mp3.asset.json";
import everydayPeople from "@/assets/everyday-people.mp3.asset.json";
import spinningWheel from "@/assets/spinning-wheel.mp3.asset.json";
import everyoneGone from "@/assets/everyone-gone-to-the-moon.mp3.asset.json";
import flyMeToTheMoon from "@/assets/fly-me-to-the-moon.mp3.asset.json";
import moonMoods from "@/assets/moon-moods.mp3.asset.json";
import newWorld from "@/assets/dvorak-new-world-mvmt4.mp3.asset.json";

export interface CabinTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly url: string;
}

export const CABIN_TRACKS: readonly CabinTrack[] = [
  { id: "mother-country", title: "Mother Country", artist: "John Stewart", url: motherCountry.url },
  { id: "galveston", title: "Galveston", artist: "Glen Campbell", url: galveston.url },
  { id: "people", title: "People", artist: "Barbra Streisand", url: people.url },
  {
    id: "angel-of-the-morning",
    title: "Angel of the Morning",
    artist: "Bettye Swann",
    url: angelOfTheMorning.url,
  },
  { id: "everyday-people", title: "Everyday People", artist: "Peggy Lee", url: everydayPeople.url },
  {
    id: "spinning-wheel",
    title: "Spinning Wheel",
    artist: "Peggy Lee",
    url: spinningWheel.url,
  },
  {
    id: "everyone-gone-to-the-moon",
    title: "Everyone's Gone to the Moon",
    artist: "Chad & Jeremy",
    url: everyoneGone.url,
  },
  {
    id: "fly-me-to-the-moon",
    title: "Fly Me to the Moon",
    artist: "Frank Sinatra",
    url: flyMeToTheMoon.url,
  },
  { id: "moon-moods", title: "Moon Moods", artist: "Les Baxter", url: moonMoods.url },
  {
    id: "new-world-mvmt4",
    title: "Symphony No. 9 (From the New World), Mvmt 4",
    artist: "Antonín Dvořák",
    url: newWorld.url,
  },
];

export interface CabinMusicApi {
  /** The player is swung into frame. */
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  /** Track currently on the tape, or null. */
  readonly trackId: string | null;
  /** A track is actually sounding — the game score must stand down. */
  readonly playing: boolean;
  readonly play: (id: string) => void;
  readonly stop: () => void;
  /** Ramp the tape down over `ms` and then stow it. */
  readonly fadeOut: (ms?: number) => void;
}

/** Cabin music sits under the crew loop when a recording keys up. */
const DUCKED = 0.28;

export function useCabinMusic(duck = 1): CabinMusicApi {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const clearFade = useCallback(() => {
    if (fadeRef.current !== null && typeof window !== "undefined") {
      window.clearInterval(fadeRef.current);
    }
    fadeRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearFade();
    elRef.current?.pause();
    elRef.current = null;
    setTrackId(null);
    setPlaying(false);
  }, [clearFade]);

  // M4.59 — the tape doesn't get yanked off the reel: it rides down to silence
  // over a couple of seconds as the landing sequence takes the cabin.
  const fadeOut = useCallback(
    (ms = 2_500) => {
      const el = elRef.current;
      if (!el || typeof window === "undefined" || ms <= 0) {
        stop();
        return;
      }
      clearFade();
      const stepMs = 50;
      const start = el.volume;
      const steps = Math.max(1, Math.round(ms / stepMs));
      let n = 0;
      fadeRef.current = window.setInterval(() => {
        if (elRef.current !== el) {
          clearFade();
          return;
        }
        n += 1;
        el.volume = Math.max(0, start * (1 - n / steps));
        if (n >= steps) stop();
      }, stepMs);
    },
    [clearFade, stop],
  );

  const playRef = useRef<(id: string) => void>(() => {});

  const play = useCallback(
    (id: string) => {
      const index = CABIN_TRACKS.findIndex((t) => t.id === id);
      const track = CABIN_TRACKS[index];
      if (!track || typeof window === "undefined") return;
      clearFade();
      elRef.current?.pause();
      const el = new Audio(track.url);
      // The tape runs on: when a song ends the next one on the reel starts.
      el.loop = false;
      el.volume = 0.7;
      elRef.current = el;
      setTrackId(id);
      setPlaying(true);
      el.addEventListener("ended", () => {
        if (elRef.current !== el) return;
        const next = CABIN_TRACKS[(index + 1) % CABIN_TRACKS.length];
        if (next) playRef.current(next.id);
      });
      void el.play().catch(() => {
        if (elRef.current !== el) return;
        setPlaying(false);
      });
    },
    [clearFade],
  );

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  // Duck under the air-to-ground loop rather than cutting out.
  useEffect(() => {
    const el = elRef.current;
    if (!el || fadeRef.current !== null) return;
    el.volume = 0.7 * (duck < 1 ? DUCKED : 1);
  }, [duck, trackId]);

  useEffect(
    () => () => {
      clearFade();
      elRef.current?.pause();
      elRef.current = null;
    },
    [clearFade],
  );

  return { open, setOpen, trackId, playing, play, stop, fadeOut };
}
