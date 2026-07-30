# M3.3B2 — Freeze report: HW-I/O v3, radar cadence resolution, THRUST correction

SPDX-License-Identifier: GPL-3.0-or-later

## Status: FROZEN. Closed-loop AGC control remains prohibited and absent.

## 1. Radar cadence — resolved as UNRESOLVED, profile stays blocked

The landing-radar read is **AGC-solicited**, never host-timed: `INITREAD`
(P20-P25.agc p.554) clears the CHAN13 radar bits and writes select+ACTIVITY;
`RADAREAD` (p.555) delivers exactly one selected word per RADARUPT. The
altitude read is scheduled by `LRHTASK` (SERVICER.agc p.872) 50 ms before the
next READACCS — i.e. phased to the PIPA-driven SERVICER cycle, whose ΔV pulse
weight is unresolved. Full citations: `docs/M3_3_IO_MAP.md` §M3.3B2 addendum
and `docs/M3_3B2_SCALE_ARCHAEOLOGY.md` addendum.

`landing-radar-observer-v1` is therefore **atomically blocked** with
`radar-update-cadence-unresolved`. The 250 ms constant survives only as
`LR_RANGE_NON_AUTHENTIC_TEST_CADENCE_US`, labelled
"NON-AUTHENTIC TEST CADENCE — NOT USED BY PRODUCTION PROFILE", consulted by
tests only; `LandingRadarObserverInputs.cadenceUs` is required with no default.

## 2. RNRAD representation validated

14-bit shift counter at `0o46`, mask `0o37777`, 15 serial bits, unsigned,
1.079 ft/bit (`HSCAL`). Out-of-range values are **refused, never wrapped**.
Boundary fixtures (0, max, max+1, negative, half-bit residual bound) in
`src/simulation/agcio/__tests__/radarObserver.test.ts`.

## 3. THRUST / CHAN14 corrected

`FRATE` = 32 units/centisecond; LMA790-3-LM §2.1.3.1 shows the DECA
analog-sums the LGC digital command with the TTCA command. The pulse train is
an **LGC throttle command delta into the DECA summing junction** — not thrust.
`throttleFraction` stays `null`; no lbf/newton/percentage anywhere. Locked by
`src/simulation/agcio/__tests__/thrustSemantics.test.ts` and a browser
assertion over full page text.

## 4. HW-I/O v3

Canonical artifact `public/agc/yaAGC-ext.wasm`, SHA-256
`12ac2797971ea56e5d7583d659ddbaae809f721d7549441229e580e110a65bc3`,
`agc_ext_version()` = `ddc65e7be+apollo-browser-hwio-v3`, `version()` stamp
`2020-12-24 ddc65e7be`. Radar interrupts use the native `InterruptRequests[9]`
latch only; the host never writes Z nor forces handler entry.

## 5. Test integrity

The parity suite now keeps a ledger; a meta-test fails if any of the six
scenarios is skipped or compares zero packets. Observed ledger:

```
cold-init         510 packets / 300,000 steps
long-idle       2,495 packets / 1,500,000 steps
V35E            1,542 packets / 880,000 steps
V16N65E         2,157 packets / 1,240,000 steps
pause-single-step 738 packets / 424,480 steps
mixed-dsky      1,977 packets / 1,060,000 steps
```

## 6. Gates

- Vitest: **357/357 passing, 0 skipped** (40 files).
- Typecheck: clean. Production build: clean.
- Playwright (Wrangler-served production bundle): **18/18 passing**, including
  the new `tests/radar-observer.spec.ts` (4 tests).
- Physics firewall unchanged; golden touchdown remains **368,279,425 µs**.

## 7. Still unresolved (blocking `descent-monitor-v1`)

PIPA ΔV pulse weight; CDU FIFO drain budget per 20 ms tick; TTCA throttle
bias; physical force per THRUST count; LR velocity-beam sequencing.
