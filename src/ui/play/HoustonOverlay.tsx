// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.18 — Improvised Houston advisory pop-up.
//
// Shown INSTEAD of the historical transcript whenever the flight is off the
// flown profile. Bridged overlay: raised by the game, never by the rope.

import { HOUSTON_IMPROVISED_NOTE, type HoustonCall } from "@/game/play";

const TONE: Record<HoustonCall["severity"], string> = {
  "no-go": "border-red-500 bg-red-950/85",
  caution: "border-amber-500 bg-amber-950/85",
  advisory: "border-neutral-600 bg-neutral-900/90",
};

const CHIP: Record<HoustonCall["severity"], string> = {
  "no-go": "bg-red-500 text-black",
  caution: "bg-amber-500 text-black",
  advisory: "bg-neutral-700 text-neutral-100",
};

const LABEL: Record<HoustonCall["severity"], string> = {
  "no-go": "No-go for landing",
  caution: "Caution",
  advisory: "Advisory",
};

export function HoustonOverlay({
  call,
  onAcknowledge,
}: {
  call: HoustonCall | null;
  onAcknowledge: (id: string) => void;
}) {
  if (!call) return null;

  return (
    <div
      data-testid="houston-advisory"
      data-call-id={call.id}
      data-severity={call.severity}
      role="status"
      className={`pointer-events-auto rounded-md border-2 p-3 shadow-lg ${TONE[call.severity]}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${CHIP[call.severity]}`}
        >
          {LABEL[call.severity]}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
          Houston · air-to-ground
        </span>
        {call.severity !== "no-go" && (
          <button
            type="button"
            data-testid="houston-ack"
            onClick={() => onAcknowledge(call.id)}
            className="ml-auto rounded border border-neutral-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:border-neutral-300"
          >
            Copy that
          </button>
        )}
      </div>

      <p className="mt-2 text-sm leading-snug text-neutral-100">
        <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
          CAPCOM:
        </span>{" "}
        “{call.text}”
      </p>

      <p
        data-testid="houston-guidance"
        className={`mt-2 text-xs leading-snug ${
          call.severity === "no-go" ? "text-red-100" : "text-amber-100"
        }`}
      >
        {call.guidance}
      </p>

      <p className="mt-1 text-[10px] leading-snug text-neutral-400">{call.teaching}</p>
      <p className="mt-1 text-[9px] leading-snug text-neutral-500">{HOUSTON_IMPROVISED_NOTE}</p>
    </div>
  );
}
