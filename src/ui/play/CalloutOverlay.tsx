// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.13 — Crew-callout pop-up over the cockpit window.
//
// Shows the historical transcript call, what the learner must do about it and
// why. Bridged overlay: raised by the game, never by the Luminary 099 rope.

import { CALLOUT_CITATION, type DescentCallout } from "@/game/play";

const ACTION_LABEL: Record<DescentCallout["action"], string> = {
  none: "Monitor",
  roll: "Roll required",
  dsky: "DSKY entry required",
  throttle: "Fly the vehicle",
  land: "Land it",
};

export function CalloutOverlay({
  callout,
  onAcknowledge,
}: {
  callout: DescentCallout | null;
  onAcknowledge: (id: string) => void;
}) {
  if (!callout) return null;
  const urgent = callout.action !== "none";

  return (
    <div
      data-testid="crew-callout"
      data-callout-id={callout.id}
      data-action={callout.action}
      role="status"
      className={`pointer-events-auto rounded-md border-2 p-3 shadow-lg ${
        urgent
          ? "border-amber-500 bg-amber-950/85"
          : "border-neutral-600 bg-neutral-900/90"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${
            urgent ? "bg-amber-500 text-black" : "bg-neutral-700 text-neutral-100"
          }`}
        >
          {ACTION_LABEL[callout.action]}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
          {callout.programLabel} · air-to-ground
        </span>
        <button
          type="button"
          data-testid="callout-ack"
          onClick={() => onAcknowledge(callout.id)}
          className="ml-auto rounded border border-neutral-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:border-neutral-300"
        >
          Copy that
        </button>
      </div>

      <p className="mt-2 text-sm leading-snug text-neutral-100">
        <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
          {callout.speaker}:
        </span>{" "}
        “{callout.text}”
      </p>

      <p
        data-testid="callout-guidance"
        className={`mt-2 text-xs leading-snug ${urgent ? "text-amber-100" : "text-neutral-300"}`}
      >
        {callout.guidance}
      </p>

      <p className="mt-1 text-[10px] leading-snug text-neutral-400">{callout.teaching}</p>
      <p className="mt-1 text-[9px] leading-snug text-neutral-500">
        Bridged overlay — {CALLOUT_CITATION.label}.
      </p>
    </div>
  );
}
