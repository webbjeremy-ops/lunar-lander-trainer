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
import mistOTheMoon from "@/assets/mist-o-the-moon.mp3.asset.json";
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
    artist: "Blood, Sweat & Tears",
    url: spinningWheel.url,
  },
  {
    id: "everyone-gone-to-the-moon",
    title: "Everyone's Gone to the Moon",
    artist: "Jonathan King",
    url: everyoneGone.url,
  },
  {
    id: "fly-me-to-the-moon",
    title: "Fly Me to the Moon",
    artist: "Frank Sinatra",
    url: flyMeToTheMoon.url,
  },
  { id: "mist-o-the-moon", title: "Mist o' the Moon", artist: "Les Baxter", url: mistOTheMoon.url },
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
}

/** Cabin music sits under the crew loop when a recording keys up. */
const DUCKED = 0.28;

export function useCabinMusic(duck = 1): CabinMusicApi {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    elRef.current?.pause();
    elRef.current = null;
    setTrackId(null);
    setPlaying(false);
  }, []);

  const playRef = useRef<(id: string) => void>(() => {});

  const play = useCallback((id: string) => {
    const index = CABIN_TRACKS.findIndex((t) => t.id === id);
    const track = CABIN_TRACKS[index];
    if (!track || typeof window === "undefined") return;
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
  }, []);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  // Duck under the air-to-ground loop rather than cutting out.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.volume = 0.7 * (duck < 1 ? DUCKED : 1);
  }, [duck, trackId]);

  useEffect(
    () => () => {
      elRef.current?.pause();
      elRef.current = null;
    },
    [],
  );

  return { open, setOpen, trackId, playing, play, stop };
}
