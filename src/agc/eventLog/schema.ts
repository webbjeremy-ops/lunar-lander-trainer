// SPDX-License-Identifier: GPL-3.0-or-later
// Versioned event-log export schema (v1).
//
// The exported file is a *deterministic* record of the current public
// session epoch: a lossless baseline captured at `ready` (post-canonical-
// initialization) plus every public inputAccepted / channelUpdate event
// emitted since. Given the same session (rope, emulator commit, protocol
// version, session epoch, and event sequence), the canonical payload
// bytes are byte-identical across exports — only `envelope.exportedAt`
// varies, and it is EXCLUDED from the integrity hash by construction.
//
// Envelope / payload / integrity split
// ------------------------------------
// * envelope.exportedAt — wall-clock timestamp; presentation only.
// * payload             — everything deterministic. Canonically serialized
//                         with sorted object keys; hashed with SHA-256.
// * integrity           — canonical payload SHA-256. Recomputable.

import type { DecodedDsky } from "../dsky/DskyTypes";

export const AGC_EVENT_LOG_FORMAT = "apollo-agc-event-log" as const;
export const AGC_EVENT_LOG_SCHEMA_VERSION = 1 as const;

/** A single accepted user input, echoed with the SAME monotonic eventId
 *  used by channel events. `source` is always "dsky" for now — reserved
 *  for future non-DSKY input paths. Canonical initialization RSET is NOT
 *  emitted here (it lives in the private pre-ready phase). */
export interface ExportedInputEvent {
  type: "inputAccepted";
  eventId: number;
  sessionEpoch: number;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  kind: "dskyKeyDown" | "dskyKeyUp" | "proceedKey";
  /** Present for dskyKeyDown / dskyKeyUp. Canonical numeric keycode. */
  keyCode?: number;
  /** Present for proceedKey. */
  pressed?: boolean;
  source: "dsky" | "system";
}

/** A raw AGC output-channel write. Numeric values are canonical; octal
 *  strings are presentation-only and MUST NOT replace them. */
export interface ExportedChannelEvent {
  type: "channelUpdate";
  eventId: number;
  sessionEpoch: number;
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
  channel: number;
  value: number;
}

export type ExportedAgcEvent = ExportedInputEvent | ExportedChannelEvent;

/** Deterministic portion of the export. Hashed as canonical JSON. */
export interface AgcEventLogPayloadV1 {
  provenance: {
    emulatorRepo: string;
    emulatorCommit: string;
    emulatorVersionString: string;
    wasmSha256: string;
    ropeId: string;
    ropeSha256: string;
    ropeSourceCommit: string;
    ropeByteLength: number;
    protocolVersion: number;
  };

  timing: {
    /** Nanoseconds per AGC step used by the mission clock. */
    nominalStepNs: number;
    /** Scheduler tick period in microseconds. */
    schedulerTickUs: number;
  };

  session: {
    sessionEpoch: number;
    resetCount: number;
    initialResetPerformed: boolean;
    startupRsetSent: boolean;
    startupRsetCode: number;
    settledAtTick: number;
  };

  /** Lossless state at the START of the current public epoch (i.e. the
   *  instant after canonical initialization completed and public event
   *  IDs began). Replaying `events` against this baseline reproduces the
   *  live decoded DSKY and channel state exactly. */
  baseline: {
    /** Boundary eventId. Zero — public IDs begin at 1. Included so the
     *  file is self-describing. */
    eventId: 0;
    tickIndex: number;
    missionTimeUs: number;
    totalAgcSteps: number;
    decodedDsky: DecodedDsky;
    /** Canonical checksum (from decodedDskyCanonical) of decodedDsky. */
    decodedDskyChecksum: string;
    /** Snapshot of every AGC channel the Worker had observed at baseline
     *  time. Keys are decimal channel numbers as strings; values are
     *  canonical numbers. */
    channelValues: Record<string, number>;
  };

  events: ExportedAgcEvent[];

  /** Honest description of what portion of the epoch is represented. */
  retention: {
    /** True iff no events have been dropped from the head of the ring
     *  (i.e. `events` covers the ENTIRE current epoch). */
    completeEpoch: boolean;
    /** If completeEpoch is false, the eventId of the OLDEST event still
     *  retained; every id in [1, droppedBeforeEventId) has been dropped. */
    droppedBeforeEventId: number | null;
    /** Configured ring capacity; null if retention is unbounded. */
    retainedEventLimit: number | null;
  };

  integrity: {
    eventCount: number;
    firstEventId: number | null;
    lastEventId: number | null;
  };
}

/** Full export envelope. `envelope.exportedAt` is excluded from the
 *  integrity hash so identical session data produces identical bytes
 *  except for the wall-clock timestamp. */
export interface AgcEventLogExportV1 {
  format: typeof AGC_EVENT_LOG_FORMAT;
  schemaVersion: typeof AGC_EVENT_LOG_SCHEMA_VERSION;
  envelope: {
    exportedAt: string;
  };
  payload: AgcEventLogPayloadV1;
  integrity: {
    canonicalSha256: string;
  };
}
