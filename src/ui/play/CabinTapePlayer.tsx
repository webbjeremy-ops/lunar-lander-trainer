// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Cabin tape player UI: a small side tab on the left edge. Tapping
// the tab expands a moderate tape-deck panel; tapping again stows it.

import handTape from "@/assets/cabin-tape-hand.png.asset.json";
import { CABIN_TRACKS, type CabinMusicApi } from "./useCabinMusic";

export interface CabinTapePlayerProps {
  readonly music: CabinMusicApi;
  /** Hidden entirely once the crew has the vehicle. */
  readonly available: boolean;
}

function MusicIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
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
        className={`pointer-events-auto flex items-start transition-transform duration-500 ease-out ${
          music.open ? "translate-x-0" : "translate-x-[calc(-100%+36px)]"
        }`}
      >
        {/* Expanded tape deck */}
        <div className="relative w-[26rem] max-w-[86vw]">
          <img
            src={handTape.url}
            alt="Gloved astronaut hand holding a portable cassette player"
            className="pointer-events-none w-full select-none drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)]"
            draggable={false}
          />

          {/* Track list laid over the face of the tape deck */}
          <div className="absolute left-[45%] right-[6%] top-[27%] bottom-[10%] flex flex-col">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <MusicIcon className="h-3 w-3 text-neutral-800" />
                <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-700">
                  Cabin tapes
                </span>
              </div>
              <button
                onClick={() => music.setOpen(false)}
                data-testid="cabin-tape-close"
                className="font-mono text-[9px] uppercase tracking-widest text-neutral-600 hover:text-neutral-900"
              >
                Stow
              </button>
            </div>

            <ul className="flex-1 space-y-0.5 overflow-y-auto pr-1">
              {CABIN_TRACKS.map((track) => {
                const on = music.trackId === track.id;
                return (
                  <li key={track.id}>
                    <button
                      onClick={() => (on ? music.stop() : music.play(track.id))}
                      data-testid={`cabin-track-${track.id}`}
                      className={`w-full rounded px-1.5 py-[3px] text-left transition-colors ${
                        on
                          ? "bg-neutral-900 text-emerald-300"
                          : "text-neutral-800 hover:bg-neutral-900/10"
                      }`}
                    >
                      <span className="block truncate text-[10px] leading-tight">
                        {on ? "▶ " : ""}
                        {track.title}
                      </span>
                      <span className="block truncate font-mono text-[8px] uppercase tracking-widest opacity-70">
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
                className="mt-1 w-full rounded bg-neutral-900 px-2 py-1 font-mono text-[8px] uppercase tracking-widest text-neutral-200 hover:bg-neutral-800"
              >
                Stop tape
              </button>
            )}
          </div>
        </div>


        {/* Small side tab handle */}
        <button
          onClick={() => music.setOpen(!music.open)}
          data-testid="cabin-tape-handle"
          title={
            music.open ? "Stow the cabin tape player" : "Cabin tape player — play music in the LM"
          }
          className={`mt-2 flex h-28 w-9 flex-col items-center justify-center gap-1 rounded-r-md border border-l-0 shadow-lg backdrop-blur transition-colors ${
            music.open
              ? "border-neutral-700 bg-neutral-800/80 text-neutral-300"
              : "border-emerald-700/70 bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900/80"
          }`}
        >
          <MusicIcon className="h-4 w-4 shrink-0" />
          <span
            className="font-mono text-[9px] uppercase tracking-widest"
            style={{ writingMode: "vertical-rl" }}
          >
            Tapes
          </span>
          {music.playing && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          )}
        </button>
      </div>
    </div>
  );
}
