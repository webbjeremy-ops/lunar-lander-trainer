// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.7 — PDI ritual cockpit panel: TIG countdown clock, ENG ARM / DESCENT
// switch, DPS throttle profile and the crew callout tape.
//
// Presentation only. Every value comes from the pure ignition reducer in
// src/game/play/ignitionSequence.ts; this component never advances time.

import {
  FIXED_THROTTLE_DURATION_US,
  FIXED_THROTTLE_FRACTION,
  IGNITION_CITATION,
  throttleCeiling,
  type IgnitionSequenceState,
} from "@/game/play";

const PHASE_LABEL: Record<IgnitionSequenceState["phase"], string> = {
  standby: "Standby",
  countdown: "Countdown",
  "ignition-request": "Ignition request",
  ullage: "Ullage — RCS +X",
  burning: "Descent engine burning",
  aborted: "Aborted",
};

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
  const ceiling = throttleCeiling(state);
  const ftpRemainingS =
    state.phase === "burning"
      ? Math.max(0, (FIXED_THROTTLE_DURATION_US - state.sinceIgnitionUs) / 1_000_000)
      : null;

  return (
    <section
      data-testid="ignition-panel"
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      aria-label="Powered-descent ignition sequence"
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">
          PDI ignition sequence
        </h2>
        <span className="text-[9px] uppercase tracking-widest text-amber-500/80">
          Historically grounded bridge
        </span>
      </header>

      <div className="flex items-center gap-3">
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
        <div className="text-[11px] text-neutral-400">
          <div className="uppercase tracking-widest text-neutral-500">
            {PHASE_LABEL[state.phase]}
          </div>
          <div>{state.lastMessage}</div>
        </div>
      </div>

      {/* ENG ARM — Aldrin's switch. Hardware, not a DSKY key. */}
      <div className="mt-3 flex items-center gap-2">
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
        <span
          className={`text-[10px] uppercase tracking-widest ${
            state.armFault ? "text-red-400" : "text-neutral-500"
          }`}
        >
          {state.armFault
            ? "PROCEED refused — engine not armed"
            : "LMP panel 1 · set before PROCEED"}
        </span>
      </div>

      {/* DPS throttle profile. */}
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-neutral-500">
          <span>DPS throttle authority</span>
          <span className="font-mono text-neutral-400">
            {ftpRemainingS !== null && ftpRemainingS > 0
              ? `FTP ${FIXED_THROTTLE_FRACTION * 100}% · throttle-up in ${ftpRemainingS.toFixed(0)} s`
              : `${Math.round(ceiling * 100)}% ceiling`}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
          <div
            className="h-full bg-amber-500 transition-[width] duration-200"
            style={{ width: `${Math.round(ceiling * 100)}%` }}
          />
        </div>
      </div>

      {/* Crew callouts. */}
      <ol
        data-testid="crew-callouts"
        className="mt-3 max-h-32 space-y-1 overflow-y-auto text-[11px]"
      >
        {state.spoken.length === 0 && (
          <li className="text-neutral-600">Crew loop quiet.</li>
        )}
        {state.spoken.map((c, i) => (
          <li key={`${c.atTigSeconds}-${i}`} className="text-neutral-300">
            <span className="font-mono text-neutral-500">
              {c.atTigSeconds >= 0 ? "+" : "−"}
              {Math.abs(c.atTigSeconds).toFixed(0).padStart(2, "0")}s{" "}
            </span>
            <span className="text-neutral-400">{c.speaker}:</span> {c.text}
            {c.attributed && (
              <span className="ml-1 text-[9px] uppercase tracking-widest text-amber-600/80">
                paraphrase
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[9px] leading-relaxed text-neutral-600">
        {IGNITION_CITATION.label} — {IGNITION_CITATION.detail}
      </p>
    </section>
  );
}
