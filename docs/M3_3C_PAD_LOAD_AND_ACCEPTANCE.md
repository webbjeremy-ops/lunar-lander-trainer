# M3.3C — Pad load, Channel 13 capture, and acceptance record

Status: **NOT YET READY TO FREEZE.** Sections 1, 3 and 6 (decoder half) of the
acceptance chain are complete and proven; sections 5, 7–9 and 11 remain open.
This document records only what is actually proven by executed tests.

## 1. Canonical HW-I/O v4 identity

| Item | Value |
| --- | --- |
| `version()` | `2020-12-24 ddc65e7be` |
| `agc_hwio_version()` | `4` |
| `agc_ext_version()` | `ddc65e7be+apollo-browser-hwio-v4` |
| Artifact | `src/third-party/webagc/yaAGC-ext.wasm` (copied to `public/agc/`) |
| SHA-256 | `2e7c28ec75be794da991c49a5842ba3db6140f8936892f1c84f25883040a6abc` |
| Frozen v-reference SHA-256 | `a595f3ad3cc6833638b49879e2d41149a7327b1a10577828f50466d6c7747f14` |
| Rope | Luminary099, chrislgarry/Apollo-11 @ `911e5c0`, SHA-256 `1f5326e0…8f40e` |

Single source of truth: `src/agc/AgcRuntimeManifest.ts`. Production code never
selects the frozen artifact; only `hwioParity.test.ts` loads it.

## 2. Low-level pad-load gate — PROVEN at the WASM boundary

`src/sim/agc/__tests__/hwioPadLoadSnapshots.test.ts` (13 tests) reads the
**entire 2048-word erasable image** through `agc_erasable_read_word` before and
after every negative case and asserts a zero-word diff, i.e. no hidden partial
mutation:

| Negative case | Return | Whole-image diff |
| --- | --- | --- |
| apply with window never opened | `-20` | none |
| empty batch | `-25` | none |
| 65-record batch | `-25` | none |
| address `< 0o24` | `-26` (index 1) | none |
| address `> 2047` | `-26` | none |
| duplicate address | `-27` (index 2) | none |
| word `0o100000` (value) | `-28` | none |
| word `0o100000` (expected-before) | `-28` | none |
| expected-before mismatch | `-29` (index 0) | none |
| mismatch in the **last** record of a 4-record batch | `-29` (index 3) | none — the first three writes never happen |
| `cpu_step(1)` with the window open | `-23` | target word untouched |
| apply after `close` | `-20`; re-`open` → `-30` | none |

Also proven for every negative case: zero output packets drained, output trace
disabled and zero drops, `agc_hw_input_last_error_index() == -1`, and no
pending interrupt request on vectors 0–10. The API is fully dormant when
unused.

## 3. The real 22-word bootstrap installation ledger — PROVEN

Manifest: `luminary099-fixed-attitude-descent-padload-v1`
(`src/simulation/agcio/padLoadManifest.ts`), validator returns `[]`.

Applied through canonical v4 against the pinned rope. Every record satisfied
`expectedBefore === actualBefore` and `installed === readBack`;
`agc_pad_load_applied_count() === 22`.

| Symbol | Addr | Before | Installed = read-back | Category |
| --- | --- | --- | --- | --- |
| REFSMMAT +0 (M11 hi) | `0o1733` | 0 | `0o20000` | refsmmat |
| REFSMMAT +1..+7 | `0o1734`–`0o1742` | 0 | 0 | refsmmat |
| REFSMMAT +8 (M22 hi) | `0o1743` | 0 | `0o20000` | refsmmat |
| REFSMMAT +9..+15 | `0o1744`–`0o1752` | 0 | 0 | refsmmat |
| REFSMMAT +16 (M33 hi) | `0o1753` | 0 | `0o20000` | refsmmat |
| REFSMMAT +17 | `0o1754` | 0 | 0 | refsmmat |
| CDUX / CDUY / CDUZ | `0o32`–`0o34` | 0 | 0 | cdu-initial-state |
| FLAGWRD3 (REFSMFLG) | `0o77` | 0 | `0o10000` | coordinate-bootstrap |

Citations are carried per record (ERASABLE_ASSIGNMENTS.agc:958 /:117-119,
FLAGWORD_ASSIGNMENTS.agc:454,:467-468, FRESH_START_AND_RESTART.agc:152).

Whole-image diff around the transaction changed **exactly** the manifest
addresses whose value differs from their prior contents and no others.
Installation emitted no packet, no trace entry and no interrupt. Immediately
afterwards `agc_pad_load_window_open()` returns `-30` and apply returns `-20`,
with `0o1733` still reading `0o20000`. `cpu_reset()` closes the lifecycle,
zeroes `agc_pad_load_status()`/`applied_count()`, and discards all 22 words.

## 4. Rope-level verification — read-back PROVEN, consumption BLOCKED

`src/simulation/agcio/__tests__/ropeBootstrap.test.ts`: after installation the
18 REFSMMAT words decode (half-unit scale, row-major, reference→stable-member)
to the identity matrix within 1e-7; REFSMFLG is set in FLAGWRD3; 400 000 normal
`cpu_step` cycles leave CDUX/Y/Z at zero (fixed attitude needs no pulses) and
PIPAX/Y/Z at zero; the pad window is closed throughout; and 200 000 stepped
cycles emit **no** CHAN12 ZERO-IMU-CDUS / COARSE-ALIGN discrete (`0o30`).

### Independent consumption proof — HARD BLOCKER (stop condition 1)

The intended proof route was the normal Servicer chain
`PINC/MINC → READACCS → DELV → REFSMMAT → DELVREF`. It is **not reachable**
from any state this milestone may legitimately create, and the attempt was
stopped rather than fabricated.

Executable evidence: `src/simulation/agcio/__tests__/servicerReachability.test.ts`.
After the real 22-word bootstrap, 2 000 000 cycles of normal fresh-start
execution, an asymmetric host PINC injection (X=7, Y=3, Z=5 through native
`agc_counter_increment`, no direct erasable writes) and a further 5 000 000
normal cycles, the counters still read exactly `7 / 3 / 5`. The rope never
reads or clears them.

Rope reason, from the pinned source:

| Citation | Content |
| --- | --- |
| `FLAGWORD_ASSIGNMENTS.agc:809-810` | `AVEGFLAG = 115D`, `AVEGFBIT = BIT5` — "AVERAGEG (SERVICER) DESIRED" |
| `SERVICER.agc:53` | "SET V37FLAG AND AVEGFLAG (BITS 5 AND 6 …)" |
| `SERVICER.agc:77-83` | `READACCS` runs only as a WAITLIST task inside the AVERAGEG loop |
| `SERVICER.agc:109` | `BZF AVEGOUT` — the loop exits immediately while AVEGFLAG is down |
| `SERVICER.agc:147` | "END TASK WITHOUT CALLING READACCS" |

Also attempted and rejected: entering the descent program by **normal DSKY
keying** (`V37E 63E` on channel 015 with authentic key codes). The rope does
not start AVERAGEG, because P63 entry presupposes mission state that does not
exist after a cold start.

**Smallest missing bootstrap field set** (all required together; none of it is
source-derivable for this scenario today, so installing it would be fabricated
mission operation):

1. `AVEGFLAG` (FLAGWRD7 bit 5) set — but only legitimately as a *consequence*
   of a program that owns the Servicer loop, never by pad load.
2. A valid vehicle state vector `RN`/`VN` (double-precision position/velocity)
   plus `PIPTIME`/`PIPTIME1`, which the AVERAGEG integration reads on its
   first pass.
3. Orbital-integration setup (`SETINTG` / `MOONFLAG` permanent-state
   selection) consistent with that state vector.
4. The P63 major-mode entry conditions themselves (`V37FLAG`, average-G
   scheduling via the WAITLIST/`ATTACHIT` chain).

That is a full powered-descent mission bootstrap, not a pad load. Per the
milestone's stop rules, work halted here: sections 2–8 of the continuation
(live PIPA wiring, CHAN13 Worker fold, RNRAD/RADARUPT responses, profile
activation, diagnostics, browser acceptance) are all gated on this proof and
were **not** started, so nothing downstream rests on an unproven transform.


## 6. Channel 13 authentic request capture — decoder PROVEN, wiring open

`src/simulation/agcio/chan13Requests.ts` (pure, 13 tests). Source-mapped bit
model from `INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc` and `P20-P25.agc`:
bits 1–3 = A/B/C radar-select matrix, bit 4 = RADAR ACTIVITY;
`INITREAD` clears `ALLREAD OCT 17` then ORs the lead-in, so every genuine read
is a clear-then-set **edge**.

| Lead-in | Select | Selection | Host response |
| --- | --- | --- | --- |
| `OCT 17` | 7 | LR altitude | **answerable** |
| `OCT 16/15/14` | 6/5/4 | LR velocity Z/Y/X | refused — `selection-not-implemented-lr-velocity` |
| `OCT 12/11` | 2/1 | RR range-rate / range | refused — `selection-not-implemented-rendezvous-radar` |
| `OCT 13` | 3 | unassigned | refused — `selection-unassigned-in-luminary099` |

Proven: no CHAN13 write → no request; ACTIVITY clear → no request; select 0 →
no request; retained level → suppressed, never re-requested; at most one
outstanding transaction per solicitation; refusals carry an explicit reason and
create no outstanding transaction and no data; RADAREAD's ACTIVITY reset is not
itself a request; the fold never mutates its input state.

**Open:** the decoder is not yet wired into the Worker output stream, so
"no CHAN13 request → no RNRAD load → no RADARUPT" is proven only at the pure
level, not end to end.

## Accurate remaining blockers

* §4 — **hard blocker.** Independent rope-side REFSMMAT *consumption* proof is
  unreachable: the Servicer/READACCS path requires a full powered-descent
  mission bootstrap (see §4 above). Everything below is gated on it.
* §5 — live PIPA injection into the Worker (encoder exists, wiring does not).
* §7 — altitude RNRAD/RADARUPT transaction driven by captured CHAN13 requests.
* §8 — `landing-radar-observer-v1` profile gating on the above.
* §9 — diagnostics panel fields for bootstrap, PIPA and radar transactions.
* §11 — browser acceptance specs for the new paths.

## Next highest-value milestone

Source-derive and prove the **powered-descent mission bootstrap** (state
vector `RN`/`VN`, `PIPTIME`, integration selection, P63 entry) from primary
Apollo 11 documents. It is the single prerequisite that unblocks the REFSMMAT
consumption proof, live PIPA, and every landing-radar transaction at once.

## Verification totals (this pass)

| Check | Result |
| --- | --- |
| Vitest | **495 / 495 passed**, 49 files, 0 skipped |
| Typecheck (`tsgo --noEmit`) | clean |
| Physics firewall | unchanged; golden touchdown `368,279,425 µs` still asserted by the M3.1/M3.2 suites |
| Closed-loop AGC control | still prohibited and absent |

**M3.3C is not ready to freeze.**

