// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.d — monitor-mode dev panel.
//
// DIAGNOSTIC ONLY. `discrete-observer-v0` injects a small set of source-mapped
// avionics DISCRETES into CHAN 030/033 and observes CHAN 011/014 plus the
// THRUST output counter. It is NOT a powered-descent monitor: no landing
// radar, no PIPA increments, and no resolved throttle magnitude.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgcSession } from "@/agc/AgcSession";
import type { LmDiscreteSensorState } from "@/simulation/agcio/discreteEncoder";
import type { AgcMonitorProfile } from "@/simulation/agcio/types";
import {
  LR_RANGE_CADENCE_CITATIONS,
  LR_RANGE_FEET_PER_BIT,
  LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_LABEL,
  LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US,
  LR_RANGE_SCALE_CITATION,
} from "@/simulation/agcio/radarObserver";

const DEFAULT_AVIONICS: LmDiscreteSensorState = {
  engineArmed: false,
  autoThrottleEnabled: false,
  lgcInControl: false,
  issOperate: false,
  imuHealthy: false,
  imuCduHealthy: false,
  pipaHealthy: false,
  landingRadarStatus: "not-acquired",
  landingRadarAntenna: "transit",
  landingRadarRangeLowScale: false,
};


const oct = (v: number | null | undefined, digits = 5): string =>
  v === null || v === undefined ? "—" : `0${(v >>> 0).toString(8).padStart(digits, "0")}`;

export function MonitorPanel() {
  const { client, simReady, missionSnapshot, monitorBlocked, monitorTrace } = useAgcSession();
  const [avionics, setAvionics] = useState<LmDiscreteSensorState>(DEFAULT_AVIONICS);
  const [nextId, setNextId] = useState(1);

  const monitor = missionSnapshot?.monitor ?? null;
  const epoch = simReady?.simulationEpoch ?? 0;
  const supported = simReady?.supportedMonitorProfiles ?? [];

  const takeId = useCallback(() => {
    const id = nextId;
    setNextId((n) => n + 1);
    return id;
  }, [nextId]);

  // Publish the operator-declared avionics state whenever it changes; the
  // Worker never invents these values.
  useEffect(() => {
    if (!client || !simReady) return;
    client.setAvionicsState(Date.now() % 1_000_000, epoch, avionics);
  }, [client, simReady, epoch, avionics]);

  const requestProfile = (profile: AgcMonitorProfile) => {
    if (!client || !simReady) return;
    const cursor = missionSnapshot?.missionTimeUs ?? 0;
    client.setMonitorProfile(takeId(), epoch, cursor + 5_000_000, profile);
  };

  const requestTrace = () => {
    if (!client || !simReady) return;
    client.requestMonitorTrace(takeId(), epoch);
  };

  const toggle = (key: keyof LmDiscreteSensorState) => () =>
    setAvionics((a) => ({ ...a, [key]: !a[key as "engineArmed"] }));

  const traceRows = useMemo(
    () => (monitorTrace ? monitorTrace.events.slice(-24).reverse() : []),
    [monitorTrace],
  );

  const control = monitor?.commandedControl ?? null;

  return (
    <section
      aria-labelledby="mon-h"
      className="mt-4 rounded border border-amber-700/60 p-4"
      data-testid="monitor-panel"
    >
      <h2 id="mon-h" className="text-xs uppercase tracking-widest text-amber-400">
        AGC monitor mode (diagnostic)
      </h2>
      <p className="mt-2 rounded bg-amber-950/40 px-3 py-2 text-xs font-bold uppercase text-amber-300" data-testid="monitor-banner">
        DISCRETE INTERFACE DIAGNOSTIC ONLY
        <br />
        NOT A POWERED-DESCENT MONITOR
      </p>
      <p className="mt-2 rounded bg-amber-950/40 px-3 py-2 text-xs text-amber-300" data-testid="monitor-warning">
        AGC output is observed for diagnostics only and is never applied to
        the spacecraft. discrete-observer-v0 injects only
        source-mapped avionics discretes on CHAN 030/033 and observes CHAN
        011/014 and the THRUST output counter. Landing-radar and PIPA
        interfaces remain unresolved; DPS throttle magnitude is NOT derived.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1" data-testid="monitor-state">
        <span className="text-neutral-500">Profile</span>
        <span data-testid="mon-profile">{monitor?.profile ?? "off"}</span>
        <span className="text-neutral-500">Status</span>
        <span data-testid="mon-status">{monitor?.status ?? "off"}</span>
        <span className="text-neutral-500">Trace armed</span>
        <span data-testid="mon-trace-enabled">{String(monitor?.traceEnabled ?? false)}</span>
        <span className="text-neutral-500">Trace retained</span>
        <span data-testid="mon-trace-count">{monitor?.traceCount ?? 0}</span>
        <span className="text-neutral-500">Trace dropped</span>
        <span data-testid="mon-trace-dropped">{monitor?.traceDropped ?? 0}</span>
        <span className="text-neutral-500">Supported profiles</span>
        <span data-testid="mon-supported">{supported.join(", ") || "—"}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          data-testid="mon-enter-discrete"
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
          onClick={() => requestProfile("discrete-observer-v0")}
          disabled={!client || !simReady}
        >Enter discrete-observer-v0</button>
        <button
          data-testid="mon-enter-descent"
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
          onClick={() => requestProfile("descent-monitor-v1")}
          disabled={!client || !simReady}
        >Request descent-monitor-v1 (blocked)</button>
        <button
          data-testid="mon-enter-radar"
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
          onClick={() => requestProfile("landing-radar-observer-v1")}
          disabled={!client || !simReady}
        >Request landing-radar-observer-v1 (blocked)</button>
        <button
          data-testid="mon-exit"
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
          onClick={() => requestProfile("off")}
          disabled={!client || !simReady}
        >Monitor off</button>
        <button
          data-testid="mon-request-trace"
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-40"
          onClick={requestTrace}
          disabled={!client || !simReady}
        >Request trace window</button>
      </div>

      <h3 className="mt-4 text-xs uppercase tracking-widest text-neutral-500">
        Operator-declared avionics discretes
      </h3>
      <div className="mt-2 flex flex-wrap gap-2" data-testid="mon-avionics">
        {([
          "engineArmed",
          "autoThrottleEnabled",
          "lgcInControl",
          "issOperate",
          "imuHealthy",
          "imuCduHealthy",
          "pipaHealthy",
          "landingRadarRangeLowScale",
        ] as const).map((k) => (
          <button
            key={k}
            data-testid={`av-${k}`}
            className={`rounded border px-2 py-1 text-xs ${
              avionics[k] ? "border-emerald-600 text-emerald-400" : "border-neutral-700 text-neutral-400"
            }`}
            onClick={toggle(k)}
          >{k}: {String(avionics[k])}</button>
        ))}
        <span className="self-center text-xs text-neutral-500">
          LR status: {avionics.landingRadarStatus} (acquisition cannot be fabricated)
        </span>
      </div>

      <h3 className="mt-4 text-xs uppercase tracking-widest text-neutral-500">
        Owned input channels (host → AGC, octal)
      </h3>
      <ul className="mt-2 space-y-0.5 text-xs" data-testid="mon-input-channels">
        {(monitor?.inputChannels ?? []).map((c) => (
          <li key={c.channel} data-testid={`mon-in-ch${c.channel.toString(8).padStart(3, "0")}`}>
            CH{c.channel.toString(8).padStart(3, "0")} word {oct(c.word)} owned-mask{" "}
            {oct(c.ownedMask)} {c.seeded ? "(seeded)" : "(host-written)"}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs uppercase tracking-widest text-neutral-500">
        Decoded AGC outputs (observation only)
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1" data-testid="mon-outputs">
        <span className="text-neutral-500">Engine command (CHAN 011)</span>
        <span data-testid="mon-engine">{control?.engineCommand ?? "none"}</span>
        <span className="text-neutral-500">Thrust drive activity (CHAN 014)</span>
        <span data-testid="mon-thrust-drive">{String(control?.thrustDriveActivity ?? false)}</span>
        <span className="text-neutral-500">Throttle magnitude</span>
        <span data-testid="mon-throttle">
          {control?.throttleFraction ?? "null — PHYSICAL THROTTLE SCALE NOT YET RESOLVED"}
        </span>
        <span className="text-neutral-500">CHAN 014 / THRUST semantics</span>
        <span data-testid="mon-throttle-semantics" className="uppercase">
          LGC THROTTLE COMMAND DELTA INTO DECA SUMMING JUNCTION — NOT THRUST —
          PHYSICAL FORCE SCALE NOT RESOLVED
        </span>
      </div>

      <h3 className="mt-4 text-xs uppercase tracking-widest text-neutral-500">
        Landing-radar interface diagnostic
      </h3>
      <p
        className="mt-2 rounded bg-amber-950/40 px-3 py-2 text-xs font-bold uppercase text-amber-300"
        data-testid="radar-banner"
      >
        LANDING-RADAR INTERFACE DIAGNOSTIC
        <br />
        NOT A COMPLETE POWERED-DESCENT MONITOR
        <br />
        AGC OUTPUT OBSERVED ONLY
        <br />
        COMMAND NOT APPLIED TO SPACECRAFT
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs" data-testid="mon-radar">
        <span className="text-neutral-500">Profile state</span>
        <span data-testid="mon-radar-state">
          {monitor?.profile === "landing-radar-observer-v1"
            ? "active"
            : "blocked — radar-update-cadence-unresolved"}
        </span>
        <span className="text-neutral-500">RNRAD (0o46) representation</span>
        <span data-testid="mon-radar-representation">
          14-bit shift counter (mask 0o37777), 15 serial bits shifted, unsigned;
          out-of-range values are REFUSED, never wrapped
        </span>
        <span className="text-neutral-500">Range bit weight</span>
        <span data-testid="mon-radar-bit-weight">
          {LR_RANGE_FEET_PER_BIT} ft/bit ({LR_RANGE_SCALE_CITATION})
        </span>
        <span className="text-neutral-500">Range rate</span>
        <span>not displayed — beam/CHAN13 sequencing unresolved</span>
        <span className="text-neutral-500">Update cadence</span>
        <span data-testid="mon-radar-cadence">
          UNRESOLVED — AGC-solicited via CHAN13 ACTIVITY; not host-timed
        </span>
        <span className="text-neutral-500">Test fixture</span>
        <span data-testid="mon-radar-fixture">
          {LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US / 1000} ms —{" "}
          {LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_LABEL}
        </span>
        <span className="text-neutral-500">CHAN 033 merged word</span>
        <span data-testid="mon-radar-ch033">
          {oct(
            (monitor?.inputChannels ?? []).find((c) => c.channel === 0o33)?.word ??
              null,
          )}
        </span>
        <span className="text-neutral-500">RADARUPT</span>
        <span data-testid="mon-radar-radarupt">
          not requested — profile blocked (no partial transaction is applied)
        </span>
        <span className="text-neutral-500">Missing prerequisites</span>
        <span data-testid="mon-radar-prereq">
          PIPA ΔV pulse weight unresolved; CDU drain budget unproven; TTCA
          throttle bias unresolved
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-neutral-500" data-testid="mon-radar-citations">
        {LR_RANGE_CADENCE_CITATIONS.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>


      {monitorBlocked && (
        <div className="mt-4 rounded border border-red-800 p-3" data-testid="mon-blocked">
          <p className="text-xs uppercase tracking-widest text-red-400">
            Blocked: {monitorBlocked.requestedProfile}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-red-300">
            {monitorBlocked.reasons.map((r, i) => (
              <li key={i} data-testid="mon-block-reason">{r.code}: {r.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {monitorTrace && (
        <div className="mt-4" data-testid="mon-trace">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">
            Retained trace — {monitorTrace.retainedCount}/{monitorTrace.capacity}
            {" "}(worker dropped {monitorTrace.droppedCount}, wasm dropped {monitorTrace.wasmDroppedCount},
            {" "}wasm pending {monitorTrace.wasmPendingCount})
          </h3>
          <ul className="mt-2 space-y-0.5 text-xs">
            {traceRows.map((e) => (
              <li key={e.seq} data-testid="mon-trace-row">
                #{e.seq} t{e.missionTick}{" "}
                {e.kind === "sensor-channel"
                  ? `IN  CH${e.channel.toString(8).padStart(3, "0")} mask ${oct(e.mask)} val ${oct(e.value)} word ${oct(e.mergedWord)} [${e.mappingId}]`
                  : e.kind === "output-channel"
                    ? `OUT CH${e.channel.toString(8).padStart(3, "0")} ${oct(e.value)} (was ${oct(e.valueBefore)})`
                    : `CTR ${oct(e.address, 4)} op ${e.operation} Δ${e.delta} ${oct(e.valueBefore)}→${oct(e.valueAfter)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
