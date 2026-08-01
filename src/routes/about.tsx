import { createFileRoute, Link } from "@tanstack/react-router";
import { AccuracyLegend } from "@/ui/shell/AccuracyLegend";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About & credits — what is real and what is modelled · Tranquility" },
      {
        name: "description",
        content:
          "Tranquility is an independent, free, open-source Apollo lunar-flight simulator. Credits, licensing, the accuracy policy, and the physics firewall that keeps the AGC out of the control loop.",
      },
      { property: "og:title", content: "About & credits · Tranquility" },
      {
        property: "og:description",
        content: "Credits, licensing and the accuracy policy behind Tranquility.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="min-h-screen bg-neutral-900 px-4 py-10 text-neutral-100 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-400">
            About &amp; credits
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Tranquility</h1>
          <p className="mt-2 text-neutral-400">
            An independent, free-to-play, open-source educational Apollo lunar-flight simulator:
            learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar
            orbit. Not sponsored, approved or endorsed by NASA, MIT, the Virtual AGC project, or
            any original Apollo contributor.
          </p>
        </header>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">What is in the product</h2>
          <ul className="mt-2 space-y-1 text-neutral-400">
            <li>
              · <strong className="text-neutral-300">Missions</strong> — five lunar-descent
              scenarios and four lunar-ascent scenarios, each with a briefing, a scored debrief and
              three assistance levels.
            </li>
            <li>
              · <strong className="text-neutral-300">Learn</strong> — sixteen lessons in four
              tracks: flying on the Moon, rocket physics, the Apollo Guidance Computer, and orbital
              mechanics. One lesson hands you straight into a scored flight and takes the result
              back.
            </li>
            <li>
              · <strong className="text-neutral-300">AGC Lab</strong> — a full-size interactive
              DSKY on the live computer.
            </li>
            <li>
              · <strong className="text-neutral-300">Explore</strong> — read-only telemetry,
              deterministic event-log export/import and scrubable replay.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Source code and licensing</h2>
          <p className="text-neutral-400">
            The full source of the distributed application is licensed under{" "}
            <strong>GPL-3.0-or-later</strong>. The upstream Apollo Guidance Computer emulator
            (webAGC / yaAGC) remains under its original <strong>GPL-2.0-or-later</strong> notice,
            and the Luminary 099 rope source is NASA-authored public domain. See{" "}
            <Link className="text-emerald-400 underline underline-offset-2" to="/sources">
              Sources &amp; methodology
            </Link>{" "}
            for hashes, commits and reproduction status.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Historical-accuracy policy</h2>
          <div className="mt-2 space-y-3 text-neutral-400">
            <p>
              Every number, diagram and behaviour in Tranquility carries one of five
              classifications, and we never present a thing as more authentic than it is. Factual
              claims in lessons cite a registered source; simulation constants carry provenance in
              code.
            </p>
            <p>
              <strong className="text-neutral-300">The computer is authentic.</strong> Luminary 099
              executes unmodified on a yaAGC WebAssembly core with an 11 720 ns per-instruction
              accumulator and a 20 ms mission tick. Lamps, digits and annunciators are decoded from
              channels 010, 011, 013 and 0163. Nothing is animated or scripted.
            </p>
            <p>
              <strong className="text-neutral-300">The spacecraft is a model.</strong> Flight uses
              a deterministic Moon-centred planar kernel: inverse-square gravity, variable mass,
              separate descent and ascent engine models, simplified attitude response. Masses,
              thrusts and specific impulses are source-derived; trajectories are historically
              grounded reconstructions, not replays of Apollo 11.
            </p>
            <p>
              <strong className="text-neutral-300">The physics firewall is absolute.</strong> The
              AGC never commands the vehicle, and the vehicle never writes to the AGC. Closed-loop
              AGC control is out of scope by design, and the test suite fails if the boundary is
              crossed — the frozen one-dimensional golden touchdown must stay bit-identical at
              368 279 425 µs.
            </p>
            <p>
              <strong className="text-neutral-300">
                Where the DSKY procedure is a bridge, we say so.
              </strong>{" "}
              Some cockpit states are not reachable in the real rope without a full powered-descent
              bootstrap, so the in-game sequence is labelled a historically grounded procedure
              bridge rather than a rope-driven program.
            </p>
          </div>
        </section>

        <AccuracyLegend />

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Privacy</h2>
          <p className="text-neutral-400">
            There is no account, no login and no server-side profile. Learning progress and
            settings are stored in this browser's local storage, and both can be exported, imported
            or erased from{" "}
            <Link className="text-emerald-400 underline underline-offset-2" to="/settings">
              Settings
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Known limitations</h2>
          <ul className="mt-2 space-y-1 text-neutral-400">
            <li>· Planar (two-dimensional) flight only; no out-of-plane motion or plane changes.</li>
            <li>· No rendezvous, docking, or command-module simulation.</li>
            <li>· The AGC cannot fly the vehicle, and the vehicle cannot feed the AGC in flight.</li>
            <li>· Audio is synthesized; there are no Apollo mission recordings in the product.</li>
            <li>· Desktop-first layout; phones are supported but the cockpit is dense.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
