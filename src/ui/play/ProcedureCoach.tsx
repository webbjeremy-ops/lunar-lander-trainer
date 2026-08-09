// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.16 — Procedure coach pop-ups.
//
// Presentation only: walks the player through each DSKY / landing step before
// manual takeover. One card per procedure step, dismissible, re-shown whenever
// the current step changes. No flight state is written from here.

import { useEffect, useState } from "react";
import type { DskyProcedureScript, DskyProcedureStep, ProcedureState } from "@/game/play";
import { procedureProgress } from "@/game/play";

/** Split a keystroke string such as "V 06 N 62 ENTR" into chips. */
function keyChips(keystrokes: string): readonly string[] {
  return keystrokes.split(/\s+/).filter((s) => s.length > 0);
}

export function ProcedureCoach({
  script,
  state,
  step,
  manual,
  sinceIgnitionSec = Number.POSITIVE_INFINITY,
  highGateReady = true,
  onDismiss,
}: {
  script: DskyProcedureScript;
  state: ProcedureState;
  step: DskyProcedureStep | null;
  manual: boolean;
  /** Descent-clock time, so timeline-gated steps are coached in flight order. */
  sinceIgnitionSec?: number;
  highGateReady?: boolean;
  onDismiss?: () => void;
}) {
  const stepId = step?.id ?? null;
  const [dismissedStep, setDismissedStep] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  // A new step re-opens the coach unless the player muted it for this flight.
  useEffect(() => {
    setDismissedStep(null);
  }, [stepId]);

  if (manual || muted || script.steps.length === 0 || !step) return null;
  if (dismissedStep === stepId) return null;
  // A step keyed to the descent timeline is not coached before the crew
  // callout that motivates it — the transcript leads, the DSKY follows.
  if (
    step.notBeforeSinceIgnitionSec !== undefined &&
    sinceIgnitionSec < step.notBeforeSinceIgnitionSec
  ) {
    return null;
  }
  if (step.requiresHighGate === true && !highGateReady) return null;

  const dismiss = () => {
    setDismissedStep(stepId);
    onDismiss?.();
  };

  return (
    <div
      role="dialog"
      aria-label="Procedure coach"
      data-testid="procedure-coach"
      className="pointer-events-auto w-full lm-panel rounded-md p-4 shadow-[0_18px_40px_rgba(0,0,0,0.65)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-300">
          Step {procedureProgress(script, state)} · {step.programLabel}
        </span>
        <button
          onClick={() => {
            setMuted(true);
            dismiss();
          }}
          data-testid="procedure-coach-mute"
          className="font-mono text-[9px] uppercase tracking-widest text-neutral-500 hover:text-neutral-300"
        >
          Stop coaching
        </button>
      </div>

      <h3 className="mt-2 text-base font-semibold tracking-tight text-neutral-50">
        {step.title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-300">{step.instruction}</p>

      <div className="mt-3">
        <div className="font-mono text-[9px] uppercase tracking-widest text-neutral-500">
          Key this on the DSKY
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5" data-testid="procedure-coach-keys">
          {keyChips(step.keystrokes).map((k, i) => (
            <kbd
              key={`${k}-${i}`}
              className="rounded border border-neutral-600 bg-neutral-900 px-2 py-1 font-mono text-xs tracking-widest text-emerald-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
            >
              {k}
            </kbd>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-snug text-neutral-500">
        Source: {step.citation.label} — {step.citation.detail}
      </p>

      <div className="mt-3 flex justify-end">
        <button
          onClick={dismiss}
          data-testid="procedure-coach-ack"
          className="rounded border border-emerald-700 bg-emerald-950/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-emerald-200 hover:bg-emerald-900/50"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
