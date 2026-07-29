// SPDX-License-Identifier: GPL-3.0-or-later
//
// /dev/mission-runtime — M3.2 dev harness.
//
// Read-only view of the shared AGC session's MissionRuntime, plus a small
// panel that enqueues canonical MissionCommands (start the golden scenario,
// nudge throttle, reset). Uses the SAME AgcWorkerClient the rest of the app
// holds — there is no second Worker and no independent emulator state.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgcSession } from "@/agc/AgcSession";
import { GOLDEN_MISSION_SCENARIO } from "@/simulation/runtime/scenarios";
import type { MissionCommand } from "@/simulation/runtime/types";

export const Route = createFileRoute("/dev/mission-runtime")({
  head: () => ({
    meta: [
      { title: "AGC — Mission runtime (dev)" },
      { name: "description", content: "Read-only view of the M3.2 deterministic mission runtime hosted inside the shared AGC Worker." },
      { property: "og:title", content: "AGC — Mission runtime (dev)" },
      { property: "og:description", content: "Read-only mission-runtime harness." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevMissionRuntimePage,
});

function DevMissionRuntimePage() {
  const session = useAgcSession();
  const { client, simReady, missionSnapshot, missionAcks, terminalTouchdown } = session;
  const [nextCmdId, setNextCmdId] = useState(1);

  // Ask the worker for a sim:ready reply on mount so a late-attaching
  // consumer (route mounted after the initial sim:ready fanout) still
  // gets the current runtime status. Idempotent on the worker side.
  useEffect(() => {
    if (!client) return;
    client.queryMissionReady();
    client.forceMissionSnapshot();
  }, [client]);

  const cursorUs = missionSnapshot?.missionTimeUs ?? 0;
  // Safety margin for applyAtMissionTimeUs. Snapshots are coalesced on the
  // Worker side (typically <100 ms stale) but the runtime cursor advances
  // one 20 000 µs tick every physical millisecond of real time under the
  // default schedule. 5 seconds is comfortably larger than any observed
  // snapshot staleness in the full Playwright suite and still small enough
  // that startScenario visibly transitions status within a second.
  const APPLY_AT_MARGIN_US = 5_000_000;

  const enqueue = useCallback((build: (id: number, epoch: number, cursorUs: number) => MissionCommand | null) => {
    if (!client || !simReady) return;
    const id = nextCmdId;
    setNextCmdId((n) => n + 1);
    const cmd = build(id, simReady.simulationEpoch, cursorUs);
    if (cmd) client.enqueueMissionCommand(cmd);
  }, [client, simReady, cursorUs, nextCmdId]);

  const canOperate = Boolean(client && simReady && missionSnapshot);
  const running = missionSnapshot?.status === "running";
  const interlocked = missionSnapshot?.status === "interlocked";

  const startGolden = () => enqueue((id, epoch, cur) => ({
    type: "startScenario",
    commandId: id,
    simulationEpoch: epoch,
    applyAtMissionTimeUs: cur + APPLY_AT_MARGIN_US,
    scenario: GOLDEN_MISSION_SCENARIO,
  }));

  const throttleTo = (throttle: number) => enqueue((id, epoch, cur) => ({
    type: "setControl",
    commandId: id,
    simulationEpoch: epoch,
    applyAtMissionTimeUs: cur + APPLY_AT_MARGIN_US,
    throttle,
  }));

  const resetScenario = () => enqueue((id, epoch, cur) => ({
    type: "resetScenario",
    commandId: id,
    simulationEpoch: epoch,
    applyAtMissionTimeUs: cur + APPLY_AT_MARGIN_US,
  }));

  const recentAcks = useMemo(() => missionAcks.slice(-8).reverse(), [missionAcks]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100 font-mono text-sm">
      <h1 className="text-lg font-semibold tracking-wide">Mission runtime — dev harness</h1>
      <p className="mt-1 text-xs text-neutral-500">
        Read-only view of the shared AGC session's MissionRuntime. All
        commands post through the same AgcWorkerClient the rest of the app
        holds — there is no second Worker.
      </p>

      <section aria-labelledby="mr-ready" className="mt-6 rounded border border-neutral-800 p-4">
        <h2 id="mr-ready" className="text-xs uppercase tracking-widest text-neutral-500">Sim ready</h2>
        {simReady ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1" data-testid="sim-ready">
            <dt className="text-neutral-500">Protocol</dt><dd data-testid="sim-protocol">{simReady.simulationProtocolVersion}</dd>
            <dt className="text-neutral-500">Epoch</dt><dd data-testid="sim-epoch">{simReady.simulationEpoch}</dd>
            <dt className="text-neutral-500">Tick µs</dt><dd data-testid="sim-tick-us">{simReady.missionTickUs}</dd>
            <dt className="text-neutral-500">Status</dt><dd data-testid="sim-status">{simReady.status}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-neutral-500" data-testid="sim-ready-pending">Awaiting sim:ready…</p>
        )}
      </section>

      <section aria-labelledby="mr-snapshot" className="mt-4 rounded border border-neutral-800 p-4">
        <h2 id="mr-snapshot" className="text-xs uppercase tracking-widest text-neutral-500">Latest snapshot</h2>
        {missionSnapshot ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1" data-testid="mission-snapshot">
            <dt className="text-neutral-500">Sequence</dt><dd data-testid="ms-sequence">{missionSnapshot.sequence}</dd>
            <dt className="text-neutral-500">Mission tick</dt><dd data-testid="ms-tick">{missionSnapshot.missionTick}</dd>
            <dt className="text-neutral-500">Mission time (µs)</dt><dd data-testid="ms-time-us">{missionSnapshot.missionTimeUs}</dd>
            <dt className="text-neutral-500">Clock paused</dt><dd data-testid="ms-clock-paused">{String(missionSnapshot.clockPaused)}</dd>
            <dt className="text-neutral-500">Status</dt><dd data-testid="ms-status">{missionSnapshot.status}</dd>
            <dt className="text-neutral-500">Interlock reason</dt><dd data-testid="ms-interlock">{missionSnapshot.interlockReason ?? "—"}</dd>
            <dt className="text-neutral-500">Scenario elapsed (µs)</dt><dd data-testid="ms-elapsed">{missionSnapshot.scenarioElapsedUs}</dd>
            <dt className="text-neutral-500">Altitude (m)</dt><dd data-testid="ms-alt">{missionSnapshot.lm?.altitudeM.toFixed(3) ?? "—"}</dd>
            <dt className="text-neutral-500">Vertical vel (m/s)</dt><dd data-testid="ms-vv">{missionSnapshot.lm?.verticalVelocityMps.toFixed(3) ?? "—"}</dd>
            <dt className="text-neutral-500">Propellant (kg)</dt><dd data-testid="ms-mass">{missionSnapshot.lm?.propellantMassKg.toFixed(3) ?? "—"}</dd>
            <dt className="text-neutral-500">Throttle</dt><dd data-testid="ms-throttle">{missionSnapshot.control.throttle.toFixed(3)}</dd>
            <dt className="text-neutral-500">Engine</dt><dd data-testid="ms-engine">{String(missionSnapshot.control.engineEnabled)}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-neutral-500" data-testid="ms-pending">No snapshot yet.</p>
        )}
      </section>

      <section aria-labelledby="mr-commands" className="mt-4 rounded border border-neutral-800 p-4">
        <h2 id="mr-commands" className="text-xs uppercase tracking-widest text-neutral-500">Commands</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            data-testid="cmd-start-golden"
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
            onClick={startGolden}
            disabled={!canOperate || running}
          >Start golden scenario</button>
          <button
            data-testid="cmd-throttle-full"
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
            onClick={() => throttleTo(1)}
            disabled={!canOperate || !running}
          >Throttle 1.00</button>
          <button
            data-testid="cmd-throttle-idle"
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
            onClick={() => throttleTo(0.1)}
            disabled={!canOperate || !running}
          >Throttle 0.10</button>
          <button
            data-testid="cmd-reset-scenario"
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
            onClick={resetScenario}
            disabled={!canOperate}
          >Reset scenario</button>
        </div>
        {interlocked && (
          <p className="mt-3 text-amber-400" data-testid="interlock-hint">
            Runtime interlocked (AGC reset while scenario running). Only
            <code className="ml-1">resetScenario</code> is accepted until cleared.
          </p>
        )}
      </section>

      <section aria-labelledby="mr-acks" className="mt-4 rounded border border-neutral-800 p-4">
        <h2 id="mr-acks" className="text-xs uppercase tracking-widest text-neutral-500">Recent command acks</h2>
        {recentAcks.length === 0 ? (
          <p className="mt-2 text-neutral-500">No acks yet.</p>
        ) : (
          <ul className="mt-2 space-y-1" data-testid="mission-acks">
            {recentAcks.map((ack, i) => (
              <li key={`${ack.commandId}-${i}`} className={ack.accepted ? "text-emerald-400" : "text-red-400"}>
                {ack.accepted
                  ? `#${ack.commandId} accepted`
                  : `#${ack.commandId} rejected (${ack.reason}): ${ack.message}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {terminalTouchdown && (
        <section aria-labelledby="mr-terminal" className="mt-4 rounded border border-neutral-800 p-4">
          <h2 id="mr-terminal" className="text-xs uppercase tracking-widest text-neutral-500">Terminal touchdown</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1" data-testid="terminal-touchdown">
            <dt className="text-neutral-500">Scenario</dt><dd>{terminalTouchdown.scenarioId}</dd>
            <dt className="text-neutral-500">Classification</dt><dd data-testid="td-class">{terminalTouchdown.touchdown.classification}</dd>
            <dt className="text-neutral-500">Impact vel (m/s)</dt><dd>{terminalTouchdown.touchdown.verticalVelocityMps.toFixed(4)}</dd>
            <dt className="text-neutral-500">Mission time (µs)</dt><dd>{terminalTouchdown.missionTimeUs}</dd>
          </dl>
        </section>
      )}
    </main>
  );
}
