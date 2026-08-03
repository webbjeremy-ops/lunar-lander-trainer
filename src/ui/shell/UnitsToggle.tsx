// SPDX-License-Identifier: GPL-3.0-or-later
//
// Global SI ⇄ Apollo (imperial) unit toggle.
//
// Presentation only: the kernels stay SI. This just flips the shared
// `units` preference every readout formatter already reads.

import { useSettings } from "@/settings/SettingsProvider";

export function UnitsToggle() {
  const { settings, set } = useSettings();
  const apollo = settings.units === "apollo";

  const base =
    "rounded px-1.5 py-0.5 uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

  return (
    <div
      className="flex items-center gap-1 rounded border border-neutral-800 bg-black/40 px-1 py-0.5"
      data-testid="units-toggle"
      role="group"
      aria-label="Unit system"
    >
      <button
        type="button"
        data-testid="units-toggle-metric"
        aria-pressed={!apollo}
        title="SI units — metres, m/s, kilograms"
        onClick={() => set({ units: "metric" })}
        className={`${base} ${apollo ? "text-neutral-500 hover:text-neutral-200" : "bg-emerald-500/15 text-emerald-300"}`}
      >
        SI
      </button>
      <button
        type="button"
        data-testid="units-toggle-apollo"
        aria-pressed={apollo}
        title="Apollo units — feet, ft/s, nautical miles, pounds"
        onClick={() => set({ units: "apollo" })}
        className={`${base} ${apollo ? "bg-emerald-500/15 text-emerald-300" : "text-neutral-500 hover:text-neutral-200"}`}
      >
        Apollo
      </button>
    </div>
  );
}
