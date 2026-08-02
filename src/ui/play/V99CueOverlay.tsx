// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.46 — Flashing V99 N62 pop-up cue.
//
// The DSKY already flashes the bridged ignition request; this raises the same
// request as a top-of-stack cue so the crew cannot miss it while heads-down.
// Bridged overlay: produced by the game, never by the Luminary 099 rope.

import { useEffect, useState } from "react";

export function V99CueOverlay({
  flashing,
  engineArmed,
  proAccepted,
}: {
  flashing: boolean;
  engineArmed: boolean;
  proAccepted: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!flashing) setDismissed(false);
  }, [flashing]);

  if (!flashing || dismissed || proAccepted) return null;

  return (
    <div
      data-testid="v99-cue"
      role="status"
      className="pointer-events-auto rounded-md border-2 border-amber-500 bg-amber-950/85 p-3 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="animate-pulse rounded bg-amber-500 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-black">
          V99 N62 · flashing
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
          P63 · computer request
        </span>
        <button
          type="button"
          data-testid="v99-cue-ack"
          onClick={() => setDismissed(true)}
          className="ml-auto rounded border border-neutral-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:border-neutral-300"
        >
          Got it
        </button>
      </div>

      <p className="mt-2 text-sm leading-snug text-neutral-100">
        The computer is asking permission to ignite the descent engine.
      </p>
      <p className="mt-2 text-xs leading-snug text-amber-100">
        {engineArmed
          ? "ENG ARM is at DESCENT — answer the request with PRO on the DSKY."
          : "Set ENG ARM to DESCENT first, then answer with PRO. PRO is refused with the switch off."}
      </p>
      <p className="mt-1 text-[9px] leading-snug text-neutral-500">
        Bridged overlay — the pinned Luminary 099 rope does not fly this vehicle.
      </p>
    </div>
  );
}
