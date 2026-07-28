// SPDX-License-Identifier: GPL-3.0-or-later
// Versioned mission event log. Every user-observable input (DSKY key, mode
// change, injected fault) is appended here so the same log can be replayed
// deterministically against the same rope + seed to reproduce a checksum.

export interface MissionEvent {
  missionTimeUs: number;
  kind: string;
  payload?: unknown;
}

export interface SerializedEventLog {
  logVersion: number;
  seed: number;
  entries: MissionEvent[];
}

export class EventLog {
  private readonly entries: MissionEvent[] = [];
  private version = 1;

  constructor(private readonly seed: number) {}

  append(evt: MissionEvent): void {
    this.entries.push(evt);
    this.version = (this.version + 1) >>> 0;
  }

  cursor(): number {
    return this.entries.length;
  }

  logVersion(): number {
    return this.version;
  }

  snapshot(): SerializedEventLog {
    return { logVersion: this.version, seed: this.seed, entries: this.entries.slice() };
  }

  /** Replay iterator up to (but not including) `entries.length`. */
  all(): readonly MissionEvent[] {
    return this.entries;
  }
}
