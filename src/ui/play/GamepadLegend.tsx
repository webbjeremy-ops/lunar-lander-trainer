// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.30 — Xbox controller legend. Appears only once a pad is connected, and
// mirrors the mapping implemented in `xboxGamepad.ts`.

import { useEffect, useState } from "react";

const BINDINGS: readonly (readonly [string, string])[] = [
  ["Left stick ↑/↓", "DPS throttle"],
  ["Right stick ←/→", "Pitch attitude"],
  ["Right trigger", "Roll to windows-up"],
  ["Right bumper", "Cancel program alarm"],
  ["Left bumper", "Accept pending DSKY program"],
  ["A", "Engine on / off"],
  ["B", "Abort stage"],
  ["D-pad / left trigger", "Rate-of-descent trim"],
];

export function GamepadLegend({ haptics, onHaptics }: {
  haptics: boolean;
  onHaptics: (on: boolean) => void;
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

  if (!connected) return null;

  return (
    <div
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      data-testid="gamepad-legend"
      aria-label="Controller bindings"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Controller
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
        {BINDINGS.map(([control, action]) => (
          <div key={control} className="contents">
            <dt className="text-neutral-500">{control}</dt>
            <dd className="text-neutral-300">{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
