# M3.3 — AGC ↔ LM I/O, Monitor Mode Only (revised)

Freeze respected: M2, M3.1 kernel, and M3.2 MissionRuntime + `sim:` protocol v1 remain untouched. Monitor mode is strictly observational — the AGC watches; it does not fly.

## Substep split

**M3.3A1 — Source mapping only.** Deliverable: `docs/M3_3_IO_MAP.md`. No encoder, decoder, Worker change, or protocol change is written until A1 is accepted. If any required signal is `unresolved` at the end of A1, **stop and report** — do not proceed to A2.

**M3.3A2 — Implementation of fully mapped signals.** Only rows marked `mapped` in A1 become code. Rows marked `unresolved` block the monitor profile that requires them; entering that profile fails atomically.

**M3.3B — Closed-loop.** Out of scope. Requires explicit approval after A2 report.

## M3.3A1 — Source mapping

`docs/M3_3_IO_MAP.md` has one row per signal. Every row must carry:

- Signal name and direction (AGC-in / AGC-out).
- Luminary099 source citation: file + line at pinned commit `chrislgarry/Apollo-11 @ 911e5c0`.
- AGC channel or counter (octal), bit range, sign convention, scale factor with units, and cadence.
- Update mechanism: counter increment (PIPA/RUPT), channel packet, discrete bit, erasable location.
- Emulator injection/read API in vendored webAGC (`packet_write`, `packet_read`, counter tick, erasable poke) with the exact function signature used.
- Initialization prerequisites (major mode/program, DSKY sequence, IMU coarse/fine align, radar acquisition discrete, engine-arm discrete, erasable initialization).
- Valid vs. invalid states (e.g. radar altitude valid only when acquisition discrete asserted).
- Whether the chosen injection **models real hardware** or is **test-only**. Any erasable-memory poke is labeled `test-only` unless the mapping proves the write path faithfully reproduces the hardware path Luminary expects. Test-only injections cannot back a production monitor profile.
- Status: `mapped` or `unresolved` with the specific open question.

Signals in scope: descent-phase altitude (landing radar altitude counter), altitude-rate / vertical velocity (LR velocity beams or PIPA-derived), engine-on discrete, descent-engine throttle command path (channel 014 DESCENT counter — bit weight and cadence must come from source), engine-arm discrete, radar-data-valid discrete, whatever guidance-cycle heartbeat (R10/R11 or equivalent) is required to interpret output cadence.

Explicitly out of A1: IMU fine-structure beyond what descent guidance consumes; RCS/attitude channels; abort discretes beyond what monitor mode observes.

Report at end of A1 lists, per signal: mapping status, source location, emulator API, hardware-vs-test label, required mission-state init, and expected sensor-to-output latency (in ticks).

## M3.3A2 — Implementation (only if A1 clears)

### Tick order (enforced in the Worker, replaces M3.2 order for monitor-mode ticks; manual-mode ticks unchanged)

1. Apply deterministic mission commands (drain queue at tick boundary).
2. Sample LM state at tick start.
3. Encode and inject mapped sensor inputs into the AGC.
4. Advance AGC through the 20 ms tick.
5. Losslessly capture every relevant AGC output write during that tick, in order (event id + tick + channel + value); feed each through the pure actuator decoder.
6. Latch the final validated monitor command; append meaningful transitions to the bounded trace ring.
7. Advance LM physics using unchanged M3.2 scenario/manual control. **`stepLmPhysics` never sees the AGC command.**
8. Latch touchdown.
9. Publish coalesced snapshot.

### Modules

- `src/simulation/agcio/sensors/` — pure encoders: `LmPhysicsState → EncodedSensorFrame`. One function per mapped sensor, unit-tested for sign, scale, saturation, and cadence gating.
- `src/simulation/agcio/actuators/` — pure decoders: `(channel, value) → PartiallyDecodedOutput`, plus a reducer that folds an ordered stream of writes within one tick into a final `AgcCommandedControl | null`. Never called with a post-tick snapshot alone.
- `src/simulation/agcio/monitorProfile.ts` — the set of required sensors + prerequisites for a named profile (initially `descent-monitor-v1`). Missing/unresolved rows cause `monitorBlocked`.

### Worker changes (additive, monitor-mode only)

- New hook points in the mission pipeline for steps 2, 3, 5, 6 above. When monitor mode is inactive, the pipeline runs the frozen M3.2 order verbatim.
- Ordered output capture: install an ordered channel-write sink for the tick window and drain it after `cpu_step` returns; do not synthesize the trace from post-tick channel values.

### Protocol (bump `simulationProtocolVersion` from 1 to 2, additive only)

- New client→worker commands:
  - `sim:enterMonitorMode` — `{ commandId, simulationEpoch, applyAtMissionTimeUs, profile }`. Queued, epoch-bound, applied at a tick boundary. Fails atomically with `monitorBlocked` listing every unresolved required signal or unmet prerequisite; no partial injection.
  - `sim:exitMonitorMode` — same envelope.
  - `sim:requestMonitorTrace` — `{ requestId, sinceSequence? }`.
- New worker→client events:
  - `sim:monitorTrace` — `{ requestId, entries, droppedTraceEntries, headSequence }`.
  - `sim:monitorBlocked` — command ack variant with reasons.
- New handshake: `sim:ready` payload gains `simulationProtocolVersion`; client refuses to enter monitor mode on a version mismatch.
- Snapshots carry a **compact** `agcMonitor: AgcMonitorSnapshot | null`:
  ```ts
  interface AgcMonitorSnapshot {
    sequence: number;
    sampledAtTick: number;
    sensors: EncodedSensorSummary;         // small: latest injected values
    latestCommand: AgcCommandedControl | null;
    latestRawOutputs: RelevantChannelValues; // small, bounded set
    traceCount: number;
    droppedTraceEntries: number;
  }
  ```
  The full bounded trace is never inlined into snapshots; it is pulled via `sim:requestMonitorTrace`.
- **M2 AGC protocol messages and the event-log schema are not touched.** Monitor events remain outside M2 exports.

### Dev harness (`/dev/mission-runtime`)

- Mode toggle issues `sim:enterMonitorMode` / `sim:exitMonitorMode` (queued commands, not local UI state).
- Sensor-in panel: last encoded frame with units + raw octal.
- Actuator-out panel: `latestCommand` + `latestRawOutputs`.
- Trace viewer: pulls via `sim:requestMonitorTrace`, shows dropped-entry count.
- `monitorBlocked` reasons rendered verbatim.

### Determinism / parity acceptance (bit-for-bit)

- With monitor mode **off**, the M3.2 golden scenario produces `touchdownTimeUs = 368_279_425` and all previously locked checkpoints, unchanged.
- With monitor mode **on** (same scenario, unchanged manual/scenario control), every LM physics checkpoint, cumulative fuel use, and terminal touchdown time/classification is **bit-identical** to the monitor-off run. This is asserted in a Worker-level Vitest that compares full physics traces of both runs.
- A code-level assertion (test) proves `stepLmPhysics` is never called with a control value sourced from AGC output.

### Behavioral acceptance (not "plausible", but source-supported)

- Acceptance is: **the AGC output stream matches what the documented mission-state and injected inputs are sourced to produce.** If the documented initial state is insufficient (no program selected, radar not acquired, engine not armed, IMU not aligned, erasable not initialized), the correct A2 outcome is:
  1. Monitor mode enters successfully for the sensors it *can* inject.
  2. The recorded trace shows exactly what Luminary does under that state.
  3. The report enumerates every missing prerequisite blocking a descent-phase engine command, with source citations.
- We do **not** synthesize or coerce an engine-on / throttle>0 trace to satisfy acceptance.

### Test matrix

- Unit: each encoder (sign, scale, saturation, cadence), each decoder (bit layout, sign relays, invalid-state handling), ordered-write reducer (transient overwrite within a tick is preserved in the trace but only the final validated command is latched).
- Worker: mode-enter atomicity (`monitorBlocked` when a required row is unresolved); ordered capture across a synthetic multi-write tick; parity of monitor-on vs monitor-off physics traces.
- Playwright: `/dev/mission-runtime` — enter monitor mode, observe sensor frames and trace pulls; `workerBoots === 1` across navigation.

## Report-back gate (end of A2)

Post: every mapped and unresolved signal with source locations; emulator API used; hardware-vs-test label per injection; required mission-state initialization; observed sensor-to-output latency; the decoded output trace; whether descent-phase engine commanding is reachable from the current initial state and, if not, exactly which prerequisites are missing. **Closed-loop stays prohibited until explicit approval.**
