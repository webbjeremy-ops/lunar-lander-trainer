// SPDX-License-Identifier: GPL-3.0-or-later
// Types for the DEFENSIVE event-log importer.
//
// Nothing here trusts the file. A ValidatedAgcEventLogV1 is only ever
// produced by validateImport() after every structural, semantic, and
// integrity check has passed. Consumers must NOT cast to
// AgcEventLogExportV1 or read fields off a raw JSON blob.

import type { AgcEventLogExportV1 } from "./schema";

/** Absolute resource limits. Chosen comfortably above the current
 *  32,768-event Worker export ring so legitimate exports import fine while
 *  malformed files cannot freeze the browser. */
export const IMPORT_LIMITS = {
  /** Hard upload cap. Rejects the file before JSON parsing. */
  maxUploadBytes: 64 * 1024 * 1024,
  /** Hard cap on payload.events.length. */
  maxEventCount: 200_000,
  /** How many validation errors we retain / surface. Additional errors
   *  are counted but their details are dropped. */
  maxValidationErrors: 100,
  /** Cap for any untrusted string we retain (provenance ids, commits,
   *  version strings). Longer values fail validation with a specific
   *  code, we do NOT truncate silently. */
  maxUntrustedStringLen: 4096,
} as const;

/** Stable, machine-readable error codes. Prefer these over free-form
 *  strings so the UI can localize and the tests can assert precisely. */
export type ImportErrorCode =
  | "file-too-large"
  | "empty-file"
  | "not-utf8"
  | "malformed-json"
  | "not-an-object"
  | "wrong-format"
  | "unsupported-schema-version"
  | "missing-field"
  | "wrong-type"
  | "out-of-range"
  | "string-too-long"
  | "not-safe-integer"
  | "invalid-timestamp"
  | "invalid-sha256"
  | "invalid-event-discriminator"
  | "invalid-input-kind"
  | "invalid-input-source"
  | "invalid-keycode"
  | "invalid-channel"
  | "invalid-decoded-baseline"
  | "invalid-channel-baseline"
  | "too-many-events"
  | "event-ids-not-strictly-increasing"
  | "session-epoch-mismatch"
  | "non-monotonic-tick"
  | "non-monotonic-mission-time"
  | "non-monotonic-total-steps"
  | "event-count-mismatch"
  | "first-event-id-mismatch"
  | "last-event-id-mismatch"
  | "baseline-boundary-mismatch"
  | "baseline-checksum-mismatch"
  | "retention-inconsistent"
  | "startup-rset-leaked-to-public-input"
  | "integrity-hash-mismatch";

export interface ImportValidationError {
  code: ImportErrorCode;
  /** Human-readable path into the file (e.g. "events[412].eventId").
   *  Empty string means "the file as a whole". */
  path: string;
  /** Human-readable one-liner. Safe to display verbatim; contains no
   *  untrusted user input except numeric indices and constant tokens. */
  message: string;
}

/** MatchResult: single-field comparison outcome vs the current session. */
export type MatchResult =
  | { status: "match"; value: unknown }
  | { status: "differs"; imported: unknown; current: unknown }
  | { status: "unknown-current"; imported: unknown };

export interface CompatibilityReport {
  schemaVersion: MatchResult;
  protocolVersion: MatchResult;
  emulatorCommit: MatchResult;
  wasmSha256: MatchResult;
  ropeId: MatchResult;
  ropeSha256: MatchResult;
  ropeSourceCommit: MatchResult;
  schedulerTickUs: MatchResult;
  nominalStepNs: MatchResult;
  /** True only when every replay-critical field matches exactly:
   *  schemaVersion, protocolVersion, emulatorCommit, wasmSha256,
   *  ropeSha256, schedulerTickUs, nominalStepNs. */
  replayEligible: boolean;
}

/** Post-validation, immutable recording. `raw` is the ORIGINAL export
 *  document (deep-cloned during validation so downstream consumers can
 *  never mutate live state). All fields have been checked; readers may
 *  rely on their invariants. */
export interface ValidatedAgcEventLogV1 {
  readonly raw: AgcEventLogExportV1;
  readonly summary: {
    schemaVersion: number;
    exportedAt: string;
    ropeId: string;
    ropeSha256: string;
    emulatorCommit: string;
    protocolVersion: number;
    sessionEpoch: number;
    eventCount: number;
    firstEventId: number | null;
    lastEventId: number | null;
    firstTickIndex: number | null;
    lastTickIndex: number | null;
    firstMissionTimeUs: number | null;
    lastMissionTimeUs: number | null;
    completeEpoch: boolean;
    droppedBeforeEventId: number | null;
    retainedEventLimit: number | null;
    canonicalSha256: string;
    fileSizeBytes: number;
  };
}

export type ImportResult =
  | {
      status: "valid-compatible";
      recording: ValidatedAgcEventLogV1;
      compatibility: CompatibilityReport;
    }
  | {
      status: "valid-incompatible";
      recording: ValidatedAgcEventLogV1;
      compatibility: CompatibilityReport;
    }
  | {
      status: "invalid";
      errors: ImportValidationError[];
      /** True if additional errors were suppressed by maxValidationErrors. */
      truncated: boolean;
    };
