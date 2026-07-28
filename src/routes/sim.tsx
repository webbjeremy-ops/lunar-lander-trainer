import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useState } from "react";
import { Dsky, LampTestButton } from "@/ui/dsky/Dsky";
import { ROPE_IMAGES, ropeById, type RopeImage } from "@/sim/agc/roms";

export const Route = createFileRoute("/sim")({
  head: () => ({
    meta: [
      { title: "AGC — Tranquility · Milestone 0 spike" },
      {
        name: "description",
        content:
          "Real Apollo Guidance Computer (yaAGC/webAGC) running Luminary099 in the browser. DSKY input and lamps driven by the actual emulator.",
      },
      { property: "og:title", content: "AGC — Tranquility · Milestone 0 spike" },
      { property: "og:description", content: "Real AGC flight software in the browser." },
    ],
  }),
  component: SimPage,
});

function SimPage() {
  const [ropeId, setRopeId] = useState<RopeImage["id"]>("Luminary099");
  const rope = ropeById(ropeId);

  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          AGC — Tranquility · Milestone 0 spike
        </h1>
        <p className="mt-1 text-xs text-neutral-400">
          Authentic AGC execution. DSKY lamps + registers reflect real emulator output.
          Everything below is <em>authentic AGC execution</em>; no spacecraft physics is
          running in this build.
        </p>
      </header>

      <section className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-neutral-500" htmlFor="rope">
            Rope image
          </label>
          <select
            id="rope"
            value={ropeId}
            onChange={(e) => setRopeId(e.target.value as RopeImage["id"])}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
          >
            {ROPE_IMAGES.map((r) => (
              <option key={r.id} value={r.id}>{r.id}</option>
            ))}
          </select>
          <LampTestButton rope={rope} />
        </div>

        <ClientOnly fallback={<div className="text-xs text-neutral-500">Booting AGC…</div>}>
          <Dsky key={rope.id} rope={rope} />
        </ClientOnly>

        <details className="rounded border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">What am I looking at?</summary>
          <div className="mt-2 space-y-2">
            <p>
              The WebAssembly build of <code>yaAGC</code> (from
              <a className="text-emerald-400" href="https://github.com/michaelfranzl/webAGC" target="_blank" rel="noreferrer"> michaelfranzl/webAGC</a>)
              is executing the real Apollo 11 rope-memory image you selected
              above. All lamps and channel words on the left are driven by the
              emulator's I/O channels — nothing is animated by the UI.
            </p>
            <p>
              Try the lamp test button (Verb 35, Enter). If the emulator is
              running Luminary099 correctly, the lamps turn on and register
              digits scroll — you can watch channel 010 (the DSKY relay word)
              change in real time.
            </p>
            <p>
              Register-segment decoding (turning channel 010 into a legible
              7-segment display) is deliberately deferred to Milestone 2 per
              the approved plan. This spike proves the emulator is live in the
              browser and in the published build.
            </p>
          </div>
        </details>

        <p className="text-[10px] text-neutral-600">
          yaAGC © Ron Burkey and contributors — GPL-2.0-or-later. Rope images from{" "}
          <a className="text-emerald-400" href="https://github.com/chrislgarry/Apollo-11" target="_blank" rel="noreferrer">
            chrislgarry/Apollo-11
          </a>{" "}
          (NASA-authored, public domain). Not endorsed by NASA.
        </p>
      </section>
    </main>
  );
}
