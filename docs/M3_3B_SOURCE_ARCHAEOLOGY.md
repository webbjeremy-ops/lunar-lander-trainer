# M3.3B — Authentic descent-input resolution: source archaeology and gate decision

SPDX-License-Identifier: GPL-3.0-or-later

Pinned evidence base (no other sources were consulted for normative claims):

- Rope: `chrislgarry/Apollo-11` @ `911e5c0283c629c50cb97666f34065e8c07d71a5` (Luminary 099)
- Emulator: `virtualagc` @ `ddc65e7be` (+ `apollo-browser-hwio-v2` patch)

**Outcome: `descent-monitor-v1` remains BLOCKED.** `discrete-observer-v0` remains the
highest activatable monitor profile. Two independent blockers are documented below,
each of which is a genuine unresolved-source / emulator-capability issue rather than
an implementation gap. No numeric constant in this document was invented, rounded from
memory, or imported from secondary literature.

---

## Phase 1 — Real Luminary dependencies for a 1-D descent

`SERVICER` (average-G) is the only altitude/velocity ingestion path Luminary 099 uses
during P63/P64. It is driven by:

| Dependency | AGC path | Counter | Status |
|---|---|---|---|
| PIPA ΔV accumulation | `SERVICER` → `READACCS` → `DELV*` | `0o37`–`0o41` (PIPAX/Y/Z), PINC/MINC | **blocked** (Phase 2) |
| IMU CDU angles | `FINDCDUW` body-frame transform | `0o32`–`0o34`, PCDU/MCDU (128-entry FIFO) | **blocked** (Phase 2) |
| Landing radar altitude / velocity | `R12` / `LRS22.1` | `RNRAD` `0o46` + `RADARUPT` | **blocked** (Phase 2) |
| Discretes (CH30/CH31/CH33) | direct channel reads | n/a — plain input channels | **resolved, shipped** |

Consequence: a monitor profile cannot feed authentic altitude/velocity to Luminary
without PIPA, CDU **and** radar. Discretes alone cannot move `SERVICER` state.

## Phase 2 — Blockers

### 2.1 PIPA pulse weight — UNRESOLVED in pinned sources

Citable constants found:

- `Luminary099/CONTROLLED_CONSTANTS.agc:174` — `KPIP DEC .0512 # SCALES DELV TO UNITS OF 2(5) M/CS.`
- `:175` — `KPIP1 2DEC .0128 # SCALES DELV TO UNITS OF 2(7) M/CS.`
- `:176` — `KPIP2 2DEC .0064 # SCALES DELV TO UNITS OF 2(8) M/CS.`
- `:190` — `KPIP1(5) DEC .0512 # SCALES DELV TO M/CS*2(-5).`
- `IMU_COMPENSATION_PACKAGE.agc:54` — `MP DELVX # (PP) X 2(+14) NOW (PIPA PULSES) X 2(+5)`
- `IMU_COMPENSATION_PACKAGE.agc:61` — `TS DELVX+1 # FRACTIONAL PIPA PULSES SCALED 2(+14)`

These are *fixed-point rescaling* coefficients. Turning them into a physical
"cm/s per PIPA pulse" requires an unstated assumption about which binary scaling
convention `DELV` carries at each site. The pinned repositories contain **no**
statement of the pulse weight in physical units (exhaustive grep: no `5.85`,
no `CM/SEC` pulse-weight comment).

`PIPADT` / `1/PIPADT` / `PIPTIME` appear only as erasable register references
(`IMU_COMPENSATION_PACKAGE.agc:72,219,316,319,398,400`;
`ERASABLE_ASSIGNMENTS.agc:2446-2447,2581`) with no `DEC`/`OCT` literal.
The guidance period is citable (`IMU_COMPENSATION_PACKAGE.agc:397` `CAF PRIO31 # 2 SECONDS SCALED (CS) X 2(+8)`;
`THROTTLE_CONTROL_ROUTINES.agc:143` "PGUID IS EITHER 1 OR 2 SECONDS") but the
per-pulse ΔV is not.

**Decision: do not fabricate.** Injecting PINC/MINC at a guessed weight would make
Luminary's displayed altitude a fiction while looking authentic — the exact failure
mode this project forbids.

### 2.2 IMU CDU pulse weight — UNRESOLVED

`FINDCDUW--GUIDAP_INTERFACE.agc` (full file) discusses CDU angles only in "units of
PI" (lines 84, 314-369) and contains no counts-per-revolution or degrees-per-pulse
literal. `yaAGC/agc_engine.c` `CounterPCDU`/`CounterMCDU`/`PushCduFifo`
(lines 1547-1580) are unit-agnostic register operations.

### 2.3 Landing-radar delivery path — EMULATOR LIMITATION

The *scaling* is resolved and citable:

- `CONTROLLED_CONSTANTS.agc:164` — `HSCAL 2DEC -.3288792 # SCALES 1.079 FT/BIT TO 2(22)M.` (LR altitude, **1.079 ft/bit**)
- `:168-170` — `VZSCAL .8668`, `VYSCAL 1.212`, `VXSCAL -.644` FT/SEC/BIT → `2(18) M/CS`
- `P20-P25.agc:3314-3315` — RR range 9.38 ft/bit (low) / 75.04 ft/bit (high); range-rate .6278 ft/s/bit
- `P20-P25.agc:3030` — `HISCALIM DEC 460 # 2481.7 FT`

The *delivery* is not. `RNRAD` (`0o46`) is a single shared counter whose axis is
selected by CHAN13, and the AGC learns a sample arrived via the `RADARUPT`
interrupt. Confirmed by exhaustive grep of `yaAGC/agc_engine.c` (3452 lines):
the tokens `RNRAD` and `RADARUPT` **do not appear**, and channel `013` is
referenced only for standby/warning bits (lines 1672, 2006, 2062, 2148, 2155,
2215, 2609). The CPU engine has no radar-select or RADARUPT generation; those
belong to a peripheral simulator that does not exist under the pinned commit.

Our `hwio-v2` patch exports generic `agc_counter_increment` / `agc_hw_input_apply`,
which can increment `0o46` — but cannot raise `RADARUPT`. Without the interrupt,
Luminary never reads the counter. Closing this needs an `hwio-v3` interrupt-request
export, which is out of M3.3B scope and would break the P3 parity freeze.

### 2.4 THRUST magnitude — still UNRESOLVED (unchanged from P5.c)

`THROTTLE_CONTROL_ROUTINES.agc:126-127` (`TS PSEUDO55` / `TS THRUST`) confirms
`0o55` receives the *throttle command* PIF, not a force. Related citables:
`CONTROLLED_CONSTANTS.agc:128-129` `FMAXODD DEC +3841 # FSAT +4.81454413 E+4`,
`FMAXPOS DEC +3467 # FMAX +4.34546769 E+4`;
`THROTTLE_CONTROL_ROUTINES.agc:143` (32 units/centisecond), `:191` `FLATOUT ... # 4096 PULSES`,
`:222` `/AF/CNST DEC .13107`. The `FMAX*` pairs imply a consistent ~12.534
units-per-count ratio, but the physical unit of `4.81454413 E+4` is never stated in
the pinned rope, and no DECA / descent-engine simulator source exists under the
pinned `virtualagc` commit. `throttleFraction` therefore stays `null`.

---

## Phases 3–8 — What changed in this milestone

Only one behavioural change was made, and it is a **defect correction** backed by
source, not a new capability:

> `Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc:143-144` —
> "ALL BITS IN CHANNELS 30-33 ARE INVERTED AS SENSED BY THE PROGRAM, SO THAT A
> VALUE OF ZERO MEANS THAT THE INDICATED SIGNAL IS PRESENT."

Previously the CHAN33 landing-radar rows in `sensorRegistry.ts` were modelled
`active-high`. They are now `active-low`, like CHAN30/31. The encoder was
refactored from `logicalLevelFor` (ambiguous "logical level") to
`signalPresentFor` ("is the physical signal asserted"), so polarity inversion
happens in exactly one place and cannot be double-applied.

Also added, as genuinely separate physical signals rather than derived flags:
`imuCduHealthy`, `pipaHealthy`, `landingRadarRangeLowScale`.

Unchanged and re-verified: the 12-phase mission-tick order, the
`ResolvedPhysicsControl` symbol-branded physics firewall (AGC output can never
reach the LM integrator), Worker-owned monitor state, the authoritative input
channel shadow, and simulation protocol v2.

## Phase 9 — Gates

- `src/simulation/agcio` Vitest: 83/83, including new polarity and
  no-double-inversion regressions for IMU FAIL / PIPA FAIL.
- Typecheck clean.
- `profileValidation.ts` continues to refuse `descent-monitor-v1` while
  `unresolvedSignalsForProfile("descent-monitor-v1")` is non-empty. Per 2.1–2.3 it
  is still non-empty, so the block is load-bearing, not decorative.

## Unblocking conditions

`descent-monitor-v1` becomes implementable when **all** of:

1. A citable physical PIPA pulse weight (or an explicit project decision to adopt a
   documented, clearly-labelled non-rope source).
2. A citable IMU CDU angular LSB.
3. An `hwio-v3` export able to request `RADARUPT` alongside `RNRAD`, re-passing the
   P3 six-scenario bit-identity parity suite.
