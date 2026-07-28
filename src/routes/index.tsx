import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AGC — Tranquility · Apollo 11 simulator" },
      {
        name: "description",
        content:
          "A browser-based Apollo 11 simulator running the real Apollo Guidance Computer flight software (Luminary099) via WebAssembly.",
      },
      { property: "og:title", content: "AGC — Tranquility" },
      {
        property: "og:description",
        content: "Real Apollo Guidance Computer flight software in your browser.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="flex min-h-screen flex-col bg-neutral-900 text-neutral-100">
      <div className="mx-auto flex max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-xs font-mono uppercase tracking-[0.3em] text-emerald-400">
          Project AGC — Tranquility
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-100">
          Apollo 11, running the real flight computer.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400">
          Tranquility is an educational Apollo 11 simulator built around a
          WebAssembly port of <code>yaAGC</code>. The Lunar Module (Luminary099)
          and Command Module (Comanche055) rope-memory images execute inside
          your browser, driving an authentic DSKY. This build is the
          Milestone-0 technical spike: emulator, rope images, DSKY input, and
          lamp test only. Physics, flight scenarios, and 3D visualization
          arrive in later milestones per the approved plan.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/sim"
            className="rounded border border-emerald-500 bg-emerald-950/30 px-4 py-2 font-mono text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40"
          >
            Open the DSKY spike →
          </Link>
          <Link
            to="/sources"
            className="rounded border border-neutral-700 px-4 py-2 font-mono text-xs uppercase tracking-widest text-neutral-300 hover:bg-neutral-800"
          >
            Sources & methodology
          </Link>
        </div>

        <ul className="mt-10 grid gap-2 text-xs text-neutral-500 sm:grid-cols-2">
          <li>· Authentic AGC execution (yaAGC WebAssembly)</li>
          <li>· Luminary099 + Comanche055 rope images</li>
          <li>· DSKY driven by real I/O channels 010/011/013/0163</li>
          <li>· Erasable memory inspection</li>
          <li>· No fake lamps, no scripted register animation</li>
          <li>· GPL-licensed AGC subsystem, attribution preserved</li>
        </ul>
      </div>
    </main>
  );
}
