// SPDX-License-Identifier: GPL-3.0-or-later
//
// ReadinessTracker — authentic AGC readiness gate for interactive lessons.
//
// A lesson that opts in via `LessonDefinition.requiresReadinessGate` may not
// open its attempt until the tracker declares the AGC is in a settled state
// consistent with the corresponding fixture's pre-command conditions:
//
//   1. Worker ready and rope provenance verified (checked by caller).
//   2. RESTART annunciator has been observed to clear.
//   3. At least one complete Channel 010 selector scan (selector 1..11 with
//      the terminating selector 11 seen) has been observed AFTER restart
//      cleared.
//   4. Decoded DSKY state is stable across two complete scans post-restart
//      (i.e. two consecutive scan-completion checksums are identical).
//   5. The event stream is still advancing (latestEventId increasing).
//   6. STANDBY is not asserted.
//
// The tracker is fed by:
//   * `noteBaseline(decoded)`    — seed shadow from a fresh event boundary.
//   * `applyChannelEvent(ev)`    — every lossless channelUpdate from the
//                                    shared AgcWorkerClient.
//
// It never touches the DOM and holds no React state.
//
// Rationale is documented in the M2.2 Step 5.2 correction: /learn was
// opening V35 during Luminary's restart bootstrap phase, so the fixture
// annunciator peak (which is only produced by a lamp-test issued from a
// settled DSKY) was unreachable. The gate does NOT fast-forward the AGC or
// inject state — it only refuses to open the attempt until the authentic
// preconditions are actually observed.

import {
  applyDskyChannelEvent,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "@/agc/dsky/DskyDecoder";
import { parseCh010 } from "@/agc/dsky/DskyChannelMap";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import type { ChannelEventLite, EventBoundaryPayload } from "@/agc/protocol";

export interface ReadinessSnapshot {
  ready: boolean;
  seeded: boolean;
  restartCleared: boolean;
  restartClearedEventId: number | null;
  restartClearedTick: number | null;
  standby: boolean;
  scansObserved: number;
  scansAfterRestart: number;
  stableConsecutiveScans: number;
  latestEventId: number;
  latestTick: number;
  lastScanChecksum: string | null;
  lastDecodedChecksum: string;
}

const SELECTOR_TERMINATOR = 11;

export class ReadinessTracker {
  private shadow: DecodedDsky = makeEmptyDecodedDsky();
  private seeded = false;
  private restartCleared = false;
  private restartClearedEventId: number | null = null;
  private restartClearedTick: number | null = null;
  private scansObserved = 0;
  private scansAfterRestart = 0;
  private stableConsecutiveScans = 0;
  private lastScanChecksum: string | null = null;
  private latestEventId = -1;
  private latestTick = -1;
  private baselineEventId = -1;

  /** Reset all state. Call on session reset (Reset AGC / new epoch). */
  reset(): void {
    this.shadow = makeEmptyDecodedDsky();
    this.seeded = false;
    this.restartCleared = false;
    this.restartClearedEventId = null;
    this.restartClearedTick = null;
    this.scansObserved = 0;
    this.scansAfterRestart = 0;
    this.stableConsecutiveScans = 0;
    this.lastScanChecksum = null;
    this.latestEventId = -1;
    this.latestTick = -1;
    this.baselineEventId = -1;
  }

  /** Seed the shadow decoder from a Worker-authoritative event boundary. */
  noteBaseline(boundary: EventBoundaryPayload): void {
    this.shadow = JSON.parse(JSON.stringify(boundary.decodedDsky)) as DecodedDsky;
    this.baselineEventId = boundary.boundaryEventId;
    this.latestEventId = boundary.boundaryEventId;
    this.latestTick = boundary.tickIndex;
    this.seeded = true;
    // Seed restart-cleared state from the baseline itself — if the AGC has
    // already left restart by the time we started tracking, honor that.
    if (this.shadow.annunciators.restart === false) {
      this.restartCleared = true;
      this.restartClearedEventId = boundary.boundaryEventId;
      this.restartClearedTick = boundary.tickIndex;
    }
  }

  /** Apply one lossless channel event. */
  applyChannelEvent(ev: ChannelEventLite): void {
    if (!this.seeded) return;
    // Only apply events strictly after the baseline so we never regress.
    if (ev.eventId <= this.baselineEventId) return;
    this.latestEventId = ev.eventId;
    this.latestTick = ev.tickIndex;

    const wasRestart = this.shadow.annunciators.restart;
    const consumed = applyDskyChannelEvent(this.shadow, ev.channel, ev.value);
    if (!consumed) return;

    // Detect RESTART clearing edge.
    if (wasRestart && !this.shadow.annunciators.restart) {
      this.restartCleared = true;
      this.restartClearedEventId = ev.eventId;
      this.restartClearedTick = ev.tickIndex;
      // Reset scan-stability counters — stability measurement begins now.
      this.scansAfterRestart = 0;
      this.stableConsecutiveScans = 0;
      this.lastScanChecksum = null;
    } else if (!wasRestart && this.shadow.annunciators.restart) {
      // Regressed back into restart (e.g. rope-driven RESTART re-assert).
      this.restartCleared = false;
      this.restartClearedEventId = null;
      this.restartClearedTick = null;
      this.scansAfterRestart = 0;
      this.stableConsecutiveScans = 0;
      this.lastScanChecksum = null;
    }

    // Detect completion of a Channel 010 selector scan. The rope drives
    // selectors 1..11 in order; selector 11 is the terminator of a scan.
    if (ev.channel === 0o10) {
      const parsed = parseCh010(ev.value);
      if (parsed.selector === SELECTOR_TERMINATOR) {
        this.scansObserved++;
        if (this.restartCleared) {
          this.scansAfterRestart++;
          // Strip the "EC:<n>" event-count suffix — it monotonically grows
          // per applied event, so two IDENTICAL relay-state scans would
          // otherwise never match. Stability is about latched display, not
          // event count.
          const chk = decodedDskyCanonical(this.shadow).replace(/\|EC:\d+$/, "");
          if (this.lastScanChecksum !== null && this.lastScanChecksum === chk) {
            this.stableConsecutiveScans++;
          } else {
            this.stableConsecutiveScans = 0;
          }
          this.lastScanChecksum = chk;
        }
      }
    }
  }

  /** Whether all readiness preconditions are currently satisfied. */
  isReady(): boolean {
    if (!this.seeded) return false;
    if (!this.restartCleared) return false;
    if (this.shadow.annunciators.standby) return false;
    // "At least one complete scan after restart" AND "stable across two
    // consecutive scans" — the latter naturally implies scansAfterRestart>=2.
    if (this.scansAfterRestart < 2) return false;
    if (this.stableConsecutiveScans < 1) return false;
    // Event stream must have advanced past the baseline.
    if (this.latestEventId <= this.baselineEventId) return false;
    return true;
  }

  snapshot(): ReadinessSnapshot {
    return {
      ready: this.isReady(),
      seeded: this.seeded,
      restartCleared: this.restartCleared,
      restartClearedEventId: this.restartClearedEventId,
      restartClearedTick: this.restartClearedTick,
      standby: this.shadow.annunciators.standby,
      scansObserved: this.scansObserved,
      scansAfterRestart: this.scansAfterRestart,
      stableConsecutiveScans: this.stableConsecutiveScans,
      latestEventId: this.latestEventId,
      latestTick: this.latestTick,
      lastScanChecksum: this.lastScanChecksum,
      lastDecodedChecksum: decodedDskyCanonical(this.shadow),
    };
  }
}
