// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from "react";
import type { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import type { Diagnostics, ReadyPayload, StateSnapshot } from "@/agc/protocol";

export function DiagnosticsPanel({
  client,
  ready,
  snapshot,
}: {
  client: AgcWorkerClient | null;
  ready: ReadyPayload | null;
  snapshot: StateSnapshot | null;
}) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const t = setInterval(() => {
      client.requestDiagnostics().then((d) => { if (!cancelled) setDiag(d); }).catch(() => {});
    }, 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [client]);

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-neutral-900 py-0.5">
      <span className="text-neutral-500">{k}</span>
      <span className="text-neutral-200">{v}</span>
    </div>
  );

  return (
    <details className="mt-4 rounded border border-neutral-800 bg-black/40 p-3 font-mono text-[11px] text-neutral-400" data-testid="diagnostics-panel">
      <summary className="cursor-pointer text-neutral-300 uppercase tracking-widest">Diagnostics</summary>
      <div className="mt-2 space-y-0.5">
        {row("protocol version", ready?.protocolVersion ?? "—")}
        {row("emulator repo", ready?.emulatorRepo ?? "—")}
        {row("emulator commit", ready?.emulatorCommit ?? "—")}
        {row("emulator version string", ready?.emulatorVersionString || "—")}
        {row("wasm sha256", ready?.wasmSha256?.slice(0, 24) ?? "—")}
        {row("hw-i/o version", ready?.extensionIdentity?.hwioVersion ?? diag?.extensionIdentity?.hwioVersion ?? "—")}
        {row("ext version", ready?.extensionIdentity?.extVersion || diag?.extensionIdentity?.extVersion || "—")}
        {row("ext tag", ready?.extensionIdentity?.extensionTag || diag?.extensionIdentity?.extensionTag || "—")}
        {row("trace enabled", String(ready?.extensionIdentity?.traceEnabled ?? diag?.extensionIdentity?.traceEnabled ?? "—"))}
        {row("trace dropped", String(ready?.extensionIdentity?.traceDropped ?? diag?.extensionIdentity?.traceDropped ?? "—"))}
        {row("rope", ready?.ropeId ?? "—")}
        {row("rope source commit", ready?.ropeSourceCommit?.slice(0, 12) ?? "—")}
        {row("rope sha256", ready?.ropeSha256?.slice(0, 24) ?? "—")}
        {row("mission time (µs)", snapshot?.missionTimeUs ?? "—")}
        {row("time scale", `${snapshot?.timeScale ?? "—"}×`)}
        {row("running", snapshot?.running ? "yes" : "no")}
        {row("total AGC steps", snapshot?.totalAgcSteps?.toLocaleString() ?? "—")}
        {row("timing remainder (ns)", snapshot?.timingRemainderNs ?? "—")}
        {row("avg tick (ms)", diag?.avgTickMs?.toFixed(3) ?? "—")}
        {row("max tick (ms)", diag?.maxTickMs?.toFixed(3) ?? "—")}
        {row("scheduler overruns", diag?.schedulerOverruns ?? "—")}
        {row("ticks executed", diag?.ticksExecuted ?? "—")}
        {row("worker state", diag?.workerState ?? "—")}
        {row("crossOriginIsolated", String(diag?.crossOriginIsolated ?? "—"))}
        {row("audio", "disabled (M1)")}
        {row("last error", diag?.lastError ?? "—")}
      </div>
    </details>
  );
}
