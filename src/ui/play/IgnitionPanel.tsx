// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.44 — PDI ritual cockpit panel, stripped to the two things the crew
// actually operates at this moment: the TIG countdown clock and the
// ENG ARM / DESCENT switch. The radio traffic now plays on the comm loop.
//
// Presentation only. Every value comes from the pure ignition reducer in
// src/game/play/ignitionSequence.ts; this component never advances time.

import type { IgnitionSequenceState } from "@/game/play";

export function IgnitionPanel({
  state,
  clock,
  onArm,
}: {
  readonly state: IgnitionSequenceState;
  readonly clock: string;
  readonly onArm: (on: boolean) => void;
}) {
  const armed = state.engineArmed;

  return (
    <section
      data-testid="ignition-panel"
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      aria-label="Powered-descent ignition sequence"
    >
      <header className="mb-2">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">
          PDI ignition sequence
        </h2>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div
          data-testid="tig-clock"
          className={`font-mono text-3xl tabular-nums ${
            state.phase === "aborted"
              ? "text-red-400"
              : state.phase === "burning"
                ? "text-emerald-300"
                : state.phase === "ignition-request"
                  ? "animate-pulse text-amber-300"
                  : "text-neutral-200"
          }`}
        >
          {clock}
        </div>

        {/* ENG ARM — Aldrin's switch. Hardware, not a DSKY key. */}
        <button
          type="button"
          data-testid="eng-arm"
          aria-pressed={armed}
          onClick={() => onArm(!armed)}
          disabled={state.phase === "standby" || state.phase === "aborted"}
          className={`rounded border px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors disabled:opacity-40 ${
            armed
              ? "border-emerald-600 bg-emerald-950/50 text-emerald-300"
              : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Eng Arm · {armed ? "Descent" : "Off"}
        </button>
      </div>

      {state.armFault && (
        <p className="mt-2 text-[10px] uppercase tracking-widest text-red-400">
          PROCEED refused — engine not armed
        </p>
      )}
    </section>
  );
}
