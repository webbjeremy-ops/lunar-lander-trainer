// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.c — Pure AGC actuator observation / decoding.
//
// PURITY CONTRACT
//   - No WASM instantiation, no adapter call, no trace drain, no Worker
//     interaction. This module consumes IMMUTABLE event fixtures supplied by
//     the caller and returns new immutable values.
//   - No hidden mutable module state. All carry-over lives in the explicit
//     `AgcActuatorDecoderState` value.
//
// SAFETY CONTRACT
//   - The DPS throttle MAGNITUDE scale is UNRESOLVED (docs/M3_3_IO_MAP.md
//     row 17). `throttleFraction` is therefore ALWAYS `null` and the result
//     always carries the `throttle-scale-unresolved` invalid reason.
//   - An absent engine command is `engineCommand: "none"` with
//     `engineEnabled: null` — never a fabricated OFF.

import {
  ENGINE_OFF_MASK,
  ENGINE_ON_MASK,
  EXPECTED_ACTUATOR_CHANNELS,
  NATIVE_COUNTER_OPERATION_CODES,
  THRUST_COUNTER_ADDRESS,
  THRUST_DRIVE_ACTIVITY_MASK,
  AGC_CHANNEL_WORD_MASK,
} from "./actuatorRegistry";
import type {
  AgcActuatorInvalidReason,
  AgcActuatorTickEvents,
  AgcCommandedControl,
  AgcEngineCommandState,
  AgcOutputChannelEvent,
  AgcOutputCounterEvent,
  AgcWideCounter,
  ThrustCounterDiagnostic,
} from "./types";

// ---------------------------------------------------------------------------
// Wide (64-bit) counter helpers — never collapse to a JS number
// ---------------------------------------------------------------------------

const U32 = 0xffffffff;

export function isValidWideCounter(c: AgcWideCounter | undefined | null): boolean {
  return (
    !!c &&
    Number.isInteger(c.hi) &&
    Number.isInteger(c.lo) &&
    c.hi >= 0 &&
    c.hi <= U32 &&
    c.lo >= 0 &&
    c.lo <= U32
  );
}

/** -1 | 0 | 1 comparison on the (hi, lo) word pair. */
export function compareWide(a: AgcWideCounter, b: AgcWideCounter): number {
  if (a.hi !== b.hi) return a.hi < b.hi ? -1 : 1;
  if (a.lo !== b.lo) return a.lo < b.lo ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Decoder state / result
// ---------------------------------------------------------------------------

export interface AgcActuatorDecoderState {
  readonly kind: "agc-actuator-decoder-state-v0";
  /** Latched CHAN11 level-derived engine command (levels persist on the bus
   *  until the AGC rewrites the word). */
  readonly engineCommand: AgcEngineCommandState;
  readonly lastChannel11Value: number | null;
  readonly lastChannel14Value: number | null;
  readonly lastChannelSequence: AgcWideCounter | null;
  readonly lastCounterSequence: AgcWideCounter | null;
  readonly lastMissionTick: number | null;
  /** Bounded diagnostic tallies (no unbounded retention in the reducer). */
  readonly totalThrustEvents: number;
  readonly totalDroppedTraceEntries: number;
}

export const INITIAL_ACTUATOR_DECODER_STATE: AgcActuatorDecoderState = {
  kind: "agc-actuator-decoder-state-v0",
  engineCommand: "none",
  lastChannel11Value: null,
  lastChannel14Value: null,
  lastChannelSequence: null,
  lastCounterSequence: null,
  lastMissionTick: null,
  totalThrustEvents: 0,
  totalDroppedTraceEntries: 0,
};

export interface AgcActuatorDecoderResult {
  readonly nextState: AgcActuatorDecoderState;
  readonly control: AgcCommandedControl;
  readonly thrust: ThrustCounterDiagnostic;
  readonly invalidReasons: readonly AgcActuatorInvalidReason[];
}

// ---------------------------------------------------------------------------
// Pure event validation
// ---------------------------------------------------------------------------

function isChannelWord(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 0 &&
    (v & ~AGC_CHANNEL_WORD_MASK) === 0
  );
}

export function validateChannelEvent(
  e: AgcOutputChannelEvent,
): readonly AgcActuatorInvalidReason[] {
  const out: AgcActuatorInvalidReason[] = [];
  if (
    e.stream !== "channel" ||
    !isValidWideCounter(e.sequence) ||
    !isValidWideCounter(e.cycle) ||
    !isChannelWord(e.value) ||
    (e.valueBefore !== null && !isChannelWord(e.valueBefore))
  ) {
    out.push("malformed-event");
  }
  if (!EXPECTED_ACTUATOR_CHANNELS.includes(e.channel)) {
    out.push("unexpected-channel");
  }
  return out;
}

export function validateCounterEvent(
  e: AgcOutputCounterEvent,
): readonly AgcActuatorInvalidReason[] {
  const out: AgcActuatorInvalidReason[] = [];
  if (
    e.stream !== "counter" ||
    !isValidWideCounter(e.sequence) ||
    !isValidWideCounter(e.cycle) ||
    !Number.isInteger(e.delta) ||
    !isChannelWord(e.valueBefore) ||
    !isChannelWord(e.valueAfter)
  ) {
    out.push("malformed-event");
  }
  if (e.address !== THRUST_COUNTER_ADDRESS) {
    out.push("unexpected-counter-address");
  }
  if (!NATIVE_COUNTER_OPERATION_CODES.includes(e.operation)) {
    out.push("unsupported-counter-operation");
  }
  // Coherence check only where the operation semantics permit it: a WRITE
  // (native code 0) records value_before/value_after and delta as their
  // arithmetic difference in hwio.c.
  if (
    out.length === 0 &&
    e.operation === 0 &&
    e.valueAfter - e.valueBefore !== e.delta
  ) {
    out.push("malformed-event");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stream reducers
// ---------------------------------------------------------------------------

interface ChannelStreamResult {
  readonly engineCommand: AgcEngineCommandState;
  readonly lastChannel11Value: number | null;
  readonly lastChannel14Value: number | null;
  readonly lastSequence: AgcWideCounter | null;
  readonly channel11: readonly AgcOutputChannelEvent[];
  readonly channel14: readonly AgcOutputChannelEvent[];
  readonly thrustDriveObserved: boolean;
  readonly thrustDriveEventCount: number;
  readonly reasons: readonly AgcActuatorInvalidReason[];
}

/** CHAN11 engine ON/OFF are LEVEL bits (registry semantics). The command
 *  state is derived from the most recent word observed; both bits set in the
 *  same word is a contradiction. */
function engineCommandFromWord(word: number): AgcEngineCommandState {
  const on = (word & ENGINE_ON_MASK) !== 0;
  const off = (word & ENGINE_OFF_MASK) !== 0;
  if (on && off) return "conflict";
  if (on) return "on";
  if (off) return "off";
  return "none";
}

function reduceChannelStream(
  state: Readonly<AgcActuatorDecoderState>,
  events: readonly AgcOutputChannelEvent[],
): ChannelStreamResult {
  const reasons: AgcActuatorInvalidReason[] = [];
  const channel11: AgcOutputChannelEvent[] = [];
  const channel14: AgcOutputChannelEvent[] = [];
  let engineCommand = state.engineCommand;
  let last11 = state.lastChannel11Value;
  let last14 = state.lastChannel14Value;
  let lastSeq = state.lastChannelSequence;
  let thrustDriveObserved = false;
  let thrustDriveEventCount = 0;

  for (const e of events) {
    for (const r of validateChannelEvent(e)) {
      if (!reasons.includes(r)) reasons.push(r);
    }
    if (lastSeq !== null && isValidWideCounter(e.sequence)) {
      if (compareWide(e.sequence, lastSeq) <= 0) {
        if (!reasons.includes("nonmonotonic-event-sequence")) {
          reasons.push("nonmonotonic-event-sequence");
        }
      }
    }
    if (isValidWideCounter(e.sequence)) lastSeq = e.sequence;

    if (e.channel === 0o11) {
      channel11.push(e);
      last11 = e.value;
      const observed = engineCommandFromWord(e.value);
      // A level word that asserts neither bit clears a previously latched
      // command back to "none" — the bus level genuinely went away. It is
      // never coerced into "off".
      engineCommand = observed;
    } else if (e.channel === 0o14) {
      channel14.push(e);
      last14 = e.value;
      if ((e.value & THRUST_DRIVE_ACTIVITY_MASK) !== 0) {
        // ACTIVITY semantics: reported only for the tick in which it is
        // observed; never latched across ticks.
        thrustDriveObserved = true;
        thrustDriveEventCount += 1;
      }
    }
  }

  return {
    engineCommand,
    lastChannel11Value: last11,
    lastChannel14Value: last14,
    lastSequence: lastSeq,
    channel11,
    channel14,
    thrustDriveObserved,
    thrustDriveEventCount,
    reasons,
  };
}

interface CounterStreamResult {
  readonly thrust: ThrustCounterDiagnostic;
  readonly events: readonly AgcOutputCounterEvent[];
  readonly lastSequence: AgcWideCounter | null;
  readonly reasons: readonly AgcActuatorInvalidReason[];
}

function reduceCounterStream(
  state: Readonly<AgcActuatorDecoderState>,
  events: readonly AgcOutputCounterEvent[],
): CounterStreamResult {
  const reasons: AgcActuatorInvalidReason[] = [];
  const kept: AgcOutputCounterEvent[] = [];
  const operations: number[] = [];
  let lastSeq = state.lastCounterSequence;
  let signedDeltaTotal = 0;
  let firstValue: number | null = null;
  let lastValue: number | null = null;

  for (const e of events) {
    for (const r of validateCounterEvent(e)) {
      if (!reasons.includes(r)) reasons.push(r);
    }
    if (lastSeq !== null && isValidWideCounter(e.sequence)) {
      if (compareWide(e.sequence, lastSeq) <= 0) {
        if (!reasons.includes("nonmonotonic-event-sequence")) {
          reasons.push("nonmonotonic-event-sequence");
        }
      }
    }
    if (isValidWideCounter(e.sequence)) lastSeq = e.sequence;

    // Every supplied event is preserved verbatim and in order. Opposing
    // operations are NEVER algebraically collapsed: `operations` keeps one
    // entry per event and `kept` keeps the events themselves.
    kept.push(e);
    operations.push(e.operation);
    signedDeltaTotal += e.delta;
    if (firstValue === null) firstValue = e.valueBefore;
    lastValue = e.valueAfter;
  }

  return {
    thrust: {
      eventCount: kept.length,
      signedDeltaTotal,
      firstValue,
      lastValue,
      operations,
      counterRateUnitsPerCentisecond: THROTTLE_COUNTER_UNITS_PER_CENTISECOND,
      physicalForceScaleStatus: "unresolved",
      interpretation: "lgc-throttle-command-delta-into-deca-summing-junction",
      scaleStatus: "unresolved",
    },
    events: kept,
    lastSequence: lastSeq,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Tick-boundary merge rule (documented)
// ---------------------------------------------------------------------------
//
// The channel-write stream and the output-counter trace stream have NO
// proven shared sub-cycle ordering, so no total order is fabricated. The
// merge rule at the tick boundary is:
//
//   1. Reduce channel events in their authentic order  -> engine command
//      level + thrust-drive ACTIVITY observation for this tick.
//   2. Reduce counter events in their authentic order  -> raw, non-physical
//      THRUST diagnostic (no collapsing, no scaling).
//   3. Combine: the engine-command state comes solely from stream (1); the
//      THRUST diagnostic comes solely from stream (2). Neither stream
//      reorders, gates, filters or annotates the other. `throttleFraction`
//      stays `null` regardless of both.
//   4. Emit exactly one diagnostic AgcCommandedControl for the tick.

export function reduceAgcActuatorTick(
  state: Readonly<AgcActuatorDecoderState>,
  events: Readonly<AgcActuatorTickEvents>,
): AgcActuatorDecoderResult {
  const reasons: AgcActuatorInvalidReason[] = [];
  const push = (r: AgcActuatorInvalidReason) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  if (
    !Number.isInteger(events.missionTick) ||
    events.missionTick < 0 ||
    (state.lastMissionTick !== null && events.missionTick < state.lastMissionTick)
  ) {
    push("malformed-event");
  }
  if (!Number.isInteger(events.traceDropped) || events.traceDropped < 0) {
    push("malformed-event");
  } else if (events.traceDropped > 0) {
    push("trace-data-dropped");
  }

  const channels = reduceChannelStream(state, events.channelEvents);
  const counters = reduceCounterStream(state, events.counterEvents);
  for (const r of channels.reasons) push(r);
  for (const r of counters.reasons) push(r);

  const engineCommand = channels.engineCommand;
  if (engineCommand === "none") push("no-engine-command");
  if (engineCommand === "conflict") push("contradictory-engine-command");

  // ALWAYS: the DPS throttle magnitude scale is unresolved.
  push("throttle-scale-unresolved");

  const engineEnabled: boolean | null =
    engineCommand === "on" ? true : engineCommand === "off" ? false : null;

  const control: AgcCommandedControl = {
    engineCommand,
    engineEnabled,
    throttleFraction: null,
    valid: false,
    invalidReasons: reasons,
    sampledAtMissionTick: events.missionTick,
    thrustDriveActivity: {
      observedThisTick: channels.thrustDriveObserved,
      eventCount: channels.thrustDriveEventCount,
    },
    raw: {
      channel11: channels.channel11,
      channel14: channels.channel14,
      thrustCounter: counters.events,
    },
  };

  const nextState: AgcActuatorDecoderState = {
    kind: "agc-actuator-decoder-state-v0",
    engineCommand,
    lastChannel11Value: channels.lastChannel11Value,
    lastChannel14Value: channels.lastChannel14Value,
    lastChannelSequence: channels.lastSequence,
    lastCounterSequence: counters.lastSequence,
    lastMissionTick: events.missionTick,
    totalThrustEvents: state.totalThrustEvents + counters.events.length,
    totalDroppedTraceEntries:
      state.totalDroppedTraceEntries +
      (Number.isInteger(events.traceDropped) && events.traceDropped > 0
        ? events.traceDropped
        : 0),
  };

  return { nextState, control, thrust: counters.thrust, invalidReasons: reasons };
}
