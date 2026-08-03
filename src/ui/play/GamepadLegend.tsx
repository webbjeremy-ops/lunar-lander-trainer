// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.30 / M4.49 — Xbox controller legend. Appears only once a pad is
// connected, and mirrors the mapping implemented in `xboxGamepad.ts` and
// `usePlaySession.ts`. The mapping changes at manual takeover, so the legend
// changes with it.

import { useEffect, useState } from "react";

export type LegendPhase = "guided" | "manual";

type Binding = readonly [string, string];

const GUIDED: readonly Binding[] = [
  ["Left stick ↑/↓", "DPS throttle"],
  ["Right trigger", "Roll to windows-up"],
  ["Left trigger", "Take manual control"],
  ["A", "Got it / Copy that"],
  ["X", "Eng Arm (PDI)"],
  ["Y", "Engine on / off"],
  ["B", "Abort stage"],
  ["Right bumper", "Cancel program alarm"],
  ["Left bumper", "Accept pending DSKY program"],
  ["D-pad ↑/↓", "Rate-of-descent trim"],
  ["View (⧉)", "Window view on / off"],
  ["Right stick ↕", "Scroll the page"],
];

const MANUAL: readonly Binding[] = [
  ["Right stick ↕", "Pitch forward / back"],
  ["Right trigger", "Throttle / boost"],
  ["Right bumper", "Short throttle burst"],
  ["Y", "Engine off"],
  ["Left stick ↑/↓", "Fine throttle trim"],
  ["D-pad ↑/↓", "Rate-of-descent trim"],
  ["A", "Got it / Copy that"],
  ["Left bumper", "Accept pending DSKY program"],
  ["B", "Abort stage"],
  ["View (⧉)", "Window view on / off"],
];

const VR_GUIDED: readonly Binding[] = [
  ["Left stick ↑/↓", "DPS throttle"],
  ["Left stick ←/→", "Rate-of-descent trim"],
  ["Left trigger", "Take manual control"],
  ["Left grip", "Accept pending DSKY program"],
  ["X (left)", "Eng Arm (PDI)"],
  ["Y (left)", "Engine on / off"],
  ["Right trigger", "Roll to windows-up"],
  ["Right grip", "Cancel program alarm"],
  ["A (right)", "Got it / Copy that"],
  ["B (right)", "Abort stage"],
  ["Right stick press", "Window view on / off"],
  ["Right stick ↕", "Scroll the page"],
];

const VR_MANUAL: readonly Binding[] = [
  ["Right stick ↕", "Pitch forward / back"],
  ["Right trigger", "Throttle / boost"],
  ["Right grip", "Short throttle burst"],
  ["Y (left)", "Engine off"],
  ["Left stick ↑/↓", "Fine throttle trim"],
  ["Left stick ←/→", "Rate-of-descent trim"],
  ["A (right)", "Got it / Copy that"],
  ["Left grip", "Accept pending DSKY program"],
  ["B (right)", "Abort stage"],
  ["Right stick press", "Window view on / off"],
];

export function GamepadLegend({ haptics, onHaptics, phase = "guided", scheme = "xbox" }: {
  haptics: boolean;
  onHaptics: (on: boolean) => void;
  phase?: LegendPhase;
  scheme?: "xbox" | "vr";
}) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const sync = () => {
      const pads = navigator.getGamepads?.() ?? [];
      setConnected(Array.from(pads).some((p) => p !== null && p.connected));
    };
    sync();
    const id = window.setInterval(sync, 1000);
    window.addEventListener("gamepadconnected", sync);
    window.addEventListener("gamepaddisconnected", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("gamepadconnected", sync);
      window.removeEventListener("gamepaddisconnected", sync);
    };
  }, []);

  if (!connected && scheme !== "vr") return null;

  const vr = scheme === "vr";
  const bindings = vr
    ? phase === "manual"
      ? VR_MANUAL
      : VR_GUIDED
    : phase === "manual"
      ? MANUAL
      : GUIDED;



  return (
    <div
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="gamepad-legend"
      aria-label="Controller bindings"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          {vr ? `Quest 3 — ${phase === "manual" ? "manual landing" : "guided descent"}` : "Controller"}
        </span>

        <button
          type="button"
          onClick={() => onHaptics(!haptics)}
          aria-pressed={haptics}
          className={
            "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest " +
            (haptics
              ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
              : "border-neutral-700 text-neutral-500")
          }
        >
          Rumble {haptics ? "on" : "off"}
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
        {bindings.map(([control, action]) => (
          <div key={control} className="contents">
            <dt className="text-neutral-500">{control}</dt>
            <dd className="text-neutral-300">{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
