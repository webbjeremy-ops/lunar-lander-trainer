// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Ascent flight controls (pointer + touch; mirrors the keyboard).

import type { AscentControlsView } from "./useAscentSession";

export function AscentControls({
  controls,
  lifted,
  cutoff,
  sandbox,
  complete,
  demonstration,
  onLiftoff,
  onCutoff,
  onRelight,
  onPitch,
  onDemonstration,
  onEndFlight,
}: {
  controls: AscentControlsView;
  lifted: boolean;
  cutoff: boolean;
  sandbox: boolean;
  complete: boolean;
  demonstration: boolean;
  onLiftoff: () => void;
  onCutoff: () => void;
  onRelight: () => void;
  onPitch: (v: number) => void;
  onDemonstration: (v: boolean) => void;
  onEndFlight: () => void;
}) {
  const btn =
    "select-none rounded border border-neutral-700 bg-neutral-900 px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-neutral-200 hover:border-emerald-600 disabled:opacity-40";
  const manual = !demonstration;

  return (
    <div
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="ascent-controls"
      aria-label="Ascent controls"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Ascent controls
        </span>
        <span
          data-testid="ascent-authority"
          className={
            "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest " +
            (controls.source === "player"
              ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
              : "border-amber-600 bg-amber-950/40 text-amber-300")
          }
        >
          {controls.source === "player" ? "pilot has control" : "demonstration flying"}
        </span>
      </div>

      {!lifted ? (
        <button
          className={`w-full ${btn} border-emerald-600 text-emerald-200`}
          data-testid="ascent-liftoff"
          onClick={onLiftoff}
          disabled={complete}
        >
          Liftoff — stage and ignite APS
        </button>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <button
              className={btn}
              disabled={!manual || complete}
              data-testid="ascent-pitch-left"
              onPointerDown={() => onPitch(-1)}
              onPointerUp={() => onPitch(0)}
              onPointerLeave={() => onPitch(0)}
            >
              ◀◀ pitch
            </button>
            <button
              className={btn}
              disabled={!manual || complete}
              data-testid="ascent-pitch-left-fine"
              onPointerDown={() => onPitch(-0.25)}
              onPointerUp={() => onPitch(0)}
              onPointerLeave={() => onPitch(0)}
            >
              ◀ fine
            </button>
            <button
              className={btn}
              disabled={!manual || complete}
              data-testid="ascent-pitch-right-fine"
              onPointerDown={() => onPitch(0.25)}
              onPointerUp={() => onPitch(0)}
              onPointerLeave={() => onPitch(0)}
            >
              fine ▶
            </button>
            <button
              className={btn}
              disabled={!manual || complete}
              data-testid="ascent-pitch-right"
              onPointerDown={() => onPitch(1)}
              onPointerUp={() => onPitch(0)}
              onPointerLeave={() => onPitch(0)}
            >
              pitch ▶▶
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className={`${btn} ${cutoff ? "" : "border-red-700 text-red-200"}`}
              disabled={cutoff || complete}
              data-testid="ascent-cutoff"
              onClick={onCutoff}
            >
              Engine cutoff
            </button>
            <button
              className={btn}
              disabled={!sandbox || !cutoff || complete}
              data-testid="ascent-relight"
              onClick={onRelight}
            >
              Relight (sandbox)
            </button>
          </div>
        </>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          className={`${btn} ${demonstration ? "border-amber-600 text-amber-300" : ""}`}
          data-testid="ascent-demo"
          onClick={() => onDemonstration(!demonstration)}
          disabled={complete}
        >
          {demonstration ? "Demonstration on" : "Demonstrate the pitch program"}
        </button>
        <button
          className={btn}
          data-testid="ascent-end"
          onClick={onEndFlight}
          disabled={complete || !lifted}
        >
          End flight · debrief
        </button>
      </div>

      <div className="mt-2 font-mono text-[10px] text-neutral-500">
        pitch command {controls.pitchCommand.toFixed(2)} · APS{" "}
        {controls.engineOn ? "burning" : "off"}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        Keyboard: ←/→ pitch, hold Shift for fine authority. The instructor cue is
        drawn but never applied — only the demonstration autopilot, which you
        switch on above, ever moves the controls for you, and the debrief records
        that it did.
      </p>
    </div>
  );
}
