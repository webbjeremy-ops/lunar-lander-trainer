// SPDX-License-Identifier: GPL-3.0-or-later
//
// ReadinessTracker — authentic AGC readiness gate for interactive lessons.
//
// A lesson that opts in via `LessonDefinition.requiresReadinessGate` may not
// open its attempt until the tracker declares the AGC is in a settled state
// consistent with the corresponding fixture's pre-command conditions.
//
// M2.2 Step 5.3 correction: Channel 010 output from Luminary is
// change-driven, not a periodic 1..11 frame. Selector 11 does NOT recur
// reliably once the DSKY has settled — the reference V35 capture emits only
// 3 selector-11 events in a 6.7s trace, none of them during the ~700ms
// pre-command quiet interval. The prior "two complete post-restart scans"
// requirement was therefore unreachable in practice, so /learn would hang
// forever in the readiness gate even though the AGC was already in the
// exact settled state the fixture captured.
//
// The new readiness definition is a fixture-derived quiet-state window:
//
//   1. Baseline seeded from a Worker-authoritative event boundary.
//   2. RESTART annunciator is currently clear (seed OR later 0163 write).
//   3. STANDBY annunciator is currently clear.
//   4. At least one authentic post-RESTART DSKY event has been observed —
//      OR the baseline itself already reflected a post-RESTART DSKY (the
//      Worker's decoded baseline is authoritative, so a settled baseline
//      is itself the evidence).
//   5. The readiness projection remains unchanged for
//      V35_READINESS_QUIET_TICKS consecutive mission ticks after the last
//      projection change (or after baseline, whichever is later).
//   6. AGC steps AND mission ticks continue advancing during that quiet
//      window — a frozen worker cannot masquerade as a settled AGC.
//
// The readiness projection is a subset of the decoded DSKY that captures
// only state that must be settled before V35:
//   * program / verb / noun digits
//   * register digits and PLUS/MINUS sign latches
//   * every annunciator EXCEPT those listed in
//     READINESS_PROJECTION_IGNORED_ANNUNCIATORS (COMP ACTY, UPLINK ACTY,
//     Verb/Noun FLASH). Those are inherently periodic and would prevent
//     any real convergence.
// The EVENT COUNT is deliberately excluded — it grows every event by
// construction and would prevent any two projections from matching.
//
// The tracker is fed by:
//   * `noteBaseline(boundary)`             — from requestEventBoundary().
//   * `applyChannelEvent(ev)`              — every lossless channelUpdate.
//   * `noteTickAdvance({ tickIndex, totalAgcSteps, ... })` — every state
//     snapshot delivers the current mission tick and AGC step count so the
//     tracker can measure quiet mission-time without depending on channel
//     events (which may not fire at all in a settled AGC).
//
// It never touches the DOM and holds no React state.

import {
  applyDskyChannelEvent,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "@/agc/dsky/DskyDecoder";
import type { DecodedDsky } from "@/agc/dsky/DskyTypes";
import type { ChannelEventLite, EventBoundaryPayload } from "@/agc/protocol";
import {
  READINESS_PROJECTION_IGNORED_ANNUNCIATORS,
  V35_READINESS_QUIET_TICKS,
} from "./fixtureExpectations";

export interface ReadinessTickAdvance {
  tickIndex: number;
  missionTimeUs: number;
  totalAgcSteps: number;
}

export interface ReadinessSnapshot {
  ready: boolean;
  seeded: boolean;
  restartCleared: boolean;
  restartClearedEventId: number | null;
  restartClearedTick: number | null;
  standby: boolean;
  restart: boolean;
  postRestartChannelEvents: number;
  quietTicks: number;
  requiredQuietTicks: number;
  latestEventId: number;
  latestTick: number;
  latestTotalAgcSteps: number;
  baselineTick: number;
  baselineTotalAgcSteps: number;
  currentProjection: string;
  previousProjection: string | null;
  lastProjectionChangeTick: number | null;
  blockingReason: string | null;
}

/**
 * Serialize the readiness projection: full digit/sign state and every
 * annunciator NOT in the ignored set. Deterministic and stable across
 * event-count changes.
 */
export function readinessProjectionCanonical(state: DecodedDsky): string {
  const digitStr = (r: { digits: readonly { value: number | null }[] }) =>
    r.digits.map((d) => (d.value ?? "_").toString()).join("");
  const signStr = (r: { sign?: { plus: boolean; minus: boolean } | null }) =>
    r.sign ? `${r.sign.plus ? "+" : "."}${r.sign.minus ? "-" : "."}` : "";
  const ignored = new Set(READINESS_PROJECTION_IGNORED_ANNUNCIATORS);
  const ann = state.annunciators as unknown as Record<string, boolean>;
  const annStr = Object.keys(ann)
    .filter((k) => !ignored.has(k))
    .sort()
    .map((k) => `${k}=${ann[k] ? 1 : 0}`)
    .join(",");
  return [
    `PROG:${digitStr(state.program)}`,
    `VERB:${digitStr(state.verb)}`,
    `NOUN:${digitStr(state.noun)}`,
    `R1:${signStr(state.r1)}${digitStr(state.r1)}`,
    `R2:${signStr(state.r2)}${digitStr(state.r2)}`,
    `R3:${signStr(state.r3)}${digitStr(state.r3)}`,
    `ANN:${annStr}`,
  ].join("|");
}

export class ReadinessTracker {
  private shadow: DecodedDsky = makeEmptyDecodedDsky();
  private seeded = false;
  private restartCleared = false;
  private restartClearedEventId: number | null = null;
  private restartClearedTick: number | null = null;
  private postRestartChannelEvents = 0;
  private currentProjection = "";
  private previousProjection: string | null = null;
  private lastProjectionChangeTick: number | null = null;
  private latestEventId = -1;
  private latestTick = -1;
  private latestTotalAgcSteps = -1;
  private baselineEventId = -1;
  private baselineTick = -1;
  private baselineTotalAgcSteps = -1;
  private quietTicks = 0;

  reset(): void {
    this.shadow = makeEmptyDecodedDsky();
    this.seeded = false;
    this.restartCleared = false;
    this.restartClearedEventId = null;
    this.restartClearedTick = null;
    this.postRestartChannelEvents = 0;
    this.currentProjection = "";
    this.previousProjection = null;
    this.lastProjectionChangeTick = null;
    this.latestEventId = -1;
    this.latestTick = -1;
    this.latestTotalAgcSteps = -1;
    this.baselineEventId = -1;
    this.baselineTick = -1;
    this.baselineTotalAgcSteps = -1;
    this.quietTicks = 0;
  }

  noteBaseline(boundary: EventBoundaryPayload): void {
    this.shadow = JSON.parse(JSON.stringify(boundary.decodedDsky)) as DecodedDsky;
    this.baselineEventId = boundary.boundaryEventId;
    this.baselineTick = boundary.tickIndex;
    this.baselineTotalAgcSteps = boundary.totalAgcSteps;
    this.latestEventId = boundary.boundaryEventId;
    this.latestTick = boundary.tickIndex;
    this.latestTotalAgcSteps = boundary.totalAgcSteps;
    this.seeded = true;

    this.currentProjection = readinessProjectionCanonical(this.shadow);
    this.previousProjection = null;
    this.lastProjectionChangeTick = boundary.tickIndex;
    this.quietTicks = 0;
    this.postRestartChannelEvents = 0;

    if (this.shadow.annunciators.restart === false) {
      // Baseline already reflects a post-restart DSKY — the Worker
      // authoritative view is enough evidence; no further channel event is
      // required to prove "restart cleared" happened.
      this.restartCleared = true;
      this.restartClearedEventId = boundary.boundaryEventId;
      this.restartClearedTick = boundary.tickIndex;
    }
  }

  applyChannelEvent(ev: ChannelEventLite): void {
    if (!this.seeded) return;
    if (ev.eventId <= this.baselineEventId) return;
    this.latestEventId = ev.eventId;
    if (ev.tickIndex > this.latestTick) this.latestTick = ev.tickIndex;

    const wasRestart = this.shadow.annunciators.restart;
    const consumed = applyDskyChannelEvent(this.shadow, ev.channel, ev.value);
    if (!consumed) return;

    // RESTART edge detection.
    if (wasRestart && !this.shadow.annunciators.restart) {
      this.restartCleared = true;
      this.restartClearedEventId = ev.eventId;
      this.restartClearedTick = ev.tickIndex;
    } else if (!wasRestart && this.shadow.annunciators.restart) {
      this.restartCleared = false;
      this.restartClearedEventId = null;
      this.restartClearedTick = null;
    }

    if (this.restartCleared) this.postRestartChannelEvents++;

    // Projection change detection.
    const next = readinessProjectionCanonical(this.shadow);
    if (next !== this.currentProjection) {
      this.previousProjection = this.currentProjection;
      this.currentProjection = next;
      this.lastProjectionChangeTick = ev.tickIndex;
      this.quietTicks = 0;
    }
  }

  /** Feed a mission-clock advancement. Increments quiet counter iff the
   *  projection is stable, RESTART is clear, STANDBY is clear, and AGC
   *  steps are actually advancing. */
  noteTickAdvance(a: ReadinessTickAdvance): void {
    if (!this.seeded) return;
    const stepsAdvancing = a.totalAgcSteps > this.latestTotalAgcSteps;
    const ticksAdvancing = a.tickIndex > this.latestTick;
    if (a.tickIndex > this.latestTick) this.latestTick = a.tickIndex;
    if (a.totalAgcSteps > this.latestTotalAgcSteps) this.latestTotalAgcSteps = a.totalAgcSteps;

    if (!this.restartCleared) return;
    if (this.shadow.annunciators.standby) return;
    if (this.shadow.annunciators.restart) return;
    if (!ticksAdvancing || !stepsAdvancing) return;
    this.quietTicks++;
  }

  private computeBlockingReason(): string | null {
    if (!this.seeded) return "not-seeded";
    if (this.shadow.annunciators.restart) return "restart-asserted";
    if (this.shadow.annunciators.standby) return "standby-asserted";
    if (!this.restartCleared) return "restart-never-cleared";
    if (this.quietTicks < V35_READINESS_QUIET_TICKS) return "quiet-window-too-short";
    if (this.latestTotalAgcSteps <= this.baselineTotalAgcSteps) return "agc-steps-not-advancing";
    return null;
  }

  isReady(): boolean {
    return this.computeBlockingReason() === null;
  }

  snapshot(): ReadinessSnapshot {
    const blocking = this.computeBlockingReason();
    return {
      ready: blocking === null,
      seeded: this.seeded,
      restartCleared: this.restartCleared,
      restartClearedEventId: this.restartClearedEventId,
      restartClearedTick: this.restartClearedTick,
      standby: this.shadow.annunciators.standby,
      restart: this.shadow.annunciators.restart,
      postRestartChannelEvents: this.postRestartChannelEvents,
      quietTicks: this.quietTicks,
      requiredQuietTicks: V35_READINESS_QUIET_TICKS,
      latestEventId: this.latestEventId,
      latestTick: this.latestTick,
      latestTotalAgcSteps: this.latestTotalAgcSteps,
      baselineTick: this.baselineTick,
      baselineTotalAgcSteps: this.baselineTotalAgcSteps,
      currentProjection: this.currentProjection,
      previousProjection: this.previousProjection,
      lastProjectionChangeTick: this.lastProjectionChangeTick,
      blockingReason: blocking,
    };
  }
}

/** Also exported so decodedDskyCanonical is still reachable via this module. */
export { decodedDskyCanonical };
