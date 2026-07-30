# M3.3C Phase 4A — Source-derived fixed-attitude IMU bootstrap

Status: **PROVEN as a definition. NOT installed, NOT activated.**
`descent-monitor-v1` remains blocked (see §8).

Pinned rope: `chrislgarry/Apollo-11 @ 911e5c0283c629c50cb97666f34065e8c07d71a5`.
Every line reference below is against that commit. Nothing here is promoted on
the strength of a secondary summary.

Implementation: `src/simulation/agcio/imuBootstrap.ts`.
Proof suite: `src/simulation/agcio/__tests__/imuBootstrap.test.ts` (37 tests).

---

## 1. REFSMMAT transformation direction — RESOLVED

**REFSMMAT maps REFERENCE → STABLE MEMBER.**

| Evidence | Statement |
| --- | --- |
| `P40-P47.agc:815` | `# REFSMMAT  MATRIX FROM REFERENCE TO STABLE-MEMBER COORDINATES SCALED AT 2.` |
| `R63.agc:116-117` | `MXV REFSMMAT` … `# (REFSMAT X LOS). TRANSFORMS LOS FROM REFERENCE COORD TO STAB MEMB COORD.` |
| `P40-P47.agc:833-834` | `S40.2,3` computes `POINTVSM = REFSMMAT × (desired thrust direction)` — the desired direction is reference-frame, the result is what the attitude routine compares against stable-member data. |
| `THE_LUNAR_LANDING.agc:85, :114` | P63 ignition algorithm applies `MXV REFSMMAT` to the landing site and to the state vector before guidance. |
| `R31.agc:232-233` | The **reverse** direction uses `VXM REFSMMAT` with the comment `CHANGE TO REFERENCE SYSTEM`. |

The forward operator is `MXV` and the reverse is `VXM`. Since `VXM` is
`Mᵀ·v`, the two comments are only mutually consistent if `M` itself is
reference→stable-member. Direction resolved with no residual ambiguity.

## 2. Storage order — RESOLVED: ROW MAJOR

`INTERPRETER.agc:1133-1152`:

* `MXV` sets the dot-product increment to **2** — i.e. successive elements of
  each dot product are **contiguous double-precision words**. Each output
  component therefore consumes one contiguous run of 3 DP words = one **row**.
* `VXM` sets the increment to **6** — stride-3-DP-words — i.e. **columns**.

Nine double-precision elements laid out row-major:

```
word  0/1   2/3   4/5   6/7   8/9  10/11 12/13 14/15 16/17
elem  M11   M12   M13   M21   M22   M23   M31   M32   M33
```

## 3. Fixed-point representation and scale — RESOLVED

* **Scale `B-1` (half unit).** `P40-P47.agc:815` says `SCALED AT 2`; every
  `MXV REFSMMAT` is immediately followed by `VSL1`, annotated at
  `P40-P47.agc:1468` as `RESCALE DUE TO HALF-UNIT MATRIX`. A pure element
  value `v` is stored as `v/2`.
* **Double precision, ones' complement**, 14 magnitude bits per word.
* Consequence: the pure element `+1.0` is stored as the word pair
  `(0o20000, 0)`; `-1.0` as its ones' complement `(0o57777, 0o77777)`; `0.0`
  as `(0, 0)`. These exact words are asserted in the test suite.

## 4. Erasable address — RESOLVED: ECADR `0o1733`, EBANK 3, 18 words

`ERASABLE_ASSIGNMENTS.agc:958` declares `REFSMMAT ERASE +17D` (18 words).
Independently resolved rather than taken on trust: the enclosing block opens
at `ERASABLE_ASSIGNMENTS.agc:825` with `SETLOC 1400` (the base of E3), and
summing every `ERASE` allocation between that `SETLOC` and line 958 yields
**219 words**, so `REFSMMAT = 0o1400 + 219 = 0o1733`. Corroborated by
`DOWNLINK_LISTS.agc:80` (`6DNADR REFSMMAT`, i.e. 18 words downlinked).

## 5. CDU counters — RESOLVED

* **Addresses.** `ERASABLE_ASSIGNMENTS.agc:117-119` — `CDUX 0o32`,
  `CDUY 0o33`, `CDUZ 0o34`.
* **Representation.** `POWERED_FLIGHT_SUBROUTINES.agc:77` (`CDUTRIGS`) hands
  the raw counter word to `CDULOGIC`, documented as converting an angle
  *scaled in revolutions* to a two's-complement angle *scaled in half
  revolutions*. `ERASABLE_ASSIGNMENTS.agc:1927-1929` states the matching
  registers are `SCALED AT PI RADIANS (180 DEGREES) (STORE IN 2'S
  COMPLEMENT)`. So: **15-bit two's complement, 180° full scale,
  180/2¹⁴ = 0.010986° per count**, wrapping at 2¹⁵ counts per revolution.
* **No pulses are needed for a fixed attitude.** `SERVICER.agc:570-581`
  (`PIPASR`) reads `CDUX/Y/Z` with plain `CA`/`TS` and **never drains,
  clears or acknowledges them** — in pointed contrast to the PIPA counters
  two instructions earlier, which are explicitly zeroed by `DXCH PIPAX`.
  The CDU counter is a *position* register that tracks the gimbal; a
  stationary gimbal emits no PCDU/MCDU pulses and the AGC re-reads the same
  value every cycle. **This is the finding that makes a fixed-attitude
  bootstrap possible without simulated alignment pulses.**

## 6. Body ↔ stable member — RESOLVED

`POWERED_FLIGHT_SUBROUTINES.agc:307` names its result
`THE BODY-STABLE MEMBER TRANSFORMATION MATRIX (COMMONLY CALLED XNB)` — the LM
rope draws no distinction between navigation-base and LM body axes. `FLESHPOT`
(`:307-345`) builds `XNB` from **the three CDU angles and nothing else**, so
attitude enters guidance through exactly one door. Its first row is computed
literally as

```
( cosY·cosZ , sinZ , −sinY·cosZ )
```

(the `DDOUBL`s are the B-1 rescale, not geometry). `xnbFromCduDegrees` in
`imuBootstrap.ts` reproduces that row exactly — asserted against the literal
expression at four attitudes — and completes rows 2–3 as the unique
right-handed orthonormal completion for the outer/inner/middle (X/Y/Z) gimbal
sequence, with orthonormality and det = +1 asserted at four more attitudes.

At **zero gimbal angles `XNB` is the identity**, so LM body axes coincide with
the stable-member axes, and body `+X` — the DPS thrust axis
(`P40-P47.agc:824`, `SCAXIS = UNITX`) — lies along stable-member `+X`.

## 7. PIPA axes — RESOLVED: the PIPA triad *is* the stable-member triad

`SERVICER.agc:556-568` (`PIPASR`) moves the raw `PIPAX/Y/Z` counters straight
into `DELVX/Y/Z`, and the downstream `SERVICER.agc:186` consumption applies
**no `XNB` rotation**. Unlike the CSM, the LM PIPAs are read directly in
stable-member coordinates. Combined with §5's pulse weight
(1 pulse = 1.00 cm/s, `docs/M3_3C_PRIMARY_SOURCE_RESOLUTION.md`), the sensor
chain is closed: stable-member specific force → ΔV → integer PIPA pulses.

## 8. Is identity a legitimate REFSMMAT here? — YES, as a coordinate choice

Identity is adopted **only** because the scenario reference frame is
explicitly *defined* to be a triad Luminary itself constructs.

`P51-P53.agc:248-268` (`P52LS` / `LSORIENT`, IMU orientation option 4,
"landing site") defines the stable-member orientation as

```
X_SM = UNIT(RLS)                      # landing-site radius vector
Z_SM = UNIT((R_other × V_other) × X_SM)
Y_SM = UNIT(Z_SM × X_SM)
```

`X × Y = X × (Z × X) = Z`, so the triad is **right-handed**.

The scenario declares its reference frame to be exactly this triad, and
declares that a P52 option-4 alignment to it completed before `t = 0`.
The stable member therefore *is* the reference triad, and REFSMMAT is the
identity **as a consequence of the coordinate definition, not as a shortcut**.
The distinction is testable, not rhetorical: the reference frame's three axes
are individually defined and cited in `imuBootstrap.ts`, and the whole chain
(REFSMMAT · XNB · thrust axis · PIPA axes) is machine-validated for
orthonormality, handedness, word round-trip and mutual consistency by
`validateFixedAttitudeBootstrap()`.

The physical picture: `X_SM` is local vertical up at the landing site, the
vehicle sits at zero gimbal angles, and the DPS thrust axis points straight
up — precisely the geometry the frozen M3.1 vertical-descent kernel models.

## 9. Can prior-mission state be installed without alignment pulses? — YES in
principle

`FLAGWORD_ASSIGNMENTS.agc:467-468` defines `REFSMFLG = 047D`, `REFSMBIT =
BIT13`, i.e. FLAGWRD3 bit 13. `FLAGWRD3 = STATE + 3`; `STATE` resolves to
`0o74` (`ERASABLE_ASSIGNMENTS.agc:217` `SETLOC 67`, then `NEWJOB 0o67` and
`RUPTREG1..4 0o70-0o73`), so **FLAGWRD3 = `0o77`**.
`FRESH_START_AND_RESTART.agc:152` explicitly preserves `REFSMFLG` across a
fresh start — Luminary itself models a known IMU orientation as state that
predates the running program. That is exactly what a bootstrap asserts, so
installing it is faithful rather than a cheat.

The complete, deterministically ordered install set is 22 words:

| order | symbol | address | word |
| --- | --- | --- | --- |
| 0–17 | `REFSMMAT +0 … +17` | `0o1733`–`0o1754` | identity at B-1: `0o20000` at the three diagonal hi words, `0` elsewhere |
| 18 | `CDUX` | `0o32` | `0` |
| 19 | `CDUY` | `0o33` | `0` |
| 20 | `CDUZ` | `0o34` | `0` |
| 21 | `FLAGWRD3` | `0o77` | `REFSMBIT` = `0o10000` |

## 10. Remaining blocker — installation path

`BOOTSTRAP_INSTALLATION_BLOCKER = "imu-bootstrap-installation-path-unresolved"`

HW-I/O v3 exposes `get_erasable_ptr()` for **reading** erasable memory and the
ordered counter API for PINC/MINC, but **no host write path**, and no
source-legitimate uplink path (P27 / V71–V72 pad load) is implemented. A
bootstrap that cannot be installed cannot be verified at rope level, therefore:

* no production monitor profile may depend on it yet;
* `descent-monitor-v1` stays blocked;
* the physics firewall and the golden touchdown (368 279 425 µs) are untouched
  by this phase — nothing here is wired into the Worker.

Two candidate resolutions, both requiring your direction before implementation:

1. **Authentic uplink.** Drive V71/V72 (or P27) erasable-load keystrokes through
   the existing DSKY path. Fully source-legitimate, no new WASM surface, but it
   is a real Luminary program flow with its own verification and failure modes.
2. **HW-I/O v4 pad-load export.** Add a narrow, explicitly non-flight
   `agc_erasable_pad_load` restricted to pre-run bootstrap, refusing to fire
   once the rope has begun executing. Simpler and testable, but it introduces a
   host capability with no hardware counterpart and would need the same
   frozen-vs-extended parity treatment v2 and v3 received.

## 11. Still unresolved after Phase 4A

1. **Bootstrap installation path** (§10).
2. **CDU dynamic drive.** Pulse-rate limit and drain budget for a *changing*
   attitude. Unaffected by this phase, which covers the fixed-attitude case
   only. Any commanded attitude change invalidates the bootstrap.
3. **DPS throttle magnitude.** Unchanged: `THRUST` (`0o55`) carries an
   incremental DECA throttle-command delta (`FRATE`, 32 units/cs), not a
   physical thrust value.
4. **P63 prerequisites beyond the IMU.** `RLS`, `TLAND` and the LM state vector
   are not established by this bootstrap.
