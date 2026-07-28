import { createFileRoute } from "@tanstack/react-router";
import { ROPE_IMAGES } from "@/sim/agc/roms";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "Sources & Methodology · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Attribution, licenses, rope-image provenance, and known limitations for the AGC — Tranquility Apollo 11 simulator.",
      },
      { property: "og:title", content: "Sources & Methodology · AGC — Tranquility" },
      {
        property: "og:description",
        content: "Attribution and provenance for the AGC — Tranquility simulator.",
      },
    ],
  }),
  component: SourcesPage,
});

function SourcesPage() {
  return (
    <main className="min-h-screen bg-neutral-900 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
        <header>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-emerald-400">
            Sources & Methodology
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Where every historical bit comes from</h1>
        </header>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Emulator</h2>
          <p className="text-neutral-400">
            The Apollo Guidance Computer is emulated by a WebAssembly build of{" "}
            <a className="text-emerald-400" href="https://github.com/michaelfranzl/webAGC">webAGC</a>{" "}
            (© Michael Karl Franzl), which is itself a port of{" "}
            <a className="text-emerald-400" href="https://github.com/rburkey2005/virtualagc">Virtual AGC</a>{" "}
            (yaAGC, © Ron Burkey and contributors). Both are licensed under{" "}
            <strong>GPL-2.0-or-later</strong>. The <code>src/sim/agc/</code>{" "}
            subsystem in this project is distributed under the same license so
            the combined work is compliant.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Rope memory images</h2>
          <p className="mb-3 text-neutral-400">
            Assembled from NASA-authored Apollo 11 source at{" "}
            <a className="text-emerald-400" href="https://github.com/chrislgarry/Apollo-11">chrislgarry/Apollo-11</a>{" "}
            (public domain). Prebuilt binaries were taken from the webAGC demo
            directory. Locked by SHA-256:
          </p>
          <ul className="space-y-2 font-mono text-xs">
            {ROPE_IMAGES.map((r) => (
              <li key={r.id} className="rounded border border-neutral-800 bg-black/40 p-2">
                <div className="text-emerald-400">{r.id}</div>
                <div className="text-neutral-500">{r.description}</div>
                <div className="mt-1 break-all text-neutral-400">SHA-256: {r.sha256}</div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Subsystem authenticity labels</h2>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li><span className="text-emerald-400">Authentic AGC execution</span> — yaAGC + Luminary099/Comanche055 rope images.</li>
            <li><span className="text-amber-300">Historically reconstructed spacecraft interface</span> — planned; not yet implemented.</li>
            <li><span className="text-amber-300">Physics approximation</span> — planned; not yet implemented.</li>
            <li><span className="text-amber-300">Educational visualization</span> — planned; not yet implemented.</li>
            <li><span className="text-neutral-500">Planned but not yet implemented</span> — everything else in the roadmap.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Known limitations (Milestone 0)</h2>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li>Register 7-segment decoding of channel 010 is not implemented yet — raw binary channel words are shown instead.</li>
            <li>No spacecraft physics, no scenarios, no 3D viewport.</li>
            <li>AGC runs on a JS interval, not the deterministic mission clock. Not replay-safe yet.</li>
            <li>AGC runs on the main thread; Worker isolation lands in Milestone 1.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Disclaimer</h2>
          <p className="text-neutral-400">
            This project is not affiliated with, endorsed by, or certified by
            NASA. All NASA-authored source material is public domain; all other
            historical references are cited with their upstream repositories.
          </p>
        </section>
      </div>
    </main>
  );
}
