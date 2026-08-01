# M4.6A — Reconstructed PDI Bootstrap and Luminary Shadow Mode

SPDX-License-Identifier: GPL-3.0-or-later

**Verdict: FAIL. M4.6B is not recommended.**

This milestone asked a single falsifiable question:

> Can real Luminary 099, started from a deliberately reconstructed
> powered-descent-initiation checkpoint, coherently process the live descent
> simulation?

The answer, measured against real yaAGC (HW-I/O v4) and the pinned rope, is
**no** — not because the emulator or the I/O path is wrong, but because the
rope's Average-G servicer is never scheduled from a reconstructed P63 entry.
This document records that finding as evidence rather than as a defeat.

## 1. What was built

| Module | Role |
| --- | --- |
| `src/simulation/agcshadow/reconstructedValues.ts` | Every PDI quantity, its classification, its uncertainty, and the M4.5a assumption id that justifies it. Quantities with unresolved scaling are declared `UNRESOLVED` and are **never installed**. |
| `src/simulation/agcshadow/pdiShadowPadLoad.ts` | `luminary099-reconstructed-pdi-shadow-padload-v1`: experimental, P00-only, atomic, compare-before-write, one-shot, reset-invalidated. Separate from the frozen M3.3E manifest. |
| `src/simulation/agcshadow/shadowProfile.ts` | Experimental profile lifecycle and mandatory banner text. Never the default. |
| `src/simulation/agcshadow/shadowObservables.ts` | Monitored rope words, with confidence and rope citations, and the delivered-vs-consumed classifiers. |
| `src/simulation/agcshadow/shadowTrace.ts` | Deterministic FNV-1a trace of the shadow comparison. |
| `src/simulation/agcshadow/verdict.ts` | `classifyShadowOutcome` plus the recorded `M4_6A_OBSERVED_RESULT`. |
| `src/routes/dev.agc-shadow.tsx` | Developer-only, read-only evidence panel. Starts nothing. |

## 2. What actually happened

Real-WASM run
(`src/simulation/agcshadow/__tests__/reconstructedPdiShadowWasm.test.ts`),
yaAGC HW-I/O v4, Luminary099 @ `911e5c0`:

| Criterion | Result |
| --- | --- |
| Atomic experimental bootstrap installed | **met** |
| P63 entered by keying `V37E 63E` on the real DSKY (`MODREG` = 63) | **met** |
| No repeating alarm or restart loop | **met** |
| Deterministic replay checksum | **met** |
| `AVEGFLAG` raised **and** Servicer running | **not met** |
| PIPA repeatedly consumed | **not met** |
| Navigation state (RN/VN) evolves | **not met** |
| Authentic CHAN13 radar request observed | **not met** |
| Radar update accepted through hardware | **not met** |
| Guidance quantity evolves | **not met** |

350 PIPA pulses were delivered through the native `PINC` path. The counters
increased monotonically and were **never drained**. `PHASE5` stayed zero,
`RN`, `VN` and `PIPTIME` stayed zero.

## 3. Why it fails — the rope-level cause

`AVEGFLAG` is necessary but **not sufficient**. `READACCS` runs only inside the
Average-G task loop, and that loop is started by `PREREAD`
(`SERVICER.agc`), which is reached only from the master ignition routine
(`BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc`, `REDO4.2`) at TIG−30.

Reaching `PREREAD` legitimately requires `TIG`, `TLAND`, `RLS` and a valid
state vector in erasable. The scaling of those words is **unresolved in-repo**;
the 1969 MIT input-deck transcription that would settle it was frozen
incomplete. Writing guessed words there would be fabrication, so the milestone
stops at the honest boundary: the flag is raised, the loop is not entered.

## 4. Second, independent blocker

HW-I/O v4 **seals the pad-load window after the first batch per AGC epoch**
(`agc_pad_load_window_open` returns `-30` on a second attempt). Installing the
frozen M3.3E coordinate bootstrap therefore consumes the only window, and the
experimental PDI batch is refused in the same epoch. The experiment runs
without the frozen coordinate bootstrap and reports the limitation; lifting it
would require a HW-I/O rebuild, which is out of scope here. This is proven by
its own test case.

## 5. Safety properties held throughout

- No AGC output is applied to physics. There is still **no** AGC-to-physics
  coupling anywhere in the product.
- The reference (procedure-bridge) guidance is unmodified and remains the
  default and only flying controller.
- No CHAN13 request was faked. Zero requests were observed, and zero radar
  responses were sent.
- The frozen M3.3E manifest, HW-I/O v4 artefact and the 1D golden touchdown are
  untouched.
- The experimental profile is opt-in, banner-labelled, and invalidated by any
  AGC reset.

## 6. Decision gate

`classifyShadowOutcome` gates `recommendM4_6B` on a full PASS. The recorded
result is FAIL, so:

> **M4.6B (bounded closed-loop adapter) is not eligible.** These findings are
> frozen. The recommended next step is M5.0 rather than continued open-ended
> bootstrap tuning.

Reopening this question requires new *evidence*, not new attempts — concretely,
a recovered listing that fixes the erasable scaling of `TLAND`, `RLS` and the
PDI state vector.

## 7. Tests

- `src/simulation/agcshadow/__tests__/agcShadow.test.ts` — 25 pure tests:
  registry completeness, pad-load validation and encoding, profile lifecycle,
  delivered-vs-consumed classification, trace determinism, verdict logic
  (including the PASS and PARTIAL branches).
- `src/simulation/agcshadow/__tests__/reconstructedPdiShadowWasm.test.ts` —
  4 real-WASM tests: the full shadow run, the sealed-window blocker, atomic
  rejection on compare-before-write mismatch, and reset invalidation.
