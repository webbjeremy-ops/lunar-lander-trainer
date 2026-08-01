// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — deterministic shadow comparison trace.
//
// The frozen reference guidance remains the SOLE controller of the browser
// vehicle. This module only records a time-aligned diagnostic series and
// hashes it. Nothing here can return a control input.

export interface ShadowTraceSampleV1 {
  readonly missionTimeUs: number;
  /** Reference (controlling) side. */
  readonly referencePhase: string;
  readonly altitudeM: number;
  readonly horizontalSpeedMps: number;
  readonly verticalSpeedMps: number;
  readonly referencePitchRad: number;
  readonly referenceThrottle: number;
  /** Luminary (observed, non-controlling) side. */
  readonly majorMode: number;
  readonly wchPhase: number;
  readonly avegflag: boolean;
  readonly servicerRunning: boolean;
  /** Raw words; scale unresolved. */
  readonly rnRaw: readonly number[];
  readonly vnRaw: readonly number[];
  readonly pipaCounters: readonly number[];
  readonly pipaPulsesDelivered: number;
  readonly radarRequests: number;
  readonly alarmCodeOctal: string;
  readonly restarts: number;
}

export interface ShadowTraceV1 {
  readonly version: 1;
  readonly profileId: "reconstructed-pdi-shadow-v1";
  readonly scenarioId: string;
  readonly samples: readonly ShadowTraceSampleV1[];
  readonly checksum: string;
}

/** FNV-1a/32 over the canonical serialisation. Same convention as M4.0. */
export function shadowTraceChecksum(samples: readonly ShadowTraceSampleV1[]): string {
  let h = 0x811c9dc5;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const s of samples) push(canonicalSample(s));
  return `fnv1a32:${h.toString(16).padStart(8, "0")}`;
}

/** Canonical, key-ordered, fixed-precision serialisation. Determinism gate. */
export function canonicalSample(s: ShadowTraceSampleV1): string {
  const f = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(6);
  return [
    s.missionTimeUs,
    s.referencePhase,
    f(s.altitudeM),
    f(s.horizontalSpeedMps),
    f(s.verticalSpeedMps),
    f(s.referencePitchRad),
    f(s.referenceThrottle),
    s.majorMode,
    s.wchPhase,
    s.avegflag ? 1 : 0,
    s.servicerRunning ? 1 : 0,
    s.rnRaw.join("."),
    s.vnRaw.join("."),
    s.pipaCounters.join("."),
    s.pipaPulsesDelivered,
    s.radarRequests,
    s.alarmCodeOctal,
    s.restarts,
  ].join("|");
}

export function buildShadowTrace(
  scenarioId: string,
  samples: readonly ShadowTraceSampleV1[],
): ShadowTraceV1 {
  return {
    version: 1,
    profileId: "reconstructed-pdi-shadow-v1",
    scenarioId,
    samples,
    checksum: shadowTraceChecksum(samples),
  };
}

/** Deterministic export payload: stable key order, no wall-clock fields. */
export function exportShadowTrace(trace: ShadowTraceV1): string {
  return JSON.stringify(
    {
      version: trace.version,
      profileId: trace.profileId,
      scenarioId: trace.scenarioId,
      checksum: trace.checksum,
      samples: trace.samples.map(canonicalSample),
    },
    null,
    2,
  );
}
