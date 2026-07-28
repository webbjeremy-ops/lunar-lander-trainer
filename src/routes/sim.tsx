import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Dsky, LampTestButton } from "@/ui/dsky/Dsky";
import { DiagnosticsPanel } from "@/ui/diagnostics/DiagnosticsPanel";
import { ROPE_IMAGES, ropeById, type RopeImage } from "@/sim/agc/roms";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type { ReadyPayload, StateSnapshot } from "@/agc/protocol";

export const Route = createFileRoute("/sim")({
  head: () => ({
    meta: [
      { title: "AGC — Tranquility · Worker-hosted AGC (M1)" },
      {
        name: "description",
        content:
          "Real Apollo Guidance Computer (yaAGC/webAGC) running Luminary099 in a dedicated Worker with deterministic mission time. Snapshots throttled to 25 real-time Hz.",
      },
      { property: "og:title", content: "AGC — Tranquility · Milestone 1" },
      { property: "og:description", content: "Worker-hosted AGC with deterministic mission clock." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SimPage,
});

function SimPage() {
  const [ropeId, setRopeId] = useState<RopeImage["id"]>("Luminary099");
  const rope = ropeById(ropeId);
  const [client, setClient] = useState<AgcWorkerClient | null>(null);
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [ready, setReady] = useState<ReadyPayload | null>(null);

  const onClient = useCallback((c: AgcWorkerClient | null) => setClient(c), []);
  const onSnapshot = useCallback((s: StateSnapshot) => setSnapshot(s), []);
  const onReady = useCallback((r: ReadyPayload) => setReady(r), []);

  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          AGC — Tranquility · Milestone 1 · Worker-hosted AGC
        </h1>
        <p className="mt-1 text-xs text-neutral-400">
          AGC now runs inside a dedicated Web Worker behind a typed protocol.
          Mission time advances in fixed 20&nbsp;ms ticks; state snapshots are
          throttled to ~25&nbsp;Hz real time regardless of acceleration.{" "}
          <Link className="text-emerald-400" to="/about">About &amp; credits</Link> ·{" "}
          <Link className="text-emerald-400" to="/sources">Sources & methodology</Link>.
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

        <ClientOnly fallback={<div className="text-xs text-neutral-500">Booting AGC worker…</div>}>
          <Dsky
            key={rope.id}
            rope={rope}
            onClient={onClient}
            onSnapshot={onSnapshot}
            onReady={onReady}
          />
          <DiagnosticsPanel client={client} ready={ready} snapshot={snapshot} />
        </ClientOnly>

        <p className="text-[10px] text-neutral-600">
          yaAGC © Ron Burkey and contributors — GPL-2.0-or-later. Rope images from{" "}
          <a className="text-emerald-400" href="https://github.com/chrislgarry/Apollo-11" target="_blank" rel="noreferrer">chrislgarry/Apollo-11</a>{" "}
          (NASA-authored, public domain). Distributed application is GPL-3.0-or-later.
          Not endorsed by NASA.
        </p>
      </section>
    </main>
  );
}
