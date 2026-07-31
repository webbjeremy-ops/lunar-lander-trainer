# M3.3E — Synthetic AGC Hardware-Interface Laboratory: FREEZE

**Status: FROZEN.**

Profile id: `agc-hardware-interface-lab-v1`
Scenario id: `m3.3e-hardware-interface-lab-v1`

> **SYNTHETIC HARDWARE-INTERFACE FIXTURE — NOT AN AUTHENTIC APOLLO POWERED
> DESCENT.** The lab exercises the AGC *hardware interface* (native
> unprogrammed sequences and the landing-radar transaction) against
> deterministic synthetic state. It does **not** reproduce a mission run, and
> it never claims rope consumption of the delivered inputs.

---

## 1. What is frozen

| Item | Value |
| --- | --- |
| Canonical runtime | `yaAGC-ext.wasm`, HW-I/O **v4** |
| Artifact SHA-256 | `2e7c28ec75be794da991c49a5842ba3db6140f8936892f1c84f25883040a6abc` |
| Extension identity | `ddc65e7be+apollo-browser-hwio-v4` |
| Rope | Luminary099, chrislgarry/Apollo-11 `911e5c0` |
| PIPA scale | **1 pulse = 1 cm/s** (0.01 m/s) |
| LR range scale | `HSCAL` = **1.079 ft/bit**, RNRAD `0o46`, 15 serial bits, 14 retained |
| RADARUPT | native interrupt index 9 → vector `04044` |

The frozen M3.3C foundations it builds on — HW-I/O v4, the atomic
compare-before-write pad load, the source-derived fixed-attitude IMU
bootstrap, the PIPA scale, and the CHAN13 request decoder — are unchanged by
this milestone.

## 2. Behavioural contract

1. **Opt-in and dormant.** Production boots with no profile. Nothing in the
   lab path executes under any other profile, and exit clears every residual
   (pulse carry, request state, diagnostics) with no implicit re-arm.
2. **PIPA delivery is scenario-derived only.** Pulses come from the
   scenario's body specific force; lunar gravity is never injected. Residual
   ΔV below one pulse is carried, never discarded.
3. **A refused batch delivers nothing.** `agc_hw_input_apply` is atomic; on
   refusal no counter is mutated, the delivered count does not advance, and
   the residual carry is preserved.
4. **The radar is request-driven.** There is no host-side repeating radar
   timer. A transaction happens only when Luminary itself writes CHAN13
   (INITREAD clear, then select + ACTIVITY), and only for the altitude
   selection (`LRALT`, select code 7). Velocity beams, rendezvous radar and
   unassigned selections are refused.
5. **Two-phase radar commit.** `observe → prepare candidate → attempt
   hardware → commit or reject`. Nothing is committed before the hardware
   call returns. On success: complete the request, increment delivered,
   record the response. On failure: increment refusals, record
   `hardware-application-rejected`, and **interlock** the lab — no silent
   retry, even once hardware would accept again.
6. **Delivery ≠ consumption.** Diagnostics report the delivered hardware
   input and, verbatim, `native PIPA input delivered; rope consumption not
   active in this scenario`. `authenticMissionRequestGenerated` stays `0`.
7. **Physics firewall.** No decoded AGC output reaches the LM kernel. Closed
   loop AGC control remains prohibited and absent.

## 3. Acceptance evidence

| Suite | Scope | Result |
| --- | --- | --- |
| `src/simulation/agcio/__tests__/hardwareInterfaceLabController.test.ts` | plumbing contract, two-phase commit, rejection interlock (fake port) | pass |
| `src/simulation/agcio/__tests__/hardwareInterfaceLabWasm.test.ts` | **canonical HW-I/O v4 WASM through a real `AgcCoreAdapter`**: native PIPA counter deltas, PINC/MINC polarity, determinism, atomic refusal + residual retention, real RNRAD word + native RADARUPT, refusal matrix, rejection interlock, CPU-reset clearing | pass |
| `tests/hardware-interface-lab.spec.ts` | browser acceptance on the Wrangler-served production bundle: dormancy, synthetic banner, live pulse delivery, no authentic request, no repeating timer, exit clearing, **physics bit-identity lab off vs on** | 5 / 5 pass |
| Full Vitest | whole repository | **539 / 539 passed**, 52 files, 0 skipped |
| Typecheck (`tsgo --noEmit`) | repository | clean |
| Golden touchdown | M3.1 / M3.2 | `368,279,425 µs`, unchanged |

## 4. Explicitly out of scope

* Rope consumption of PIPA/REFSMMAT through Average-G (`READACCS`): still
  blocked — see `docs/M3_3C_PAD_LOAD_AND_ACCEPTANCE.md`. Reaching it needs a
  full powered-descent mission bootstrap, which the primary sources do not
  yet supply (`docs/M3_3D_POWERED_DESCENT_CHECKPOINT.md`).
* Landing-radar velocity beams (beam-select sequencing unresolved).
* `descent-monitor-v1`, which remains BLOCKED.
* Any closed-loop control path.
