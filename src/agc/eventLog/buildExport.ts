// SPDX-License-Identifier: GPL-3.0-or-later
// Assemble a versioned AgcEventLogExportV1 from a Worker export payload +
// the current session's ReadyPayload. Pure: no I/O, no Worker access.

import type { ReadyPayload } from "../protocol";
import type { EventLogExportPayload } from "../protocol";
import {
  AGC_EVENT_LOG_FORMAT,
  AGC_EVENT_LOG_SCHEMA_VERSION,
  type AgcEventLogExportV1,
  type AgcEventLogPayloadV1,
  type ExportedAgcEvent,
} from "./schema";
import { canonicalSha256 } from "./canonical";

export interface BuildExportOptions {
  /** Override for tests; defaults to new Date().toISOString(). */
  exportedAt?: string;
}

export async function buildEventLogExport(
  worker: EventLogExportPayload,
  ready: ReadyPayload,
  opts: BuildExportOptions = {},
): Promise<AgcEventLogExportV1> {
  if (worker.sessionEpoch !== ready.sessionEpoch) {
    throw new Error(
      `buildEventLogExport: session-epoch mismatch (worker=${worker.sessionEpoch}, ready=${ready.sessionEpoch})`,
    );
  }

  const events: ExportedAgcEvent[] = worker.events.map((e) =>
    e.type === "inputAccepted"
      ? {
          type: "inputAccepted",
          eventId: e.eventId,
          sessionEpoch: worker.sessionEpoch,
          tickIndex: e.tickIndex,
          missionTimeUs: e.missionTimeUs,
          totalAgcSteps: e.totalAgcSteps,
          kind: e.kind,
          ...(e.keyCode !== undefined ? { keyCode: e.keyCode } : {}),
          ...(e.pressed !== undefined ? { pressed: e.pressed } : {}),
          source: "dsky",
        }
      : {
          type: "channelUpdate",
          eventId: e.eventId,
          sessionEpoch: worker.sessionEpoch,
          tickIndex: e.tickIndex,
          missionTimeUs: e.missionTimeUs,
          totalAgcSteps: e.totalAgcSteps,
          channel: e.channel,
          value: e.value,
        },
  );

  // Defensive: enforce strict eventId ordering + reject duplicates.
  for (let i = 1; i < events.length; i++) {
    if (events[i].eventId <= events[i - 1].eventId) {
      throw new Error(
        `buildEventLogExport: events not strictly ordered at index ${i} (id ${events[i].eventId} <= ${events[i - 1].eventId})`,
      );
    }
  }

  const payload: AgcEventLogPayloadV1 = {
    provenance: {
      emulatorRepo: ready.emulatorRepo,
      emulatorCommit: ready.emulatorCommit,
      emulatorVersionString: ready.emulatorVersionString,
      wasmSha256: ready.wasmSha256,
      ropeId: ready.ropeId,
      ropeSha256: ready.ropeSha256,
      ropeSourceCommit: ready.ropeSourceCommit,
      ropeByteLength: ready.ropeByteLength,
      protocolVersion: ready.protocolVersion,
    },
    timing: {
      nominalStepNs: worker.timing.nominalStepNs,
      schedulerTickUs: worker.timing.schedulerTickUs,
    },
    session: {
      sessionEpoch: worker.sessionEpoch,
      resetCount: ready.resetCount,
      initialResetPerformed: ready.initialResetPerformed,
      startupRsetSent: ready.canonicalInit.startupRsetSent,
      startupRsetCode: ready.canonicalInit.startupRsetCode,
      settledAtTick: ready.canonicalInit.settledAtTick,
    },
    baseline: {
      eventId: 0,
      tickIndex: worker.baseline.tickIndex,
      missionTimeUs: worker.baseline.missionTimeUs,
      totalAgcSteps: worker.baseline.totalAgcSteps,
      decodedDsky: worker.baseline.decodedDsky,
      decodedDskyChecksum: worker.baseline.decodedDskyChecksum,
      channelValues: worker.baseline.channelValues,
    },
    events,
    retention: {
      completeEpoch: worker.retention.completeEpoch,
      droppedBeforeEventId: worker.retention.droppedBeforeEventId,
      retainedEventLimit: worker.retention.retainedEventLimit,
    },
    integrity: {
      eventCount: events.length,
      firstEventId: events.length > 0 ? events[0].eventId : null,
      lastEventId: events.length > 0 ? events[events.length - 1].eventId : null,
    },
  };

  const canonicalSha = await canonicalSha256(payload);

  return {
    format: AGC_EVENT_LOG_FORMAT,
    schemaVersion: AGC_EVENT_LOG_SCHEMA_VERSION,
    envelope: {
      exportedAt: opts.exportedAt ?? new Date().toISOString(),
    },
    payload,
    integrity: {
      canonicalSha256: canonicalSha,
    },
  };
}

/** Suggested file name. Contains the rope id, session epoch, and a
 *  UTC timestamp of the export (not the session start). */
export function suggestedFileName(
  ropeId: string,
  sessionEpoch: number,
  when: Date = new Date(),
): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}` +
    `-${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}`;
  const slug = ropeId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `apollo-agc-${slug}-epoch-${sessionEpoch}-${stamp}.json`;
}
