// SPDX-License-Identifier: GPL-3.0-or-later
// Tick-indexed deterministic replay for the AGC worker command stream.
//
// A ReplayLog is an ordered list of RecordedCommands, each tagged with the
// tickIndex at which it was originally received (defined as the number of
// COMPLETED 20 ms mission-clock ticks at the moment the worker accepted the
// command). Replaying the log means:
//
//   * Reset the worker to a well-defined initial state.
//   * Advance the mission clock one tick at a time (stepSimulation:1).
//   * BEFORE advancing past tickIndex N, re-inject every recorded command
//     whose tickIndex === N, in their original order.
//   * Pause/step/resume/setTimeScale are all first-class recordable commands.
//   * `reset` marks the boundary of a replay segment: commands recorded after
//     a reset belong to a new segment and are replayed after issuing that
//     reset. This matches the amendment: pause/step/resume/reset preserve
//     tick semantics; reset restarts the segment.
//
// The engine is framework-independent so it can be exercised in Vitest and
// invoked from either the worker or the main-thread client.

import type { AgcCommand } from "../protocol";

/** A command as it was accepted by the worker, plus its receive-time tick. */
export interface RecordedCommand {
  tickIndex: number;
  command: AgcCommand;
  /** Monotonic id assigned by the recorder; preserved through replay. */
  eventId: number;
}

/** One replay segment; a `reset` ends the previous segment. */
export interface ReplaySegment {
  segmentIndex: number;
  commands: RecordedCommand[];
  /** Last tick used in this segment (inclusive); replay advances at least this far. */
  finalTickIndex: number;
}

export interface ReplayLog {
  version: 1;
  createdAtIsoUtc: string;
  ropeId: string;
  ropeSha256: string;
  emulatorCommit: string;
  segments: ReplaySegment[];
}

/**
 * Records commands with their receive-time tickIndex and splits them into
 * segments delimited by `reset` commands. Thread-safe within a single owner
 * (typically the worker).
 */
export class ReplayRecorder {
  private nextEventId = 1;
  private segments: ReplaySegment[] = [{ segmentIndex: 0, commands: [], finalTickIndex: 0 }];

  record(command: AgcCommand, tickIndex: number): RecordedCommand {
    const rec: RecordedCommand = { tickIndex, command, eventId: this.nextEventId++ };
    const seg = this.segments[this.segments.length - 1];
    seg.commands.push(rec);
    if (tickIndex > seg.finalTickIndex) seg.finalTickIndex = tickIndex;
    if (command.type === "reset") {
      this.segments.push({
        segmentIndex: this.segments.length,
        commands: [],
        finalTickIndex: tickIndex,
      });
    }
    return rec;
  }

  export(meta: Omit<ReplayLog, "version" | "createdAtIsoUtc" | "segments">): ReplayLog {
    return {
      version: 1,
      createdAtIsoUtc: new Date().toISOString(),
      segments: this.segments.map((s) => ({ ...s, commands: s.commands.slice() })),
      ...meta,
    };
  }
}

/**
 * Sink interface used by the replay driver to actuate an AGC worker (or a
 * mocked worker in tests) one tick at a time.
 */
export interface ReplaySink {
  /** Called before replay starts to bring the simulation to a known state. */
  reset(): Promise<void> | void;
  /** Inject a command as if it arrived at the current tick. */
  injectCommand(command: AgcCommand, eventId: number): Promise<void> | void;
  /** Advance the mission clock exactly one 20 ms tick. */
  stepOneTick(): Promise<void> | void;
}

/**
 * Drive a ReplaySink through a ReplayLog. Commands are re-injected at the
 * tickIndex boundary they were originally observed; pause/step/resume/reset
 * are respected as first-class commands so their timing is preserved.
 * Returns the number of ticks executed.
 */
export async function replayLog(sink: ReplaySink, log: ReplayLog): Promise<number> {
  let ticksExecuted = 0;
  for (const segment of log.segments) {
    if (segment.segmentIndex > 0) {
      // Segment boundary implies a `reset` command was recorded at the end of
      // the previous segment; that reset was already injected as part of that
      // segment's commands. We still normalize state at the segment start.
      await sink.reset();
    } else {
      await sink.reset();
    }
    // Group by tickIndex, ordered as recorded within each tick.
    const byTick = new Map<number, RecordedCommand[]>();
    for (const cmd of segment.commands) {
      const arr = byTick.get(cmd.tickIndex) ?? [];
      arr.push(cmd);
      byTick.set(cmd.tickIndex, arr);
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b);
    const finalTick = segment.finalTickIndex;
    for (let t = 0; t <= finalTick; t++) {
      const bucket = byTick.get(t);
      if (bucket) {
        for (const rec of bucket) {
          await sink.injectCommand(rec.command, rec.eventId);
        }
      }
      if (t < finalTick) {
        await sink.stepOneTick();
        ticksExecuted++;
      }
    }
  }
  return ticksExecuted;
}
