// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Orbital-operations exercise selection.

import { ORBIT_SCENARIOS, type OrbitScenario } from "@/simulation/orbitOps";

const ORDERED: readonly OrbitScenario[] = Object.values(ORBIT_SCENARIOS).sort(
  (a, b) => a.order - b.order,
);

export function OrbitScenarioSelect({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Orbital operations exercises" data-testid="orbit-scenario-select">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
        Exercises
      </h2>
      <ul className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {ORDERED.map((s) => {
          const active = s.id === selectedId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-pressed={active}
                data-testid={`orbit-scenario-${s.id}`}
                className={`h-full w-full rounded border p-3 text-left transition ${
                  active
                    ? "border-emerald-500 bg-emerald-950/30"
                    : "border-neutral-800 bg-neutral-950 hover:border-neutral-600"
                }`}
              >
                <span className="block font-mono text-xs uppercase tracking-widest text-neutral-100">
                  {s.title}
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                  {s.subtitle}
                </span>
                <span className="mt-2 block text-[11px] leading-snug text-neutral-400">
                  {s.summary}
                </span>
                <span className="mt-2 block font-mono text-[9px] uppercase tracking-widest text-neutral-600">
                  {s.fidelityClassification}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
