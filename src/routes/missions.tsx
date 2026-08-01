// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.4 — /missions : the single hub for every playable mission.
//
// This route only presents the existing frozen registries (M4.1 descent,
// M4.3 ascent). It defines no new mission and changes no flight mechanics.

import { createFileRoute, Link } from "@tanstack/react-router";
import { MISSIONS } from "@/game/play";
import { ASCENT_MISSIONS, ASCENT_MISSION_IDS } from "@/game/ascent/missions";
import { ORBIT_SCENARIOS } from "@/simulation/orbitOps";
import { AccuracyLegend } from "@/ui/shell/AccuracyLegend";

export const Route = createFileRoute("/missions")({
  head: () => ({
    meta: [
      { title: "Missions — lunar descent, ascent and orbital operations · Tranquility" },
      {
        name: "description",
        content:
          "Fifteen flyable exercises: five lunar-descent scenarios, four lunar-ascent scenarios, and six orbital-operations exercises from Orbit Fundamentals to the Apollo 11 Orbital Operations Challenge.",
      },
      { property: "og:title", content: "Missions · Tranquility" },
      {
        property: "og:description",
        content:
          "Fly a lunar descent, a lunar liftoff, or plan orbital manoeuvres — with the real AGC beside you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MissionsPage,
});

const DESCENT_ORDER = Object.values(MISSIONS).sort((a, b) => a.order - b.order);
const ASCENT_ORDER = ASCENT_MISSION_IDS.map((id) => ASCENT_MISSIONS[id]).sort(
  (a, b) => a.order - b.order,
);
const ORBIT_ORDER = Object.values(ORBIT_SCENARIOS).sort((a, b) => a.order - b.order);


function MissionsPage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-400">
            Missions
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Fly down to Tranquility Base, then fly back up.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-400">
            Every mission runs on the same deterministic planar flight kernel and the same
            authentic AGC session. Assistance level is chosen at the start of each flight and
            defaults to your{" "}
            <Link className="text-emerald-400 underline underline-offset-2" to="/settings">
              settings
            </Link>
            .
          </p>
        </header>

        <section aria-labelledby="descent-heading" data-testid="missions-descent">
          <h2 id="descent-heading" className="text-lg font-semibold text-neutral-100">
            Lunar descent
          </h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {DESCENT_ORDER.map((m) => (
              <li key={m.id}>
                <Link
                  to="/play"
                  data-testid={`missions-card-${m.id}`}
                  className="block h-full rounded border border-neutral-800 bg-neutral-950/60 p-4 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-neutral-100">{m.title}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                      #{m.order}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                    {m.subtitle}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-400">{m.summary}</p>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    <span className="text-neutral-400">Objective:</span> {m.objective}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ascent-heading" data-testid="missions-ascent">
          <h2 id="ascent-heading" className="text-lg font-semibold text-neutral-100">
            Lunar ascent
          </h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {ASCENT_ORDER.map((m) => (
              <li key={m.id}>
                <Link
                  to="/play/ascent"
                  data-testid={`missions-card-${m.id}`}
                  className="block h-full rounded border border-neutral-800 bg-neutral-950/60 p-4 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-neutral-100">{m.title}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                      #{m.order}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                    {m.subtitle}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-400">{m.summary}</p>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    <span className="text-neutral-400">Objective:</span> {m.objective}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <AccuracyLegend compact />
      </div>
    </main>
  );
}
