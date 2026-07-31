// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.1 — DSKY procedure panel + control surfaces (presentation only).

import type { DskyProcedureScript, DskyProcedureStep, ProcedureState } from "@/game/play";
import { procedureProgress } from "@/game/play";

export function ProcedurePanel({
  script,
  state,
  step,
  onHint,
  onTakeover,
}: {
  script: DskyProcedureScript;
  state: ProcedureState;
  step: DskyProcedureStep | null;
  onHint: () => void;
  onTakeover: () => void;
}) {
  if (script.steps.length === 0) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
        <div className="text-[10px] uppercase tracking-widest text-neutral-500">Procedure</div>
        Quick Manual — no DSKY procedure required. The DSKY beside you is still
        the live Luminary 099 computer; you can key it at any time.
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-3" data-testid="procedure-panel">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-neutral-500">
          Crew procedure · {script.title}
        </div>
        <div className="font-mono text-[10px] text-neutral-400" data-testid="procedure-progress">
          {procedureProgress(script, state)}
        </div>
      </div>

      {step ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded border border-emerald-700 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              {step.programLabel}
            </span>
            <span className="text-sm text-neutral-100">{step.title}</span>
            {step.bridged && (
              <span
                title="Historically Grounded Procedure Bridge"
                data-testid="bridge-badge"
                className="rounded border border-amber-700 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-300"
              >
                bridged
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400">{step.instruction}</p>
          <div
            className="rounded border border-neutral-800 bg-black/60 px-2 py-1.5 font-mono text-sm tracking-widest text-emerald-300"
            data-testid="procedure-keystrokes"
          >
            {step.keystrokes}
          </div>
          <div className="flex flex-wrap gap-1 font-mono text-[10px]">
            {step.expected.map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 w-6 rounded " +
                  (i < state.buffer.length ? "bg-emerald-500" : "bg-neutral-800")
                }
              />
            ))}
          </div>
          <div
            className={
              "text-[11px] " + (state.entryError ? "text-red-300" : "text-neutral-400")
            }
            data-testid="procedure-message"
          >
            {state.lastMessage}
          </div>
          {step.bridged && (
            <p className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1 text-[10px] leading-snug text-amber-200/80">
              Bridged step: Luminary 099 runs authentically here but is not
              flying the vehicle, so this display state cannot be produced by
              the rope. Your keystrokes still go to the real computer.
            </p>
          )}
          <p className="text-[10px] text-neutral-600">
            Source: {step.citation.label} — {step.citation.detail}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onHint}
              data-testid="procedure-hint"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neutral-300 hover:border-emerald-600"
            >
              Hint
            </button>
            <button
              onClick={onTakeover}
              data-testid="procedure-takeover"
              className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-900/40"
            >
              Take manual control now
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-emerald-300" data-testid="procedure-message">
          Procedure complete — you have the vehicle.
        </div>
      )}
    </div>
  );
}
