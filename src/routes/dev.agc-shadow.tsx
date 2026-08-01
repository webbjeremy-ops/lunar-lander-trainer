// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — EXPERIMENTAL evidence panel for the reconstructed-PDI shadow run.
//
// This route is developer-only and deliberately unstyled-ish. It renders the
// recorded acceptance ledger produced by the real-WASM shadow experiment
// (src/simulation/agcshadow/__tests__/reconstructedPdiShadowWasm.test.ts).
//
// It has NO control path: it does not start an AGC, does not install a pad
// load, and cannot touch the physics kernel. It reports.

import { createFileRoute } from "@tanstack/react-router";
import {
  M4_6A_OBSERVED_RESULT,
  M4_6A_VERDICT,
  RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1,
  RECONSTRUCTED_VALUES,
  SHADOW_BANNER_LINES,
  SHADOW_MONITOR_FIELDS,
  SHADOW_PROFILE_IS_DEFAULT,
  THRUST_SEMANTICS_WARNING,
  UNRESOLVED_VALUES,
} from "@/simulation/agcshadow";

export const Route = createFileRoute("/dev/agc-shadow")({
  head: () => ({
    meta: [
      { title: "Luminary Shadow Evidence · AGC Tranquility (M4.6A)" },
      {
        name: "description",
        content:
          "Developer-only evidence panel for the reconstructed powered-descent-initiation shadow experiment against real Luminary 099.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AgcShadowEvidence,
});

const VERDICT_TONE: Record<string, string> = {
  PASS: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  PARTIAL: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  FAIL: "bg-red-500/15 text-red-300 border-red-500/40",
};

function Section(props: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="border border-border rounded-md p-4 space-y-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase">{props.title}</h2>
      {props.note ? <p className="text-xs text-muted-foreground">{props.note}</p> : null}
      {props.children}
    </section>
  );
}

function AgcShadowEvidence() {
  const evidence = M4_6A_OBSERVED_RESULT;
  const verdict = M4_6A_VERDICT;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6 font-mono text-sm">
      <header className="space-y-2">
        <h1 className="text-lg font-bold">
          M4.6A — Reconstructed PDI bootstrap &amp; Luminary shadow mode
        </h1>
        <div className="border border-amber-500/40 bg-amber-500/10 rounded-md p-3 space-y-1">
          {SHADOW_BANNER_LINES.map((line) => (
            <p key={line} className="text-xs font-semibold text-amber-300">
              {line}
            </p>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Experimental profile is default: {String(SHADOW_PROFILE_IS_DEFAULT)}. This page is a
          read-only ledger of the recorded real-WASM run; it starts nothing.
        </p>
      </header>

      <Section title="Verdict">
        <div
          className={`inline-block border rounded px-3 py-1 text-sm font-bold ${
            VERDICT_TONE[verdict.verdict]
          }`}
        >
          {verdict.verdict}
        </div>
        <p className="text-xs">{verdict.recommendation}</p>
        <p className="text-xs">
          M4.6B recommended: <strong>{String(verdict.recommendM4_6B)}</strong>
        </p>
        <ul className="space-y-1">
          {verdict.passCriteria.map((c) => (
            <li key={c.id} className="text-xs">
              <span className={c.met ? "text-emerald-400" : "text-red-400"}>
                {c.met ? "MET " : "NOT MET "}
              </span>
              {c.id}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Delivered vs consumed"
        note="Delivery is a host-side fact. Consumption is a rope-side fact. They are never conflated."
      >
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="py-1">PIPA pulses delivered (native PINC)</td>
              <td className="text-right">{evidence.delivery.pipaPulsesDelivered}</td>
            </tr>
            <tr>
              <td className="py-1">PIPA drain events observed</td>
              <td className="text-right">{evidence.consumption.pipaDrainEvents}</td>
            </tr>
            <tr>
              <td className="py-1">PIPA consumption</td>
              <td className="text-right font-bold">{evidence.consumption.pipa}</td>
            </tr>
            <tr>
              <td className="py-1">CHAN13 radar requests observed</td>
              <td className="text-right">{evidence.delivery.radarRequestsObserved}</td>
            </tr>
            <tr>
              <td className="py-1">Radar updates accepted by hardware</td>
              <td className="text-right">{evidence.delivery.radarUpdatesAccepted}</td>
            </tr>
            <tr>
              <td className="py-1">AVEGFLAG raised / Servicer running</td>
              <td className="text-right">
                {String(evidence.avegflagRaised)} / {String(evidence.servicerRunning)}
              </td>
            </tr>
            <tr>
              <td className="py-1">Navigation state (RN/VN) evolved</td>
              <td className="text-right">{String(evidence.navigationStateEvolved)}</td>
            </tr>
          </tbody>
        </table>
        <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
          {evidence.consumption.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Section
        title={`Experimental pad load — ${RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1.id}`}
        note="Applied atomically with compare-before-write, in P00 only, and invalidated by any AGC reset."
      >
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Symbol</th>
              <th className="text-left">Address</th>
              <th className="text-left">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1.records.map((r) => (
              <tr key={r.address}>
                <td className="py-1">{r.symbol}</td>
                <td>{r.addressOctal}</td>
                <td className="text-muted-foreground">{r.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Monitored rope observables" note={THRUST_SEMANTICS_WARNING}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Symbol</th>
              <th className="text-left">Confidence</th>
              <th className="text-left">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {SHADOW_MONITOR_FIELDS.map((f) => (
              <tr key={f.symbol}>
                <td className="py-1">{f.symbol}</td>
                <td>{f.confidence}</td>
                <td className="text-muted-foreground">{f.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Reconstructed values"
        note={`${RECONSTRUCTED_VALUES.length} declared, of which ${UNRESOLVED_VALUES.length} remain UNRESOLVED and are therefore never written to the rope.`}
      >
        <ul className="space-y-2 text-xs">
          {UNRESOLVED_VALUES.map((v) => (
            <li key={v.id}>
              <span className="font-bold">{v.id}</span> — {v.uncertainty}
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
