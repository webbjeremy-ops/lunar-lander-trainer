# M3.3C Phase 1 — Independent primary-source verification

Status: **PIPA ΔV pulse weight RESOLVED for the Lunar Module.**
Nothing in this file is promoted on the strength of a secondary summary; every
constant below has (a) a primary document statement and (b) an independent
dimensional derivation from the pinned Luminary099 rope.

---

## 1. PIPA ΔV pulse weight — 1.00 cm/s per pulse (LM)

### 1.1 Primary document evidence

*Design Survey of the Apollo Inertial Subsystem*, ed. William A. Stameris,
Charles Stark Draper Laboratory, **March 1970**, prepared for NASA
(NTRS accession `19700018941`), **Fig. 4-3 "PIP Accelerometer Block Diagram"**
(PDF page 66) states verbatim, as annotation to the ΔV pulse output:

```
AV COMMAND MODULE 5.85 CM/SEC/PULSE
AV LEM       1.0  CM/SEC/PULSE
```

(Text as extracted by `pdftotext`; "AV" is the OCR/typesetting rendering of
"ΔV", "LEM" is the period designation of the Lunar Module.)

This single figure **resolves the contradiction** that blocked M3.3B2:

* `5.85 cm/s/pulse` is the **Command Module** PIPA weight. It is not, and never
  was, applicable to the LM.
* `1.00 cm/s/pulse` is the **LM** PIPA weight. The LM PIPA was scaled finer
  because the descent/ascent guidance loop integrates over a much shorter,
  higher-acceleration profile than translunar CSM navigation.

Both instruments are the same 16-size PIP; the difference is in the Pulse
Torquing Assembly (PTA) current/pulse quantum, which the same survey notes was
packaged separately for the LM (see §"Pulse Torquing Assembly (PTA)" in the
same document).

The document `HSI-208619` cited in the third-party report could **not** be
independently located in any public archive. It is therefore **not** used as
evidence here. The Draper design survey above is a stronger primary source
(NASA-funded contractor design documentation, publicly archived by NTRS) and is
the citation of record for this project.

### 1.2 Independent rope-internal derivation (Luminary099 @ 911e5c0)

The rope's own dimensional annotations give the same answer without reference
to any hardware document:

| Source | Statement |
| --- | --- |
| `SERVICER.agc:192` | `ABDELV = CM/SEC*2(-14)` — the PIPA-difference vector is carried in **centimetres per second**, scaled `2^-14`. |
| `SERVICER.agc:219` | `MOONSPOT CA KPIP1  # TP MPAC = ABDELV AT 2(14) CM/SEC` |
| `CONTROLLED_CONSTANTS.agc` | `KPIP = .0512`, `KPIP1 = .0128`, `KPIP2 = .0064` |

`ABDELV` is formed directly from the **raw difference of the PIPA counters**
(`PIPAX/PIPAY/PIPAZ`, erasable `0o37`/`0o40`/`0o41`) between successive READACCS
reads — no scale multiply is applied between the counter read and `ABDELV`.
Since `ABDELV` is declared to be centimetres per second at `2^14`, and the raw
counter difference is an integer count, **one counter count ≡ one centimetre per
second**. The `KPIP*` constants only re-scale that already-cm/s quantity into the
`2^5`, `2^7` and `2^8` m/cs internal representations used downstream; they are
not the pulse weight itself.

If the LM pulse weight were `5.85 cm/s`, `ABDELV` would be wrong by a factor of
5.85 and every `KPIP*` re-scaling would be dimensionally inconsistent with its
own comment.

### 1.3 Promoted constant

```
PIPA_METERS_PER_SECOND_PER_PULSE = 0.01   (exactly 1 cm/s)
```

Applies to all three LM PIPA axes (`PIPAX 0o37`, `PIPAY 0o40`, `PIPAZ 0o41`).
Positive ΔV along an axis is delivered as `PINC` pulses on that counter;
negative ΔV as `MINC` pulses. The counters are host-input counters in the HW-I/O
v3 capability table.

---

## 2. Landing-radar RANGE scale — unchanged

`HSCAL = 1.079 ft/bit` (`Luminary099/CONTROLLED_CONSTANTS.agc`), retained from
M3.3B2. See `docs/M3_3B2_SCALE_ARCHAEOLOGY.md`.

---

## 3. Still UNRESOLVED after Phase 1

These remain blockers for `descent-monitor-v1` and are **not** fabricated:

1. **PIPA maximum pulse rate.** The PTA pulse-quantum rate limit is not stated
   in the design survey text available here. The pure encoder therefore carries
   a clearly labelled non-authentic refusal bound and refuses (never wraps or
   silently drops) rather than inventing a saturation behaviour.
2. **IMU CDU angle drive.** Pulse weight for the CDU counters
   (`0o32`/`0o33`/`0o34`) and, more importantly, the CDU *drain* budget the AGC
   applies per read, remain unproven. Nothing drives the CDU counters.
3. **Stable-member ↔ LM body axis mapping for the scenario.** The LM body `+X`
   axis is the DPS thrust axis, but the body→stable-member relation is fixed by
   `REFSMMAT` plus the CDU angles, and no source-proven bootstrap for the golden
   vertical-descent scenario has been established yet. Until it is, the PIPA
   encoder consumes a caller-declared **stable-member-axis** specific force and
   performs no body→SM rotation of its own.
4. **DPS throttle magnitude.** Unchanged from M3.3B2: the `THRUST` (`0o55`)
   pulse train is an incremental DECA throttle-command delta (`FRATE`, 32
   units/cs), not a physical thrust value.

---

## 4. Verification trail

```
curl -sL https://ntrs.nasa.gov/api/citations/19700018941/downloads/19700018941.pdf
pdftotext 19700018941.pdf survey.txt
grep -n "CM/SEC/PULSE" survey.txt
  -> 3703:A V LEM 1.0 CM/SEC/PULSE   (PDF page 66, Fig. 4-3)
```
