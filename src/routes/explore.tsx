// SPDX-License-Identifier: GPL-3.0-or-later
// /explore — read-only inspection of the shared, persistent AGC session.
//
// This route MUST NOT create its own emulator instance, mutate the AGC, or
// interpose any physics/spacecraft/mission logic. It attaches to the same
// AgcWorkerClient owned by <AgcSessionProvider> in __root and displays:
//
//   1. DSKY mirror (visible + accessible), driven by the same decoded value
//      the shared session already publishes.
//   2. Mission clock (MET, tick index, wall-clock scale).
//   3. Provenance (emulator commit, rope SHA-256, protocol version,
//      canonical-init report, session epoch).
//   4. Channel table — raw octal, per-channel latest event id + tick.
//   5. Event timeline — recent channelUpdate + inputAccepted events, filterable.
//   6. Decoded DSKY state dump (registers + annunciators, human-readable).
//
// If the shared session is still booting (no `client` yet), the panels show
// their empty state — they never try to substitute a second worker.

import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAgcSession } from "@/agc/AgcSession";
import type {
  AgcEvent,
  ChannelEventLite,
  InputAcceptedEvent,
  StateSnapshot,
} from "@/agc/protocol";
import type { DecodedDsky, DskyRegister } from "@/agc/dsky/DskyTypes";
import { AGC_CHANNELS } from "@/sim/agc/AgcChannelRegistry";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore the AGC · AGC — Tranquility" },
      {
        name: "description",
        content:
          "Read-only inspection of the live Apollo Guidance Computer session: DSKY, channels, event timeline, and provenance.",
      },
    ],
  }),
  component: ExplorePage,
});

function ExplorePage() {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400">
              AGC · Tranquility
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Explore the live AGC session</h1>
            <p className="mt-1 text-xs text-neutral-500">
              Read-only inspection. Attached to the same Worker as /learn — no
              second emulator, no side effects.
            </p>
          </div>
          <nav className="flex gap-3 font-mono text-xs uppercase tracking-widest">
            <Link to="/" className="text-neutral-400 hover:text-neutral-100">Home</Link>
            <Link to="/learn" className="text-neutral-400 hover:text-neutral-100">Learn</Link>
            <Link to="/sim" className="text-neutral-400 hover:text-neutral-100">DSKY</Link>
            <Link to="/sources" className="text-neutral-400 hover:text-neutral-100">Sources</Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <ClientOnly
          fallback={
            <div className="rounded border border-neutral-800 bg-neutral-950/60 p-6 text-sm text-neutral-500">
              Attaching to shared AGC session…
            </div>
          }
        >
          <ExplorePanels />
        </ClientOnly>
      </div>
    </main>
  );
}

function ExplorePanels() {
  const session = useAgcSession();
  const { client, ready, snapshot, decoded, lamps, sessionEpoch, bootError } = session;

  // Collect a rolling event timeline. We prefer the Worker's own event id
  // (unique across inputs + channels) so the timeline can never disagree
  // with lesson evidence. Ring capped at 512.
  type Row =
    | { kind: "channel"; ev: ChannelEventLite }
    | { kind: "input"; ev: InputAcceptedEvent };
  const [rows, setRows] = useState<Row[]>([]);
  const [filterChannel, setFilterChannel] = useState<number | "all">("all");
  const [showInputs, setShowInputs] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!client) return;
    const unsub = client.addListener({
      onEvent: (msg: AgcEvent) => {
        if (paused) return;
        if (msg.type === "channelUpdate") {
          setRows((prev) => appendRow(prev, { kind: "channel", ev: msg.payload }));
        } else if (msg.type === "inputAccepted") {
          setRows((prev) => appendRow(prev, { kind: "input", ev: msg.payload }));
        }
      },
    });
    // Wipe timeline on session reset (epoch change re-runs this effect).
    return () => {
      unsub();
    };
  }, [client, paused, sessionEpoch]);

  useEffect(() => {
    // Fresh session = fresh timeline. Explicit so the dependency is honest.
    setRows([]);
  }, [sessionEpoch]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.kind === "input" && !showInputs) return false;
      if (r.kind === "channel" && filterChannel !== "all" && r.ev.channel !== filterChannel) return false;
      return true;
    });
  }, [rows, filterChannel, showInputs]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <SessionStatusCard
          hasClient={!!client}
          bootError={bootError}
          snapshot={snapshot}
          sessionEpoch={sessionEpoch}
        />
        <DskyMirrorCard decoded={decoded} lamps={lamps} />
        <EventTimelineCard
          rows={filteredRows}
          totalRows={rows.length}
          filterChannel={filterChannel}
          setFilterChannel={setFilterChannel}
          showInputs={showInputs}
          setShowInputs={setShowInputs}
          paused={paused}
          setPaused={setPaused}
        />
      </div>
      <div className="space-y-6">
        <ProvenanceCard ready={ready} snapshot={snapshot} sessionEpoch={sessionEpoch} />
        <ChannelTableCard snapshot={snapshot} />
        <DecodedDumpCard decoded={decoded} />
      </div>
    </div>
  );
}

function appendRow<T>(prev: T[], next: T): T[] {
  const arr = prev.length >= 512 ? prev.slice(prev.length - 511) : prev.slice();
  arr.push(next);
  return arr;
}

// ------------------------------- Panels -------------------------------------

function SessionStatusCard({
  hasClient,
  bootError,
  snapshot,
  sessionEpoch,
}: {
  hasClient: boolean;
  bootError: string | null;
  snapshot: StateSnapshot | null;
  sessionEpoch: number;
}) {
  const state = bootError
    ? { label: "ERROR", cls: "border-red-600 bg-red-950/40 text-red-300" }
    : !hasClient
      ? { label: "BOOTING", cls: "border-amber-600 bg-amber-950/40 text-amber-300" }
      : snapshot?.running
        ? { label: "RUNNING", cls: "border-emerald-600 bg-emerald-950/50 text-emerald-300" }
        : { label: "PAUSED", cls: "border-amber-500 bg-amber-950/40 text-amber-200" };
  return (
    <section
      data-testid="explore-status"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">
          Mission clock (shared session)
        </h2>
        <span
          data-testid="explore-phase"
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${state.cls}`}
        >
          {state.label} · epoch {sessionEpoch}
        </span>
      </div>
      {bootError && (
        <p className="mb-2 rounded border border-red-800 bg-red-950/40 px-2 py-1 font-mono text-[11px] text-red-300">
          {bootError}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 font-mono text-[11px] text-neutral-400 md:grid-cols-4">
        <Metric label="MET µs" value={snapshot?.missionTimeUs.toLocaleString() ?? "—"} testid="explore-met" />
        <Metric label="Tick" value={snapshot?.tickIndex.toLocaleString() ?? "—"} />
        <Metric label="AGC steps" value={snapshot?.totalAgcSteps.toLocaleString() ?? "—"} />
        <Metric label="Time scale" value={snapshot ? `${snapshot.timeScale}×` : "—"} />
        <Metric label="Latest eventId" value={snapshot?.latestEventId.toLocaleString() ?? "—"} />
        <Metric label="Channel events" value={snapshot?.channelEventCount.toLocaleString() ?? "—"} />
        <Metric label="Avg tick" value={snapshot ? `${snapshot.avgTickMs.toFixed(2)} ms` : "—"} />
        <Metric label="Overruns" value={snapshot?.schedulerOverruns.toLocaleString() ?? "—"} />
      </div>
    </section>
  );
}

function Metric({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div data-testid={testid} className="text-neutral-200">{value}</div>
    </div>
  );
}

function DskyMirrorCard({ decoded, lamps }: { decoded: DecodedDsky; lamps: number }) {
  return (
    <section
      data-testid="explore-dsky-mirror"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
        DSKY mirror (read-only)
      </h2>
      <div className="rounded border border-neutral-800 bg-black p-3">
        <div className="grid gap-1.5">
          <div className="flex gap-4">
            <MiniRegister label="PROG" reg={decoded.program} />
            <MiniRegister label="VERB" reg={decoded.verb} />
            <MiniRegister label="NOUN" reg={decoded.noun} />
          </div>
          <MiniRegister label="R1" reg={decoded.r1} />
          <MiniRegister label="R2" reg={decoded.r2} />
          <MiniRegister label="R3" reg={decoded.r3} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 md:grid-cols-5">
        {Object.entries(decoded.annunciators).map(([name, on]) => (
          <div
            key={name}
            className={
              "rounded border px-2 py-1 text-center text-[10px] font-mono uppercase tracking-wider " +
              (on
                ? "border-amber-500 bg-amber-500/20 text-amber-200"
                : "border-neutral-800 bg-neutral-900 text-neutral-600")
            }
          >
            {name.replace(/_/g, " ")}
          </div>
        ))}
      </div>
      <div className="mt-2 font-mono text-[10px] text-neutral-500">
        lamps bitmask: 0b{lamps.toString(2).padStart(11, "0")} · 0o{lamps.toString(8)}
      </div>
    </section>
  );
}

function MiniRegister({ label, reg }: { label: string; reg: DskyRegister }) {
  const sign = reg.sign?.plus && reg.sign?.minus ? "±" : reg.sign?.plus ? "+" : reg.sign?.minus ? "−" : reg.sign ? "·" : "";
  const digits = reg.digits.map((d) => (d.value === null ? "_" : String(d.value))).join("");
  return (
    <div className="flex items-center gap-1 font-mono">
      <span className="w-10 text-right text-[10px] uppercase tracking-widest text-neutral-500">{label}</span>
      {reg.sign && <span className="w-3 text-center text-emerald-300">{sign || "·"}</span>}
      <span className="text-lg text-emerald-300">{digits}</span>
    </div>
  );
}

function ProvenanceCard({
  ready,
  snapshot,
  sessionEpoch,
}: {
  ready: ReturnType<typeof useAgcSession>["ready"];
  snapshot: StateSnapshot | null;
  sessionEpoch: number;
}) {
  return (
    <section
      data-testid="explore-provenance"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4 text-[11px] text-neutral-400"
    >
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
        Provenance
      </h2>
      {!ready ? (
        <p className="text-neutral-500">Waiting for `ready` from the Worker…</p>
      ) : (
        <dl className="grid gap-1 font-mono">
          <Row k="emulator repo" v={ready.emulatorRepo} />
          <Row k="emulator commit" v={ready.emulatorCommit} />
          <Row k="emulator version" v={ready.emulatorVersionString || "—"} />
          <Row k="rope id" v={ready.ropeId} />
          <Row k="rope bytes" v={ready.ropeByteLength.toLocaleString()} />
          <Row k="rope source commit" v={ready.ropeSourceCommit || "—"} />
          <Row k="rope SHA-256" v={ready.ropeSha256} />
          <Row k="wasm SHA-256" v={ready.wasmSha256} />
          <Row k="protocol" v={String(ready.protocolVersion)} />
          <Row k="session epoch" v={String(sessionEpoch)} />
          <Row k="cpu resets" v={String(ready.resetCount)} />
          <Row
            k="canonical init"
            v={ready.canonicalInit
              ? `settled@tick ${ready.canonicalInit.settledAtTick}, RSET ${ready.canonicalInit.startupRsetAccepted ? "ok" : "no"}`
              : "—"}
          />
          <Row k="snapshot version" v={snapshot ? String(snapshot.version) : "—"} />
        </dl>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right text-neutral-200 break-all">{v}</dd>
    </div>
  );
}

function ChannelTableCard({ snapshot }: { snapshot: StateSnapshot | null }) {
  const channels = snapshot?.channels ?? {};
  const keys = Object.keys(channels).map((k) => Number(k)).sort((a, b) => a - b);
  return (
    <section
      data-testid="explore-channels"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
        AGC channels
      </h2>
      {keys.length === 0 ? (
        <p className="text-[11px] text-neutral-500">No channel state yet.</p>
      ) : (
        <table className="w-full font-mono text-[11px]">
          <thead className="text-neutral-500">
            <tr>
              <th className="text-left">CH</th>
              <th className="text-left">octal</th>
              <th className="text-left">binary</th>
              <th className="text-left">dir</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {keys.map((ch) => {
              const v = channels[ch] ?? 0;
              const doc = AGC_CHANNELS.find((d) => d.channel === ch);
              return (
                <tr key={ch} className="border-t border-neutral-900">
                  <td>0{ch.toString(8)}</td>
                  <td className="text-emerald-400">0{v.toString(8).padStart(5, "0")}</td>
                  <td className="text-neutral-500">{v.toString(2).padStart(15, "0")}</td>
                  <td className="text-neutral-500">{doc?.direction ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DecodedDumpCard({ decoded }: { decoded: DecodedDsky }) {
  const dump = {
    program: registerToText(decoded.program),
    verb: registerToText(decoded.verb),
    noun: registerToText(decoded.noun),
    r1: registerToText(decoded.r1),
    r2: registerToText(decoded.r2),
    r3: registerToText(decoded.r3),
    annunciators: Object.entries(decoded.annunciators)
      .filter(([, v]) => v)
      .map(([k]) => k),
  };
  return (
    <section
      data-testid="explore-decoded"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500">
        Decoded DSKY
      </h2>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-neutral-300">
        {JSON.stringify(dump, null, 2)}
      </pre>
    </section>
  );
}

function registerToText(r: DskyRegister): string {
  const sign = r.sign?.plus && r.sign?.minus ? "±" : r.sign?.plus ? "+" : r.sign?.minus ? "-" : r.sign ? " " : "";
  const digits = r.digits.map((d) => (d.value === null ? "_" : String(d.value))).join("");
  return `${sign}${digits}`;
}

// ------------------------------ Event timeline ------------------------------

function EventTimelineCard({
  rows,
  totalRows,
  filterChannel,
  setFilterChannel,
  showInputs,
  setShowInputs,
  paused,
  setPaused,
}: {
  rows: ({ kind: "channel"; ev: ChannelEventLite } | { kind: "input"; ev: InputAcceptedEvent })[];
  totalRows: number;
  filterChannel: number | "all";
  setFilterChannel: (v: number | "all") => void;
  showInputs: boolean;
  setShowInputs: (v: boolean) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
}) {
  const channelOptions = useMemo(() => {
    const seen = new Set<number>();
    for (const r of rows) if (r.kind === "channel") seen.add(r.ev.channel);
    return Array.from(seen).sort((a, b) => a - b);
  }, [rows]);
  return (
    <section
      data-testid="explore-timeline"
      className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-mono text-[11px] uppercase tracking-widest text-neutral-500">
          Event timeline ({rows.length}/{totalRows})
        </h2>
        <label className="flex items-center gap-1 font-mono text-[10px] text-neutral-400">
          <input
            type="checkbox"
            checked={showInputs}
            onChange={(e) => setShowInputs(e.target.checked)}
          />
          inputs
        </label>
        <select
          value={filterChannel === "all" ? "all" : String(filterChannel)}
          onChange={(e) => setFilterChannel(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-[10px] text-neutral-200"
          data-testid="explore-timeline-filter"
        >
          <option value="all">all channels</option>
          {channelOptions.map((c) => (
            <option key={c} value={c}>0{c.toString(8)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-200 hover:bg-neutral-800"
        >
          {paused ? "resume" : "pause"}
        </button>
      </div>
      <div className="max-h-96 overflow-auto rounded border border-neutral-900 bg-black/40 p-2 font-mono text-[10px]">
        {rows.length === 0 ? (
          <div className="text-neutral-600">No events yet.</div>
        ) : (
          rows
            .slice()
            .reverse()
            .map((r, i) =>
              r.kind === "channel" ? (
                <div key={`c-${r.ev.eventId}-${i}`} className="text-neutral-400">
                  <span className="text-neutral-600">#{r.ev.eventId.toString().padStart(6, "0")}</span>{" "}
                  <span className="text-neutral-500">t{r.ev.tickIndex}</span>{" "}
                  <span className="text-emerald-300">CH 0{r.ev.channel.toString(8)}</span>{" "}
                  ← 0{r.ev.value.toString(8).padStart(5, "0")}
                </div>
              ) : (
                <div key={`i-${r.ev.eventId}-${i}`} className="text-amber-300">
                  <span className="text-neutral-600">#{r.ev.eventId.toString().padStart(6, "0")}</span>{" "}
                  <span className="text-neutral-500">t{r.ev.tickIndex}</span>{" "}
                  <span>INPUT {r.ev.kind}</span>
                  {r.ev.keyCode !== undefined && <> keyCode=0o{r.ev.keyCode.toString(8)}</>}
                  {r.ev.pressed !== undefined && <> pressed={String(r.ev.pressed)}</>}
                </div>
              ),
            )
        )}
      </div>
    </section>
  );
}
