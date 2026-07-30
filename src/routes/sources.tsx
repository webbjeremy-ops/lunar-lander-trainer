import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ROPE_IMAGES, ropeById } from "@/sim/agc/roms";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "Sources & Methodology · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Attribution, licenses, live rope-image manifest with source/artifact/build-tool/reproduction provenance, and known limitations.",
      },
      { property: "og:title", content: "Sources & Methodology · AGC — Tranquility" },
      { property: "og:description", content: "Attribution and provenance for AGC — Tranquility." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SourcesPage,
});

interface RopeManifest {
  displayName?: string;
  agcProgram?: string;
  sourceProvenance?: { repository?: string; commit?: string; path?: string; notes?: string };
  buildToolProvenance?: { repository?: string; commit?: string; tool?: string; license?: string };
  artifactProvenance?: {
    file?: string;
    byteLength?: number;
    sha256?: string;
    origin?: string;
    buildCommand?: string | null;
    generatedAt?: string | null;
    notes?: string;
  };
  reproduction?: {
    status?: string;
    reproducedSha256?: string | null;
    reproducedByteLength?: number | null;
    byteIdentical?: boolean | null;
    reportUrl?: string | null;
    notes?: string;
  };
}

function ManifestBlock({ url }: { url: string }) {
  const q = useQuery<RopeManifest>({
    queryKey: ["rope-manifest", url],
    queryFn: async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    retry: false,
  });
  if (q.isLoading) return <div className="text-neutral-500">Loading manifest…</div>;
  if (q.error) return <div className="text-red-400">Manifest unavailable: {String(q.error)}</div>;
  const m = q.data ?? {};
  const kv = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-0.5">
      <span className="text-neutral-500">{k}</span>
      <span className="text-neutral-200 break-all">{v ?? "—"}</span>
    </div>
  );
  return (
    <div className="rounded border border-neutral-800 bg-black/40 p-3 font-mono text-[11px]">
      <div className="mb-1 text-neutral-400 uppercase tracking-widest">Source provenance</div>
      {kv("repository", m.sourceProvenance?.repository)}
      {kv("commit", m.sourceProvenance?.commit)}
      {kv("path", m.sourceProvenance?.path)}
      <div className="mt-2 mb-1 text-neutral-400 uppercase tracking-widest">Build-tool provenance</div>
      {kv("repository", m.buildToolProvenance?.repository)}
      {kv("commit", m.buildToolProvenance?.commit)}
      {kv("tool", m.buildToolProvenance?.tool)}
      {kv("license", m.buildToolProvenance?.license)}
      <div className="mt-2 mb-1 text-neutral-400 uppercase tracking-widest">Artifact provenance</div>
      {kv("file", m.artifactProvenance?.file)}
      {kv("byte length", m.artifactProvenance?.byteLength?.toLocaleString())}
      {kv("sha-256", m.artifactProvenance?.sha256)}
      {kv("origin", m.artifactProvenance?.origin)}
      {kv("build command", m.artifactProvenance?.buildCommand ?? "null")}
      {kv("generated at", m.artifactProvenance?.generatedAt ?? "null")}
      <div className="mt-2 mb-1 text-neutral-400 uppercase tracking-widest">Reproduction</div>
      {kv("status", m.reproduction?.status)}
      {kv("reproduced sha-256", m.reproduction?.reproducedSha256 ?? "null")}
      {kv("byte identical", String(m.reproduction?.byteIdentical ?? "null"))}
      {kv("report", m.reproduction?.reportUrl ?? "null")}
      {m.reproduction?.notes && <div className="mt-2 text-neutral-500">{m.reproduction.notes}</div>}
    </div>
  );
}

function SourcesPage() {
  const luminary = ropeById("Luminary099");
  return (
    <main className="min-h-screen bg-neutral-900 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
        <header>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-emerald-400">
            Sources & Methodology
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Where every historical bit comes from</h1>
          <p className="mt-2 text-neutral-400">
            Independent educational project. Not sponsored, approved, or endorsed by
            NASA, MIT, the Virtual AGC project, or any original Apollo contributor.
          </p>
        </header>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Emulator</h2>
          <p className="text-neutral-400">
            The Apollo Guidance Computer is emulated by a WebAssembly build of{" "}
            <a className="text-emerald-400" href="https://github.com/michaelfranzl/webAGC">webAGC</a>{" "}
            (© Michael Karl Franzl), which ports{" "}
            <a className="text-emerald-400" href="https://github.com/virtualagc/virtualagc">Virtual AGC</a>{" "}
            (yaAGC, © Ron Burkey and contributors). Both are licensed under{" "}
            <strong>GPL-2.0-or-later</strong>. Production loads the canonical
            extended runtime <code>yaAGC-ext.wasm</code> (HW-I/O v3 —
            <code> apollo-browser-hwio-v3</code>), a byte-parity-verified build
            of the pinned upstream <code>virtualagc @ ddc65e7be</code> source
            with the browser hardware-interface patch applied. It is
            behaviourally bit-identical to the frozen <code>yaAGC.wasm</code>{" "}
            across the P3 parity suite; the frozen artifact remains vendored
            solely as a parity reference. Full provenance and SHA-256 values
            live in <code>src/third-party/webagc/UPSTREAM.md</code>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Rope memory · Luminary099</h2>
          <p className="mb-2 text-neutral-400">
            The rope binary is served same-origin from <code>{luminary.url}</code>.
            The Worker fetches the manifest below at runtime, validates the byte
            length and SHA-256, and only then hands the bytes to the emulator.
          </p>
          <ManifestBlock url={luminary.manifestUrl} />
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Licensing</h2>
          <p className="text-neutral-400">
            Files vendored from webAGC/yaAGC retain their upstream{" "}
            <strong>GPL-2.0-or-later</strong> notices and attribution. New M1 project
            files (worker, worker client, mission clock, event log, checksum, UI
            components, routes) are <strong>GPL-3.0-or-later</strong>. The
            distributed combined application is GPL-3.0-or-later while every
            component notice is preserved.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">Cross-origin isolation</h2>
          <p className="text-neutral-400">
            The M1 runtime does not depend on <code>SharedArrayBuffer</code> or
            <code>Atomics</code>. The app functions fully when{" "}
            <code>crossOriginIsolated === false</code>. If your host does provide
            COOP/COEP headers, the runtime notices but does not require them.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">All rope images</h2>
          <ul className="space-y-1 text-neutral-400">
            {ROPE_IMAGES.map((r) => (
              <li key={r.id}>
                <code className="text-neutral-200">{r.id}</code> — <span className="text-neutral-500">{r.url}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
