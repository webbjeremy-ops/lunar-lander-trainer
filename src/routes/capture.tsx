// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic capture harness. Same production Worker, protocol, decoder,
// and rope as /sim — no shortcuts. Exposes an inspection surface on
// window.__agcCapture so an out-of-band Playwright script can drive the DSKY
// and serialize the ordered channel-010 event trace to a golden fixture.
//
// This route intentionally has no visual chrome beyond a status readout so
// the fixture capture is not visually flaky.

import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AgcWorkerClient } from "@/agc/AgcWorkerClient";
import { agcWasmUrl, ropeById, type RopeImage } from "@/sim/agc/roms";
import type { AgcEvent, ChannelEventLite, ReadyPayload, StateSnapshot } from "@/agc/protocol";
import { PROTOCOL_VERSION } from "@/agc/protocol";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import { decodedDskyCanonical, makeEmptyDecodedDsky } from "@/agc/dsky/DskyDecoder";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "AGC — Tranquility · Capture Harness" },
      { name: "description", content: "Deterministic capture harness for AGC golden traces (M2.1)." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ClientOnly fallback={<div style={{ padding: 16, fontFamily: "monospace" }}>booting…</div>}>
      <CapturePage />
    </ClientOnly>
  ),
});

interface DecodedRecord {
  tickIndex: number;
  missionTimeUs: number;
  decoded: DecodedDsky;
  checksum: string;
}

interface CaptureLog {
  protocolVersion: number;
  ready: ReadyPayload | null;
  ch010Events: Array<Pick<ChannelEventLite, "eventId" | "tickIndex" | "missionTimeUs" | "value">>;
  allChannelEvents: ChannelEventLite[];
  commands: Array<{ tickIndex: number; missionTimeUs: number; kind: string; payload: unknown }>;
  decodedTimeline: DecodedRecord[];
  latestSnapshot: StateSnapshot | null;
  latestDecoded: DecodedDsky;
  latestTickIndex: number;
}

function CapturePage() {
  const [rope] = useState<RopeImage>(() => ropeById("Luminary099"));
  const [status, setStatus] = useState<string>("initializing");
  const clientRef = useRef<AgcWorkerClient | null>(null);
  const logRef = useRef<CaptureLog>({
    protocolVersion: PROTOCOL_VERSION,
    ready: null,
    ch010Events: [],
    allChannelEvents: [],
    commands: [],
    decodedTimeline: [],
    latestSnapshot: null,
    latestDecoded: makeEmptyDecodedDsky(),
    latestTickIndex: 0,
  });

  useEffect(() => {
    const client = new AgcWorkerClient();
    clientRef.current = client;
    const log = logRef.current;

    client.setListeners({
      onReady: (payload) => {
        log.ready = payload;
        setStatus("ready");
      },
      onEvent: (ev: AgcEvent) => {
        if (ev.type === "channelUpdate") {
          const lite = ev.payload;
          log.allChannelEvents.push(lite);
          if (lite.channel === 0o10) {
            log.ch010Events.push({
              eventId: lite.eventId,
              tickIndex: lite.tickIndex,
              missionTimeUs: lite.missionTimeUs,
              value: lite.value,
            });
          }
        }
      },
      onSnapshot: (snap) => {
        log.latestSnapshot = snap;
        log.latestTickIndex = snap.tickIndex;
      },
      onDskyDecoded: (decoded, missionTimeUs, tickIndex) => {
        // Deep-clone so the timeline is not mutated by later decoder updates.
        const cloned: DecodedDsky = JSON.parse(JSON.stringify(decoded));
        log.latestDecoded = cloned;
        log.decodedTimeline.push({
          tickIndex,
          missionTimeUs,
          decoded: cloned,
          checksum: decodedDskyCanonical(cloned),
        });
      },
      onFatalError: (code, message) => setStatus(`fatal:${code}:${message}`),
    });
    client.initialize(agcWasmUrl());
    client.loadRope(rope.id, rope.url, rope.manifestUrl);

    // Wrap post-commands so we record them with a Worker-confirmed tickIndex
    // as best we can (using the latest observed tick from snapshots).
    const wrap = <A extends unknown[]>(
      kind: string,
      fn: (...a: A) => void,
      payloadOf?: (...a: A) => unknown,
    ) =>
      (...args: A) => {
        log.commands.push({
          tickIndex: log.latestTickIndex,
          missionTimeUs: log.latestSnapshot?.missionTimeUs ?? 0,
          kind,
          payload: payloadOf ? payloadOf(...args) : args[0],
        });
        fn(...args);
      };

    const api = {
      getLog: () => log,
      getReady: () => log.ready,
      isReady: () => log.ready !== null,
      resume: wrap("resume", () => client.resume(), () => null),
      pause: wrap("pause", () => client.pause(), () => null),
      reset: () => {
        log.commands.push({
          tickIndex: log.latestTickIndex,
          missionTimeUs: log.latestSnapshot?.missionTimeUs ?? 0,
          kind: "reset",
          payload: null,
        });
        // Delimit fixture segments: clear the recorded ch010 trace/timeline
        // for the NEXT segment.
        log.ch010Events = [];
        log.decodedTimeline = [];
        client.reset();
      },
      dskyKeyDown: wrap("dskyKeyDown", (code: number) => client.dskyKeyDown(code), (code) => ({ keyCode: code })),
      requestSnapshot: () => client.requestSnapshot(),
      setTimeScale: wrap("setTimeScale", (s: number) => client.setTimeScale(s), (s) => ({ timeScale: s })),
      snapshotFixture: (label: string) => ({
        label,
        capturedAt: new Date().toISOString(),
        protocolVersion: PROTOCOL_VERSION,
        emulator: {
          repo: log.ready?.emulatorRepo,
          commit: log.ready?.emulatorCommit,
          versionString: log.ready?.emulatorVersionString,
        },
        wasmSha256: log.ready?.wasmSha256,
        rope: {
          id: log.ready?.ropeId,
          sha256: log.ready?.ropeSha256,
          sourceCommit: log.ready?.ropeSourceCommit,
          byteLength: log.ready?.ropeByteLength,
        },
        commands: log.commands,
        ch010Events: log.ch010Events,
        decodedTimeline: log.decodedTimeline,
        finalDecoded: log.latestDecoded,
        finalChecksum: decodedDskyCanonical(log.latestDecoded),
        finalSnapshot: log.latestSnapshot
          ? {
              tickIndex: log.latestSnapshot.tickIndex,
              missionTimeUs: log.latestSnapshot.missionTimeUs,
              lamps: log.latestSnapshot.lamps,
              running: log.latestSnapshot.running,
              timeScale: log.latestSnapshot.timeScale,
              erasableBase: log.latestSnapshot.erasableBase,
              erasableWindow: log.latestSnapshot.erasableWindow,
            }
          : null,
      }),
    };
    (window as unknown as { __agcCapture: typeof api }).__agcCapture = api;
    setStatus("harness-installed");

    return () => {
      client.dispose();
      clientRef.current = null;
      try { delete (window as unknown as { __agcCapture?: unknown }).__agcCapture; } catch { /* ignore */ }
    };
  }, [rope]);

  return (
    <main style={{ fontFamily: "monospace", color: "#e5e5e5", background: "#0a0a0a", minHeight: "100vh", padding: 16 }}>
      <h1 style={{ fontSize: 14 }} data-testid="capture-title">
        AGC Capture Harness (M2.1)
      </h1>
      <p data-testid="capture-status" style={{ fontSize: 12 }}>status: {status}</p>
      <p style={{ fontSize: 11, color: "#a3a3a3" }}>
        window.__agcCapture is installed; drive the AGC via Playwright.
      </p>
    </main>
  );
}
