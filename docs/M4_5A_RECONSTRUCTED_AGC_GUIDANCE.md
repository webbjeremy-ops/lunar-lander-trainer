# M4.5a — Reconstructed AGC Guidance (shadow-mode foundation)

Status: **implemented, shadow-only**. No vehicle in the shipped game is flown by
this layer. The frozen M4.1 historically grounded procedure bridge remains the
default and only active guidance path.

## Why this exists

Closing the AGC loop was blocked on an artefact that does not exist: the Apollo 11
pre-descent state as an input deck. Rather than continue to chase it, this
milestone adds a **clearly labelled reconstruction**, so the emulator, the rope,
the sensors and the DSKY are all real while the *initial condition* is an honest
estimate.

Two labels are load-bearing and appear in code, tests and UI:

```text
RECONSTRUCTED PDI INITIALIZATION — NOT THE ORIGINAL APOLLO 11 INPUT DECK
AUTHENTIC LUMINARY GUIDANCE · RECONSTRUCTED LM CONTROL-ELECTRONICS ADAPTER
```

## Module map — `src/simulation/agcguidance/`

| File | Role |
| --- | --- |
| `assumptions.ts` | Registry of every estimate: id, statement, basis, sources, confidence, and how it can be falsified. `assertAssumptionsDeclared()` gates use. |
| `pdiCheckpoint.ts` | The reconstructed PDI initial condition: planar flight state from the workbook PDI anchor (49,971 ft / 5,559.7 ft/s), the frozen M3.3C REFSMMAT/CDU pad load, Average-G / radar / engine-ready bookkeeping. Pure; validated. |
| `targets.ts` | `AgcGuidanceTargetsV1` — the only currency the adapter accepts: program phase, commanded attitude, attitude rate, target descent rate, throttle tendency, LPD offset, origin (`authentic-luminary` or `reference-profile`). |
| `controlAdapter.ts` | Reconstructed LM control-electronics stand-in. Guidance intent in, **bounded** vehicle commands out: attitude-rate limit and authority clamp from the kernel constants, first-order throttle slew, DPS band snapping. Refuses invalid records instead of guessing. |
| `shadowMode.ts` | Mode gate + divergence comparison. `resolveGuidanceAuthority()` is the single door to a control input. |

## Guidance modes

```text
off      frozen M4.1 procedure bridge; this layer is inert
shadow   Luminary is fed real sensors; targets recorded and compared with the
         reference profile. resolveGuidanceAuthority() returns control = null,
         always, unconditionally.
engaged  "Reconstructed AGC Guidance": adapter commands are offered, and only
         when the record's origin is `authentic-luminary` and the adapter
         accepted it.
```

The safety property is a test, not a convention: shadow mode returns `null`
even when handed a fully valid adapter output.

## Declared assumptions

`pdi-state-vector`, `pdi-mission-time`, `refsmmat-and-cdu`,
`erasable-p63-initialisation`, `average-g-activation`, `landing-radar-timing`,
`guidance-target-extraction`, `control-electronics-response`,
`program-transition-conditions`. Each carries a confidence rating and a
falsification criterion; see `assumptions.ts` for the authoritative text.

Lowest-confidence items (`erasable-p63-initialisation`, `average-g-activation`,
`control-electronics-response`) are exactly the ones that would change if the
1969 deck were ever recovered.

## What is *not* done yet (next steps, before M4.6a)

1. **Authentic target extraction.** No producer of `origin:
   "authentic-luminary"` records exists yet; the rope's guidance quantities are
   not decoded. Until that lands, `engaged` mode is unreachable in practice —
   by design.
2. **Worker wiring.** The checkpoint is not installed by `AgcWorker`, and the
   PIPA / CHAN13 feeds are still the M3.3E hardware-interface lab profile.
3. **UI.** No mode selector is exposed in `/play`.

## Invariants preserved

- No AGC-to-physics coupling in shipped modes: the layer is pure and unwired.
- M3.3E freeze, HW-I/O v4, the 1D golden touchdown and the M4.0 planar kernel
  are untouched — this milestone adds files only.
