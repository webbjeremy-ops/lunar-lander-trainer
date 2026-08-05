// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Cabin tape player UI: swings into frame from the left edge on a
// gloved hand, lists the tapes carried aboard, and plays the crew's choice.

import tapePlayerArt from "@/assets/cabin-tape-player.png.asset.json";
import { CABIN_TRACKS, type CabinMusicApi } from "./useCabinMusic";

export interface CabinTapePlayerProps {
  readonly music: CabinMusicApi;
  /** Hidden entirely once the crew has the vehicle. */
  readonly available: boolean;
}

export function CabinTapePlayer({ music, available }: CabinTapePlayerProps) {
  if (!available) return null;
  const current = CABIN_TRACKS.find((t) => t.id === music.trackId) ?? null;

  return (
    <div
      className="pointer-events-none fixed left-0 top-1/2 z-40 -translate-y-1/2"
      data-testid="cabin-tape-player"
    >
      <div
        className={`pointer-events-auto flex items-center transition-transform duration-700 ease-out ${
          music.open ? "translate-x-0" : "translate-x-[calc(-100%+92px)]"
        }`}
      >
        <button
          onClick={() => music.setOpen(!music.open)}
          data-testid="cabin-tape-handle"
          title={
            music.open ? "Stow the cabin tape player" : "Cabin tape player — play music in the LM"
          }
          className="relative block w-[150px] shrink-0 drop-shadow-[0_10px_25px_rgba(0,0,0,0.7)]"
        >
          <img
            src={tapePlayerArt.url}
            alt="Gloved hand holding a portable cabin tape player"
            className="w-full select-none"
            draggable={false}
          />
          {music.playing && (
            <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-emerald-500/90 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-black">
              Playing
            </span>
          )}
        </button>

        {music.open && (
          <div className="ml-[-18px] w-60 rounded-r-lg border border-neutral-700 border-l-0 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
                Cabin tapes
              </span>
              <button
                onClick={() => music.setOpen(false)}
                data-testid="cabin-tape-close"
                className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neutral-200"
              >
                Stow
              </button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {CABIN_TRACKS.map((track) => {
                const on = music.trackId === track.id;
                return (
                  <li key={track.id}>
                    <button
                      onClick={() => (on ? music.stop() : music.play(track.id))}
                      data-testid={`cabin-track-${track.id}`}
                      className={`w-full rounded border px-2 py-1 text-left transition-colors ${
                        on
                          ? "border-emerald-600 bg-emerald-950/50 text-emerald-200"
                          : "border-neutral-800 bg-neutral-900/70 text-neutral-300 hover:border-neutral-600"
                      }`}
                    >
                      <span className="block truncate text-[11px] leading-tight">
                        {on ? "▶ " : ""}
                        {track.title}
                      </span>
                      <span className="block truncate font-mono text-[9px] uppercase tracking-widest text-neutral-500">
                        {track.artist}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {current && (
              <button
                onClick={music.stop}
                data-testid="cabin-tape-stop"
                className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-neutral-500"
              >
                Stop tape · score returns
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
