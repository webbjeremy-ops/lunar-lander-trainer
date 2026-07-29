// SPDX-License-Identifier: GPL-3.0-or-later
// Compare a validated import against the CURRENT shared-Worker session and
// classify replay eligibility. Pure — no I/O, no Worker access.

import type { ReadyPayload } from "../protocol";
import type { AgcEventLogPayloadV1 } from "./schema";
import { AGC_EVENT_LOG_SCHEMA_VERSION } from "./schema";
import type {
  CompatibilityReport,
  MatchResult,
  ValidatedAgcEventLogV1,
} from "./importSchema";

/** Current-session context used for the comparison. Fields may be null
 *  when the live session is not ready — those become "unknown-current". */
export interface CurrentSessionContext {
  ready: ReadyPayload | null;
  /** From worker.timing (available on live export payload). Optional so
   *  callers may compare against an import without having done a live
   *  export first. */
  timing?: { nominalStepNs: number; schedulerTickUs: number } | null;
}

function match(imported: unknown, current: unknown): MatchResult {
  if (current === undefined || current === null) return { status: "unknown-current", imported };
  return imported === current ? { status: "match", value: imported } : { status: "differs", imported, current };
}

export function buildCompatibilityReport(
  validated: ValidatedAgcEventLogV1,
  ctx: CurrentSessionContext,
): CompatibilityReport {
  const p: AgcEventLogPayloadV1 = validated.raw.payload;
  const ready = ctx.ready;
  const timing = ctx.timing ?? null;

  const schemaVersion = match(validated.raw.schemaVersion, AGC_EVENT_LOG_SCHEMA_VERSION);
  const protocolVersion = match(p.provenance.protocolVersion, ready?.protocolVersion ?? null);
  const emulatorCommit = match(p.provenance.emulatorCommit, ready?.emulatorCommit ?? null);
  const wasmSha256 = match(p.provenance.wasmSha256, ready?.wasmSha256 ?? null);
  const ropeId = match(p.provenance.ropeId, ready?.ropeId ?? null);
  const ropeSha256 = match(p.provenance.ropeSha256, ready?.ropeSha256 ?? null);
  const ropeSourceCommit = match(p.provenance.ropeSourceCommit, ready?.ropeSourceCommit ?? null);
  const schedulerTickUs = match(p.timing.schedulerTickUs, timing?.schedulerTickUs ?? null);
  const nominalStepNs = match(p.timing.nominalStepNs, timing?.nominalStepNs ?? null);

  // Replay eligibility requires exact matches on ALL replay-critical fields.
  // "unknown-current" is NOT eligible — we cannot certify a replay when the
  // live session's provenance is unavailable.
  const critical: MatchResult[] = [
    schemaVersion,
    protocolVersion,
    emulatorCommit,
    wasmSha256,
    ropeSha256,
    schedulerTickUs,
    nominalStepNs,
  ];
  const replayEligible = critical.every((m) => m.status === "match");

  return {
    schemaVersion,
    protocolVersion,
    emulatorCommit,
    wasmSha256,
    ropeId,
    ropeSha256,
    ropeSourceCommit,
    schedulerTickUs,
    nominalStepNs,
    replayEligible,
  };
}
