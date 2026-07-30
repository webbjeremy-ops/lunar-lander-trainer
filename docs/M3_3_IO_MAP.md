# M3.3A1 — AGC ↔ LM I/O Source Mapping

Status: **A1 complete. STOP at gate. Do not proceed to A2.**

Reason: at least three signals required by any meaningful `descent-monitor-v1`
profile (landing-radar altitude, landing-radar velocity, DPS throttle
magnitude) are `unresolved` because the vendored emulator does not expose the
hardware path Luminary uses to receive/emit them. Per the approved plan,
implementation is blocked and this report is the deliverable.

## Pinned inputs

- Apollo-11 source: chrislgarry/Apollo-11 @ `911e5c0283c629c50cb97666f34065e8c07d71a5`
  (verified via `git rev-parse` on a fresh clone; matches
  `scripts/build-luminary099.sh` and `docs/rope-reproduction.md`).
- Emulator: `src/third-party/webagc/yaAGC.wasm`,
  SHA-256 `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14`,
  from michaelfranzl/webAGC @ `0575ea7a1231e3948bae7d2c22a6ac146da0c38d`.
- Emulator API surface (see `src/sim/agc/AgcCoreAdapter.ts`):
  - `packet_write(channel: u16, data: u16)` — write to an AGC I/O channel
  - `packet_read() -> u32` — pop next `channel<<16 | value` output packet
    from yaAGC's output queue; empty when both halves are zero
  - `cpu_step(n)` — advance CPU by `n` instructions
  - `cpu_reset()` — reset AGC
  - `get_erasable_ptr()` — pointer to 2048 × u16 erasable memory
  - `set_fixed(ptr)` — install rope
  - No exported function drives PIPA/CDU/RADAR **counter increments**
  - No exported function fires **RADARUPT**, **T3RUPT**, **T4RUPT**, **KEYRUPT**,
    or any other unprogrammed sequence beyond what channel-15 keycode writes trigger
  - No hook observes writes to **output counter cells** (e.g. `THRUST=0o55`,
    `CDUXCMD/CDUYCMD/CDUZCMD=0o50..0o52`); those move via unprogrammed
    sequences that never enter the packet queue

## Hardware-vs-test injection labels

- **hardware-model**: a `packet_write` (or `packet_read`) call that maps
  one-to-one onto the physical bus event Luminary was written to receive
  (or emit). Suitable for a production monitor profile.
- **test-only**: a direct erasable-memory poke, or any injection that
  bypasses the interrupt/counter path Luminary expects. May be useful for
  isolated unit tests but MUST NOT back a production monitor profile —
  Luminary will not run its RUPT handler, will not update derived state,
  and its behaviour will diverge from the real hardware path.

## Signal table

Every row cites `Luminary099/<file>:<line>` at the pinned commit.

### Inputs (LM → AGC)

| # | Signal | AGC address | Update mechanism | Emulator API | H/W-vs-test | Init prerequisites | Valid state | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Landing-radar altitude | counter `RNRAD` (erasable); RUPT via `RADARUPT` handler `RADAREAD`. Source: `Luminary099/P20-P25.agc:2797` (`# THIS ROUTINE STARTS FROM A RADARUPT.`), `:2809` (`RAND CHAN13`), `:2811` (`CA RNRAD` / `TS DNRRANGE-1`); channel 33 status bits at `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:182-190` (bit 5 LR RANGE DATA GOOD, bit 6/7 LR POS1/2, bit 8 LR VEL DATA GOOD, bit 9 LR RANGE LOW SCALE). LR select bits requested on channel 13; response arrives via RADARUPT with data in `RNRAD` and radar-select in `CHAN13` bits 1-3. | RADARUPT-driven counter fill + CHAN33 discretes | **None available.** Would need (a) a way to fire RADARUPT and (b) a way to load `RNRAD` at RUPT time. `packet_write(0o33, …)` can inject the CHAN33 status discretes, but cannot inject the range word or fire the interrupt. `get_erasable_ptr()` write to `RNRAD` would be **test-only** and would not cause `RADAREAD` to run. | test-only if attempted via erasable poke; no hardware-model path | LR power on, LR mode select via CHAN33, R12 landing radar task active (P63/P64), LRPOS1/POS2 valid | valid only when CHAN33 bit 5 asserted (data good) and LR position matches expected (see `P20-P25.agc:5146` `CA LRALTBIT`) | **unresolved** — no emulator API to drive RADARUPT + counter |
| 2 | Landing-radar velocity (Vx, Vy, Vz beams) | `RNRAD` shared with altitude on each RADARUPT, tagged by CHAN13 select bits 1-3 (`P20-P25.agc:2848-2860` `VELCHK`); CHAN33 bit 8 = LR VEL DATA GOOD | Same as (1). | Same as (1). | test-only only | Same as (1) plus velocity-beam acquisition | valid when CHAN33 bit 8 = 1 and CHAN13 select bits select a velocity beam | **unresolved** — same root cause |
| 3 | PIPA (∫accel) increments X/Y/Z | erasable counters `PIPAX=0o37`, `PIPAY=0o40`, `PIPAZ=0o41` (`ERASABLE_ASSIGNMENTS.agc:122-124`); serviced by `READACCS` under Servicer at 2Hz; underlying delivery is Pinc/Minc unprogrammed sequences at IMU pulse cadence | Pinc/Minc unprogrammed sequence per accelerometer pulse; overflow discretes on CHAN33 bit 13 (PIPA FAIL) | **None.** webAGC does not expose Pinc/Minc; an erasable poke to `0o37/0o40/0o41` writes the accumulator but does not model the pulse arithmetic Luminary depends on (READACCS reads and zeros in one instruction; a missed race gives incorrect ΔV). | test-only if attempted; no hardware-model path | IMU on and fine-aligned; IMU-CDU healthy (CHAN30 bit 9, bit 12/13 clear) | valid only when CHAN33 bit 13 clear | **unresolved** |
| 4 | IMU CDU angles X/Y/Z | erasable counters `CDUX=0o32`, `CDUY=0o33`, `CDUZ=0o34` (`ERASABLE_ASSIGNMENTS.agc:117-119`) | Pinc/Minc from CDU shaft encoders | **None.** Same class as (3). | test-only | IMU coarse+fine align complete | CHAN30 bit 12 = 0 (IMU CDU good) | **unresolved** for closed-loop attitude; not required by monitor profile v1 |
| 5 | Master timing HISCALAR/LOSCALAR | input channels `HISCALAR=0o3`, `LOSCALAR=0o4` (`ERASABLE_ASSIGNMENTS.agc:157-158`; `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:36-44`) | 33-stage binary counter | webAGC ticks these internally on `cpu_step`; no explicit API is required nor available | hardware-model (implicit, provided by emulator) | none | always valid | mapped |
| 6 | TIME1-TIME6 counters | erasable `TIME1..TIME6 = 0o25..0o31` | driven by emulator internally | none required | hardware-model (implicit) | none | always valid | mapped |
| 7 | Engine ARMED discrete (input) | `CHAN30 bit 3` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:152`, inverted-sense: 0=asserted, header at :146-148) | steady-state channel bit, read via `RAND CHAN30` (`BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:916`) | `packet_write(0o30, mask)` — one-to-one with the hardware bus bit; inversion documented in source | hardware-model | none | always valid | mapped |
| 8 | AUTO THROTTLE (computer thrust control) discrete | `CHAN30 bit 5` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:154`) | steady-state | `packet_write(0o30, …)` | hardware-model | none | always valid | mapped |
| 9 | LGC-in-control discrete | `CHAN30 bit 10` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:159`) | steady-state | `packet_write(0o30, …)` | hardware-model | none | always valid | mapped |
| 10 | ISS operate / stable-member temp / IMU health | `CHAN30 bits 9,11,12,13,14,15` (`:158-164`) | steady-state | `packet_write(0o30, …)` | hardware-model | none | valid | mapped |
| 11 | RR CDU FAIL / spare / abort discretes | `CHAN30 bits 1,4,7` | steady-state | `packet_write(0o30, …)` | hardware-model | none | valid | mapped (not needed for descent monitor v1 but available) |
| 12 | LR status discretes (RANGE GOOD, VEL GOOD, POS1/2, RANGE LOW SCALE) | `CHAN33 bits 5,6,7,8,9` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:184-188`) | steady-state | `packet_write(0o33, …)` | hardware-model **for the discretes only**; the accompanying range/velocity WORD path is (1)/(2) and is unresolved | none | valid | mapped for discretes; unusable in isolation because signal (1)/(2) is unresolved |
| 13 | PROCEED / RSET / DSKY keycode | `CHAN32 bit 14`, `CHAN15 bits 5-1` | KEYRUPT triggered by writing CHAN15; PROCEED is active-low on CHAN32 | `packet_write(0o15, keycode)` and `packet_write(0o32, mask)` — already exercised by `AgcCoreAdapter.keyPress/proceedKey` | hardware-model | none | valid | mapped |

### Outputs (AGC → LM)

| # | Signal | AGC address | Update mechanism | Emulator API | H/W-vs-test | Init prerequisites | Valid state | Status |
|---|---|---|---|---|---|---|---|---|
| 14 | Engine ON discrete | `CHAN11 bit 13` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:78-96` block; also `FLAGWORD_ASSIGNMENTS.agc:651 ENGONBIT=BIT7` on ENGONFLG side; hardware bit is CHAN11 bit 13 per bit map) — driven from `BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:415` (`MASK ENGONBIT`), `P70-P71.agc:153`, `FINDCDUW--GUIDAP_INTERFACE.agc:306` | packet write by AGC on CHAN11 | Observed via `packet_read()`; captured losslessly per tick (see amendment §2) | hardware-model | AGC must run BURN sequence; Engine ARMED (input #7) may be a Luminary precondition | valid always; interpretation depends on Engine ARMED | mapped |
| 15 | Engine OFF discrete | `CHAN11 bit 14` | same as (14) | Observed via `packet_read()` | hardware-model | none | valid | mapped |
| 16 | DSKY relay row & lamp bus | `CHAN10` (5-bit RRRR row + 11 relay bits) and `CHAN11 bits 1-7` (individual lamps) — already decoded by `src/agc/dsky/*` at M2 freeze | packet write by AGC | `packet_read()` — already consumed by frozen DSKY path | hardware-model | none | valid | mapped (frozen, do not modify) |
| 17 | DPS throttle command **magnitude** | erasable **output counter cell** `THRUST=0o55` (`ERASABLE_ASSIGNMENTS.agc:137`); written by `TS THRUST` in `THROTTLE_CONTROL_ROUTINES.agc:127`; delivered to DPS as a **pulse train via Pcdu/Mcdu unprogrammed sequences**, not as a channel packet | output-counter unprogrammed sequence | **None.** `packet_read()` never sees writes to counter cells. `get_erasable_ptr()` can read address 0o55 after every `cpu_step`, but the value at that address is the *residual* (the counter is drained by the hardware pulse mechanism each tick) — snapshotting it does not reconstruct the commanded pulse magnitude. Reconstructing throttle demand from residual reads would be **test-only** and not source-supported. | test-only if attempted via erasable read; no hardware-model path | none for observation, but Luminary only writes it under P63/P64 with correct guidance state | valid only when CHAN14 bit 4 (THRUST DRIVE ACTIVITY) asserted (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:113`) | **unresolved** — no emulator API observes the counter pulse train |
| 18 | Thrust drive activity discrete | `CHAN14 bit 4` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:113`); written via `WOR CHAN14` at `LANDING_ANALOG_DISPLAYS.agc:500`, `IMU_MODE_SWITCHING_ROUTINES.agc:251` | packet write | `packet_read()` capture; feed through decoder | hardware-model | descent-guidance active | valid | mapped (observable, but partial — cannot recover magnitude without #17) |
| 19 | ALT / ALTRATE meter select | `CHAN14 bit 2` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:111`); `LANDING_ANALOG_DISPLAYS.agc:55` (`WOR CHAN14 # ALTRATE (BIT2=1), ALTITUDE (BIT2=0)`) | packet write | `packet_read()` | hardware-model | none | valid | mapped |
| 20 | ALT / ALTRATE meter activity | `CHAN14 bit 3` (`:112`); `LANDING_ANALOG_DISPLAYS.agc:89` | packet write | `packet_read()` | hardware-model | none | valid | mapped |
| 21 | Gyro torque enable / axis select / sign / activity | `CHAN14 bits 6-10` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:115-119`) | packet write | `packet_read()` | hardware-model | fine-align active | valid | mapped (not needed for descent monitor v1 but observable) |
| 22 | CDU drive pulses X/Y/Z/S/T | `CHAN14 bits 11-15` (`:120-124`) plus output counters `CDUXCMD=0o50 / CDUYCMD=0o51 / CDUZCMD=0o52` (`ERASABLE_ASSIGNMENTS.agc:131-133`) | discrete enable via CHAN14 + counter-pulse magnitude via unprogrammed sequences on 0o50-0o52 | discrete enable observable via `packet_read()`; **magnitude unresolved** (same class as #17) | discrete mapped; magnitude test-only if attempted | none | valid | mapped-partial — enable bit only |
| 23 | RCS jets (pitch/roll) | `CHAN5` (PYJETS bits 1-8), `CHAN6` (ROLLJETS bits 1-8) (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:50-53`) | packet write | `packet_read()` | hardware-model | DAP running | valid | mapped (out of monitor-v1 scope) |
| 24 | Downlink telemetry words | `CHAN34 DNT M1`, `CHAN35 DNT M2` (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:192-193`) | packet write | `packet_read()` | hardware-model | downlink program active | valid | mapped (out of monitor-v1 scope) |

## Expected sensor-to-output latency

For any monitor profile that includes signal (1) or (17), the latency is
**undefined at this layer**, because the sensor injection or output observation
path is not implemented by the emulator. For the mapped input discretes
(#7-#12) driving `RAND CHANxx`-style branches, Luminary polls at Servicer /
T4RUPT cadence (2 Hz for Servicer, 120 ms for T4RUPT loop over CHAN30 per
`T4RUPT_PROGRAM.agc:243-276`), so a discrete flip is visible on the next
Servicer or T4RUPT pass — ≤ 3 mission ticks at 20 ms cadence for T4RUPT
polling, ≤ 25 ticks for Servicer.

## Monitor profile `descent-monitor-v1` — required signals

To meaningfully observe P63/P64 powered descent, a monitor profile needs:
LR altitude (#1), LR velocity (#2), LR discretes (#12), PIPA increments (#3),
CDU angles (#4), TIME counters (#5-#6, implicit), Engine ARMED / AUTO
THROTTLE / LGC-in-control / IMU-good discretes (#7-#10), Engine ON/OFF (#14/#15),
throttle magnitude (#17), thrust-drive activity (#18).

Of those, **#1, #2, #3, #4, #17 are unresolved** with the vendored emulator.
`descent-monitor-v1` therefore **cannot be entered** under the amendment's
atomicity rule ("Unresolved required mappings cause an atomic `monitorBlocked`
result — no partial undocumented coupling").

## What could plausibly be built in a future A2 (do not build yet)

A degenerate `discrete-observer-v0` profile could be defined that only:

1. Injects CHAN30/CHAN31/CHAN32/CHAN33 discretes (all `hardware-model`),
2. Captures every write to CHAN5/CHAN6/CHAN10/CHAN11/CHAN14/CHAN34/CHAN35
   losslessly per tick via ordered `packet_read()` draining,
3. Publishes them through the compact `AgcMonitorSnapshot` plus the separate
   `sim:requestMonitorTrace` bounded ring.

This would honour every amendment rule but would **not** produce a
descent-phase engine-command trace, because Luminary needs signals #1/#2/#3
before it will command descent. That is the expected, source-supported answer
if `discrete-observer-v0` is later approved for A2.

## Emulator gap — what closing it would require

Any of the following, in decreasing order of scope, would resolve the unresolved
rows:

1. Rebuild `yaAGC.wasm` from `virtualagc/virtualagc @ b6d27dc...` with additional
   exports for: (a) counter-increment API (`IncrementCounter(address, +1|-1)`
   equivalent to Pinc/Minc), (b) RUPT-fire API, (c) an output-counter
   observer callback. This is the physically correct path but is out of scope
   here — it needs the Emscripten toolchain and byte-identical reproduction
   discipline documented in `docs/rope-reproduction.md`.
2. Vendor a different yaAGC build that already exports the above (none known
   in the pinned upstream tree).
3. Explicitly re-scope the milestone to only observe discretes (see
   `discrete-observer-v0` above).

## A1 gate — decision

Per approved plan: **stop and report**. No encoder, decoder, Worker change,
or protocol change written. No files under `src/simulation/agcio/` created.
No `sim:` protocol bump.

---

## M3.3B addendum — supersedes parts of the above

See `docs/M3_3B_SOURCE_ARCHAEOLOGY.md` for the full pinned-source evidence.

Resolved since this document was written:

- Item 1 above is **done**: `yaAGC-ext.wasm` (`hwio-v2`) exports
  `agc_counter_increment` and ordered batched `agc_hw_input_apply`, plus a
  lossless output-counter trace ring. Sub-item (b), the RUPT-fire API, was
  **not** implemented and is the remaining radar blocker.
- Counter addresses: PIPAX/Y/Z `0o37`–`0o41` (PINC/MINC), IMU CDU `0o32`–`0o34`
  (PCDU/MCDU, 128-entry per-axis FIFO), shared radar `RNRAD` `0o46`
  (axis selected by CHAN13), `THRUST` `0o55` (output, throttle command).
- **Polarity correction:** `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:143-144`
  states every bit in channels 30-33 is inverted. Earlier text in this document
  treating CHAN33 landing-radar bits as active-high was wrong; all CH30-33 rows
  are `active-low` ("0 means signal present").

Still unresolved, keeping `descent-monitor-v1` blocked: PIPA pulse weight,
IMU CDU angular LSB, `RADARUPT` generation, DPS throttle magnitude.

---

## M3.3B2 addendum — HW-I/O v3, radar cadence, and corrected THRUST

This addendum supersedes any earlier statement in this document that
conflicts with it. Every claim below is traced to pinned source
(`chrislgarry/Apollo-11 @ 911e5c0`, `virtualagc @ ddc65e7be`) or to a primary
document recorded in `docs/M3_3B2_SCALE_ARCHAEOLOGY.md`.

### RADARUPT — corrected history

Earlier text said "no emulator API drives RADARUPT". Precisely:
`yaAGC/agc_engine.c` already wires interrupt vector `04044` to
`InterruptRequests[9]`, but nothing inside the emulator ever *sets* that
latch. HW-I/O **v3** adds `agc_request_hardware_interrupt` (allow-listed to
index 9 only) and `agc_landing_radar_update_apply`, which performs the serial
RNRAD load and then sets the native latch. Delivery, priority, `INHINT`
holding and `RELINT` release are left entirely to the emulator's own
dispatcher; the host never writes Z and never forces handler entry.
Proven by `src/sim/agc/__tests__/hwioRadarInterrupt.test.ts` (13 tests).

### RNRAD (0o46) — complete representation

| Property | Value | Source |
|---|---|---|
| Address | `0o46` | `SERVICER.agc` / `P20-P25.agc` `RNRAD` |
| Counter type | shift counter, `CounterSHINC`/`CounterSHANC` | `yaAGC/agc_engine.c:1292-1316` |
| Retained width | 14 bits, mask `0o37777` | same |
| Serial bits per transaction | 15 | PSA serial read; only low 14 retained |
| Sign | unsigned magnitude for LR RANGE; Luminary masks with `POSMAX` before use | `P20-P25.agc` RADIN (`CAF POSMAX` / `MASK RNRAD`) |
| Replacement semantics | serial shift replaces the word; no accumulate | `CounterSHINC` |
| Range bit weight | **1.079 ft/bit** | `CONTROLLED_CONSTANTS.agc` `HSCAL`; confirmed in-line by `SERVICER.agc` LRHJOB comment "LRH DATA 1.079 FT/BIT" |
| Valid host range | `0 … 0o37777` counts | derived from retained width |
| Out-of-range behaviour | **host refuses to emit**; no wrap | no source specifies wrapping, so refusal is the conservative correct behaviour |

### Landing-radar update cadence — UNRESOLVED (profile blocked)

The read is **AGC-solicited**, not host-timed:

- `P20-P25.agc` INITREAD (p. 554): `CS ALLREAD` / `WAND CHAN13` clears the
  radar bits, then `WOR CHAN13` sets the select code + **ACTIVITY (bit 4)**.
  `ALLREAD OCT 17`; lead-ins `LRALT OCT 17`, `LRVELZ 16`, `LRVELY 15`,
  `LRVELX 14`, `RRRANGE 11`.
- CHAN13 bits 1-3 = RADAR A/B/C select, bit 4 = RADAR ACTIVITY
  (`INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc`, p. 56).
- `P20-P25.agc` RADAREAD (p. 555): the RADARUPT handler reads `RNRAD`,
  checks the CHAN33 DATA GOOD bit, and resets the ACTIVITY bit
  (`RXOR CHAN13` / `WOR CHAN13`). **One RADARUPT delivers one data word**,
  selected by CHAN13 bits 1-3 — not a multi-component packet.
- Ordering per transaction: select+activity write → PSA serial fill of RNRAD
  → RADARUPT → handler reads counter → DATA GOOD checked *after* the read
  ("DATA GOOD ISN'T CHECKED UNTIL AFTER READING DATA").
- `SERVICER.agc` LRHTASK (p. 872): the altitude read is a WAITLIST task "set
  by READACCS during the descent braking phase when the ALT to the lunar
  surface is less than 25,000 FT ... 50 MS prior to the next READACCS task".
- `SERVICER.agc` LRHJOB (p. 892): sampling window "about 95 MS", one sample
  per reading (`LRALT TC INITREAD -1`).
- `SERVICER.agc` LRVJOB (p. 892): velocity is 5 samples, ~500 ms, beams
  sequenced by `VSELECT`, only below 15,000 ft.

Because the schedule is phased to READACCS — the PIPA-driven SERVICER cycle —
and the PIPA ΔV pulse weight remains unresolved, **no host-side cadence is
source-supported**. `landing-radar-observer-v1` is therefore atomically
blocked with `radar-update-cadence-unresolved`. The 250 ms encoder constant
survives only as `LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US`, labelled
"NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE", and is
consulted by tests only.

### CHAN14 / THRUST (0o55) — corrected interpretation

`THRUST_CONTROL_ROUTINES.agc` `FRATE` gives the counter rate of **32 units
per centisecond (3200/s)**. LMA790-3-LM §2.1.3.1 establishes that the DECA
**analog-sums** the LGC digital throttle command with the TTCA manual
command. The CHAN14/THRUST pulse train is therefore an *incremental LGC
throttle-command delta into the DECA summing junction* — **not** a thrust,
not a force, and not a percentage. `throttleFraction` stays `null`; no
pounds-force, newton or percentage value may be displayed.

### CDU angular scales (resolved; not yet used)

Fine mode 20 arc-sec/pulse, Δθc word 40 arc-sec, coarse-align increment
160 arc-sec (LMA790-3-LM §2.1.4.1.3). The frequently-repeated
**39.3 arc-sec figure is disputed and is NOT adopted**.

### Still unresolved (registry rows remain `unresolved`)

1. PIPA ΔV per pulse — absent from every primary page opened.
2. CDU FIFO drain budget over a 20 ms mission tick.
3. TTCA fixed throttle bias — described qualitatively only.
4. Physical force per THRUST count.
5. LR velocity-beam / CHAN13 beam-select sequencing as a host transaction.

A registry row becomes `mapped` only when a citation supports it; deleting a
policy string is never sufficient — `decideMonitorEntry` re-derives blocks
from `sensorRegistry` on every call.

---

## M3.3C addendum — PIPA ΔV pulse weight RESOLVED (supersedes "still unresolved" item 1)

**1 PIPA pulse = 1.00 cm/s = 0.01 m/s (Lunar Module).**

Primary: Draper Lab, *Design Survey of the Apollo Inertial Subsystem*
(March 1970, NTRS `19700018941`), Fig. 4-3 "PIP Accelerometer Block Diagram",
PDF p.66 — verbatim `AV COMMAND MODULE 5.85 CM/SEC/PULSE` /
`AV LEM 1.0 CM/SEC/PULSE`. The 5.85 cm/s figure that blocked M3.3B2 is the
**Command Module** weight and was never applicable to the LM.

Independent rope derivation: `Luminary099/SERVICER.agc:192` declares
`ABDELV = CM/SEC*2(-14)` and `:219` `CA KPIP1 # TP MPAC = ABDELV AT 2(14)
CM/SEC`; `ABDELV` is formed from the raw `PIPAX/Y/Z` counter difference with
no intervening scale, so one count is one cm/s.

Registry effect: the discrete row `unresolved.pipa-increments` is deleted and
replaced by three `mapped` rows in the new `MONITOR_COUNTER_REGISTRY`
(`pipa.x/y/z.delta-v-pulse`, counters `0o37`/`0o40`/`0o41`, PINC/MINC,
0.01 m/s per pulse). `docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md` is the evidence
record.

`descent-monitor-v1` REMAINS BLOCKED. The blockers are now:

1. Stable-member ↔ LM body axis bootstrap (REFSMMAT + initial CDU angles) not
   source-proven for the golden scenario.
2. CDU angle pulse weight usage + drain budget (`cdu.x/y/z.angle` rows remain
   `unresolved`).
3. LR velocity-beam / CHAN13 beam-select sequencing.
4. Physical force per THRUST count (unchanged; the pulse train is an
   incremental DECA throttle-command delta, not a force).
