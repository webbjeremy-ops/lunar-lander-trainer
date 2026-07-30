# M3.3B2 — Primary-document scale archaeology (interim record)

SPDX-License-Identifier: GPL-3.0-or-later

Sources actually opened and read this pass:

- `LMA790-3-LM`, *Apollo Operations Handbook, LM, Subsystems Data*, basic date
  1 Feb 1970, change date 15 Jun 1970 (ibiblio.org/apollo/Documents/).
- `Luminary099/CONTROLLED_CONSTANTS.agc` and
  `Luminary099/THROTTLE_CONTROL_ROUTINES.agc` (ibiblio Luminary 099 listing,
  transcribed 2009 from MIT Museum hardcopy).

## Resolved (primary, citable)

| Quantity | Value | Source |
|---|---|---|
| IMU CDU angular LSB, fine mode | **20 arc-sec/pulse** (16-bit read counter, full range 359°59'40") | LMA790-3-LM §2.1.4.1.3, pp. 2.1-50/51 |
| CDU Δθc word to LGC | 40 arc-sec | same |
| CDU coarse-align increment | 160 arc-sec | same |
| LR range bit weight | **1.079 ft/bit** | `CONTROLLED_CONSTANTS.agc` `HSCAL` (printed p. 41) |
| LR range→metres | `RANGCONV 2DEC 2.859024 B-3` | same |
| LR range-rate bit weight | `RDOTCONV 2DEC -.0019135344 B7` (m/cs at 2^7) | same |
| LR velocity-beam scales | `VZSCAL .8668`, `VYSCAL 1.212`, `VXSCAL -.644` ft/s/bit | same |
| LGC throttle counter rate | **32 units/centisecond (3200/s)** | `THROTTLE_CONTROL_ROUTINES.agc` p. 795, `FRATE` |
| Throttle-command semantics | DECA **analog-sums** the LGC digital throttle command with the TTCA manual command before driving the engine | LMA790-3-LM §2.1.3.1 |

The last row settles the P5.c question: the CH14/THRUST pulse train is an
*incremental LGC throttle-command resolution into the DECA summing junction* —
neither a DECA actuator count nor a physical thrust. Any future
`throttleFraction` must be labelled as commanded-delta, never as thrust.

## Still UNRESOLVED at primary-document level

Explicitly **not** adopted; no secondary figure was promoted to a constant.

1. ~~**PIPA ΔV per pulse.**~~ **RESOLVED in M3.3C** — 1.00 cm/s/pulse for the
   LM; the 5.85 cm/s figure is the COMMAND MODULE weight. Primary: Draper
   *Design Survey of the Apollo Inertial Subsystem* (NTRS 19700018941)
   Fig. 4-3, p.66. See docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md. Original
   note retained below for the record:
   The widely-repeated 5.85 cm/s appears in no primary
   page opened here. LMA790-3-LM §2.1.4.1.7 describes the PIPA loop and the
   3200-cps signal-generator excitation, but gives no pulse weight. Requires
   R-567 GSOP Sec. 5 numeric tables or ND-1021042 §2.
2. **CDU "39.3 arc-sec".** Does not appear in LMA790-3-LM; likely a conflation
   with an RR or optics-CDU LSB. Do not use.
3. **THRUST pounds-per-pulse** (secondary claim: 2.7 lb/pulse). Not found in any
   primary source. `FMAXPOS +3467` / `FMAXODD +3841` (B-14) are pad-loaded
   force limits in the same normalised units as FDPS, so a derivation is in
   principle possible, but not with a verified bit weight — left undone rather
   than approximated.
4. **Fixed TTCA throttle bias.** Described only qualitatively; no number.

## Consequence for profile gating

`descent-monitor-v1` stays **BLOCKED**: item 1 (PIPA) is a hard dependency of
`SERVICER`. A `landing-radar-observer-v1` profile is now *unblocked on scale
grounds* — LR range and range-rate bit weights are primary-sourced, and the
HW-I/O v3 `agc_landing_radar_update_apply` path delivers RNRAD + RADARUPT
faithfully — but it is not yet implemented.

Warning: the 3200-cps figure in the AOH power tables is IMU/PIPA excitation
power, a *different subsystem* from the 32-units/centisecond throttle counter
rate. The numeric coincidence is not evidence.

## Addendum — radar cadence and transaction ordering (pinned rope)

Opened this pass: `Luminary099/P20-P25.agc`, `Luminary099/SERVICER.agc`,
`Luminary099/RADAR_LEADIN_ROUTINES.agc`,
`Luminary099/INPUT_OUTPUT_CHANNEL_BIT_DESCRIPTIONS.agc`
(chrislgarry/Apollo-11 @ 911e5c0).

| Question | Answer | Source |
|---|---|---|
| Who initiates a radar read? | The LGC. `WAND CHAN13` clears radar bits, `WOR CHAN13` sets select + ACTIVITY. | P20-P25.agc INITREAD, p.554 |
| CHAN13 layout | bits 1-3 RADAR A/B/C select, bit 4 RADAR ACTIVITY | I/O bit descriptions, p.56 |
| Select codes | `ALLREAD/LRALT 17`, `LRVELZ 16`, `LRVELY 15`, `LRVELX 14`, `RRRANGE 11`, `RRRDOT 12` | P20-P25.agc p.553-554 |
| Words per RADARUPT | exactly one, selected by CHAN13 bits 1-3 | P20-P25.agc RADAREAD, p.555 |
| Ordering | select+activity → serial RNRAD fill → RADARUPT → handler reads RNRAD → DATA GOOD checked after read → ACTIVITY reset | P20-P25.agc RADAREAD/RESAMPLE, p.555-557 |
| LR altitude schedule | WAITLIST task from READACCS, 50 ms before next READACCS, below 25,000 ft | SERVICER.agc LRHTASK, p.872 |
| LR altitude sample window | ~95 ms, one sample; "LRH DATA 1.079 FT/BIT" | SERVICER.agc LRHJOB, p.892 |
| LR velocity | 5 samples, ~500 ms, `VSELECT` beam sequencing, below 15,000 ft | SERVICER.agc LRVJOB, p.892 |
| Data-good discretes | CHAN33 `DGBITS OCT 230`; LR range DG bit 5, velocity DG bit 4, position bit 6 (all active-low) | P20-P25.agc INITREAD/LRHEIGHT/RENDRAD |

**Consequence.** The cadence is inseparable from READACCS, which is the
PIPA-driven SERVICER cycle. With the PIPA ΔV weight still unresolved, a
host-timed radar emission would be fabricated operation. `landing-radar-
observer-v1` stays blocked with `radar-update-cadence-unresolved`; the 250 ms
constant is retained only as a named test fixture.
