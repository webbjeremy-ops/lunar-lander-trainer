import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About & Credits · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Independent educational Apollo 11 simulator. Credits, licenses, and the authentic/modeled/approximate classification for every subsystem.",
      },
      { property: "og:title", content: "About & Credits · AGC — Tranquility" },
      {
        property: "og:description",
        content: "Credits, licensing, and the authenticity classification for AGC — Tranquility.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="min-h-screen bg-neutral-900 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
        <header>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-emerald-400">
            About & Credits
          </p>
          <h1 className="mt-2 text-2xl font-semibold">AGC — Tranquility</h1>
          <p className="mt-2 text-neutral-400">
            An independent, free-to-play, open-source educational Apollo 11
            simulator. Not sponsored, approved, or endorsed by NASA, MIT, the
            Virtual AGC project, or any original Apollo contributor.
          </p>
        </header>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Source code</h2>
          <p className="text-neutral-400">
            The full source of the combined distributed application is
            published on GitHub and licensed under <strong>GPL-3.0-or-later</strong>. The upstream
            Apollo Guidance Computer emulator (webAGC / yaAGC) remains under
            its original <strong>GPL-2.0-or-later</strong> notice. See{" "}
            <Link className="text-emerald-400" to="/sources">Sources & Methodology</Link>{" "}
            for the full attribution.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">What is authentic vs. modeled vs. approximate</h2>
          <div className="mt-2 space-y-3 text-neutral-400">
            <div>
              <div className="font-mono text-emerald-400 text-xs uppercase tracking-widest">Authentic</div>
              <p>
                The Apollo Guidance Computer itself: the yaAGC WebAssembly core
                executes the unmodified <code>Luminary099</code> rope image
                assembled from public-domain NASA source. Every DSKY lamp and
                every channel word in this app comes from the emulator's real
                I/O channels — nothing is animated or scripted.
              </p>
            </div>
            <div>
              <div className="font-mono text-emerald-400 text-xs uppercase tracking-widest">Historically grounded / modeled</div>
              <p>
                The mission clock, snapshot cadence, event log, and
                deterministic replay model are our engineering choices. They
                are designed to preserve AGC execution semantics faithfully
                (11 720 ns per instruction, 20 ms fixed sim tick) but they are
                a modern software design, not part of the original Apollo
                hardware.
              </p>
            </div>
            <div>
              <div className="font-mono text-emerald-400 text-xs uppercase tracking-widest">Educational approximation (later milestones)</div>
              <p>
                Physics, spacecraft dynamics, 3D scenery, and any visual
                interpretation of AGC output beyond raw channel bits are
                deliberately deferred to future milestones. When they arrive,
                each will be clearly labelled here as an approximation, not as
                a faithful reproduction of any specific Apollo simulator.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-neutral-200">Milestone 1 status</h2>
          <p className="text-neutral-400">
            The AGC executes inside a dedicated Web Worker behind a typed
            message protocol. A fixed 20 ms mission-time tick with 11 720 ns
            AGC-step accumulator produces deterministic execution; the same
            rope + seed + event log always yields the same observable-state
            checksum. Snapshots are throttled to ~25 real-time Hz regardless
            of time acceleration; DSKY lamp changes and alarms bypass the
            throttle. No SharedArrayBuffer or Atomics is used; the app runs
            fully when <code>crossOriginIsolated === false</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
