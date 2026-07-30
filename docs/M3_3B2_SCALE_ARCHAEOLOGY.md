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

1. **PIPA ΔV per pulse.** The widely-repeated 5.85 cm/s appears in no primary
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
