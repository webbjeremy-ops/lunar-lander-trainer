// SPDX-License-Identifier: GPL-3.0-or-later
//
// M5.0 — Versioned orbital-operations trace: deterministic log, canonical
// serialization, FNV-1a checksum, and a defensive importer.
//
// The trace records inputs only. Replaying the inputs through the pure runtime
// reproduces the LM state, the target state and the score bit-for-bit. No
// executable payload is ever stored, and the importer bounds every field.

import type { BurnDirection, ManeuverNode } from "./types";

export const ORBIT_TRACE_VERSION = 1;
export const MAX_TRACE_EVENTS = 20_000;

export type OrbitTraceEvent =
  | { readonly t: number; readonly kind: "scenario-start"; readonly scenarioId: string; readonly scenarioVersion: number; readonly assistance: string }
  | { readonly t: number; readonly kind: "time-scale"; readonly scale: number }
  | { readonly t: number; readonly kind: "node-set"; readonly ignitionTimeUs: number; readonly direction: BurnDirection; readonly deltaVMps: number }
  | { readonly t: number; readonly kind: "node-clear" }
  | { readonly t: number; readonly kind: "burn-start" }
  | { readonly t: number; readonly kind: "burn-stop" }
  | { readonly t: number; readonly kind: "attitude"; readonly command: number }
  | { readonly t: number; readonly kind: "objective"; readonly objectiveId: string; readonly met: boolean }
  | { readonly t: number; readonly kind: "terminal"; readonly outcome: string };

export interface OrbitTrace {
  readonly version: number;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly events: readonly OrbitTraceEvent[];
}

export function createOrbitTrace(
  scenarioId: string,
  scenarioVersion: number,
  assistance: string,
): OrbitTrace {
  return {
    version: ORBIT_TRACE_VERSION,
    scenarioId,
    scenarioVersion,
    events: [
      { t: 0, kind: "scenario-start", scenarioId, scenarioVersion, assistance },
    ],
  };
}

export function appendTraceEvent(
  trace: Readonly<OrbitTrace>,
  event: OrbitTraceEvent,
): OrbitTrace {
  if (trace.events.length >= MAX_TRACE_EVENTS) return trace;
  return { ...trace, events: [...trace.events, event] };
}

export function nodeEvent(t: number, node: ManeuverNode): OrbitTraceEvent {
  return {
    t,
    kind: "node-set",
    ignitionTimeUs: node.ignitionTimeUs,
    direction: node.direction,
    deltaVMps: node.deltaVMps,
  };
}

/** Canonical, key-ordered JSON. Stable across engines and runs. */
export function canonicalizeTrace(trace: Readonly<OrbitTrace>): string {
  const events = trace.events.map((e) => {
    const base: Record<string, unknown> = { t: e.t, kind: e.kind };
    for (const key of Object.keys(e).sort()) {
      if (key === "t" || key === "kind") continue;
      base[key] = (e as unknown as Record<string, unknown>)[key];
    }
    return base;
  });
  return JSON.stringify({
    version: trace.version,
    scenarioId: trace.scenarioId,
    scenarioVersion: trace.scenarioVersion,
    events,
  });
}

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function traceChecksum(trace: Readonly<OrbitTrace>): number {
  return fnv1a32(canonicalizeTrace(trace));
}

export function serializeTrace(trace: Readonly<OrbitTrace>): string {
  return JSON.stringify({
    ...JSON.parse(canonicalizeTrace(trace)),
    checksum: traceChecksum(trace),
  });
}

export type TraceImportError =
  | "not-json"
  | "not-object"
  | "version-mismatch"
  | "too-large"
  | "malformed-events"
  | "checksum-mismatch";

export interface TraceImportResult {
  readonly ok: boolean;
  readonly trace: OrbitTrace | null;
  readonly error: TraceImportError | null;
}

const DIRECTIONS = new Set<string>([
  "prograde",
  "retrograde",
  "radial-out",
  "radial-in",
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Defensive import. Never throws, never evaluates anything from the payload. */
export function importTrace(raw: string): TraceImportResult {
  if (typeof raw !== "string" || raw.length > 4_000_000) {
    return { ok: false, trace: null, error: "too-large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, trace: null, error: "not-json" };
  }
  if (!isObj(parsed)) return { ok: false, trace: null, error: "not-object" };
  if (parsed["version"] !== ORBIT_TRACE_VERSION) {
    return { ok: false, trace: null, error: "version-mismatch" };
  }
  const scenarioId = parsed["scenarioId"];
  const scenarioVersion = parsed["scenarioVersion"];
  const rawEvents = parsed["events"];
  if (typeof scenarioId !== "string" || !finite(scenarioVersion)) {
    return { ok: false, trace: null, error: "not-object" };
  }
  if (!Array.isArray(rawEvents) || rawEvents.length > MAX_TRACE_EVENTS) {
    return { ok: false, trace: null, error: "too-large" };
  }

  const events: OrbitTraceEvent[] = [];
  for (const e of rawEvents) {
    if (!isObj(e) || !finite(e["t"]) || typeof e["kind"] !== "string") {
      return { ok: false, trace: null, error: "malformed-events" };
    }
    const t = e["t"];
    switch (e["kind"]) {
      case "scenario-start":
        events.push({
          t,
          kind: "scenario-start",
          scenarioId,
          scenarioVersion,
          assistance:
            typeof e["assistance"] === "string" ? e["assistance"] : "instructor",
        });
        break;
      case "time-scale":
        if (!finite(e["scale"])) return bad();
        events.push({ t, kind: "time-scale", scale: e["scale"] });
        break;
      case "node-set": {
        const dir = e["direction"];
        if (
          !finite(e["ignitionTimeUs"]) ||
          !finite(e["deltaVMps"]) ||
          typeof dir !== "string" ||
          !DIRECTIONS.has(dir)
        ) {
          return bad();
        }
        events.push({
          t,
          kind: "node-set",
          ignitionTimeUs: e["ignitionTimeUs"],
          direction: dir as BurnDirection,
          deltaVMps: e["deltaVMps"],
        });
        break;
      }
      case "node-clear":
        events.push({ t, kind: "node-clear" });
        break;
      case "burn-start":
        events.push({ t, kind: "burn-start" });
        break;
      case "burn-stop":
        events.push({ t, kind: "burn-stop" });
        break;
      case "attitude":
        if (!finite(e["command"])) return bad();
        events.push({ t, kind: "attitude", command: e["command"] });
        break;
      case "objective":
        if (typeof e["objectiveId"] !== "string") return bad();
        events.push({
          t,
          kind: "objective",
          objectiveId: e["objectiveId"],
          met: e["met"] === true,
        });
        break;
      case "terminal":
        events.push({
          t,
          kind: "terminal",
          outcome: typeof e["outcome"] === "string" ? e["outcome"] : "unknown",
        });
        break;
      default:
        return bad();
    }
  }

  const trace: OrbitTrace = {
    version: ORBIT_TRACE_VERSION,
    scenarioId,
    scenarioVersion,
    events,
  };

  if (finite(parsed["checksum"]) && parsed["checksum"] !== traceChecksum(trace)) {
    return { ok: false, trace: null, error: "checksum-mismatch" };
  }
  return { ok: true, trace, error: null };

  function bad(): TraceImportResult {
    return { ok: false, trace: null, error: "malformed-events" };
  }
}
