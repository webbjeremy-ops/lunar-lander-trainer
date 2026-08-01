// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.5a — RECONSTRUCTED AGC GUIDANCE: explicit assumption registry.
//
// Every estimate that stands in for a lost or unrecoverable 1969 artefact is
// declared here ONCE, with an id, a basis, and a testable criterion. Nothing
// in the reconstructed-guidance path may rely on an estimate that is not in
// this registry: `assertAssumptionsDeclared()` is the gate.
//
// This registry is documentation that the code can check. It does not make an
// estimate correct; it makes it visible, citable, and falsifiable.

export type AssumptionConfidence = "high" | "medium" | "low";

export type AssumptionCategory =
  | "initial-state"
  | "coordinate-alignment"
  | "erasable-initialisation"
  | "sensor-timing"
  | "guidance-extraction"
  | "control-electronics"
  | "program-transition";

export interface ReconstructionAssumptionV1 {
  /** Stable identifier referenced from code and docs. */
  readonly id: string;
  readonly category: AssumptionCategory;
  /** What we are assuming, in one sentence. */
  readonly statement: string;
  /** Why this value/behaviour was chosen; what it is derived from. */
  readonly basis: string;
  /** Human-readable citation(s) for the basis. */
  readonly sources: readonly string[];
  readonly confidence: AssumptionConfidence;
  /** How the assumption can be shown wrong. Must be observable. */
  readonly falsifiableBy: string;
}

export const RECONSTRUCTED_GUIDANCE_LABEL =
  "RECONSTRUCTED PDI INITIALIZATION — NOT THE ORIGINAL APOLLO 11 INPUT DECK";

export const CONTROL_ADAPTER_LABEL =
  "AUTHENTIC LUMINARY GUIDANCE · RECONSTRUCTED LM CONTROL-ELECTRONICS ADAPTER";

export const RECONSTRUCTION_ASSUMPTIONS: readonly ReconstructionAssumptionV1[] = [
  {
    id: "pdi-state-vector",
    category: "initial-state",
    statement:
      "The powered-descent-initiation state is the workbook PDI anchor: 49,971 ft " +
      "altitude and 5,559.7 ft/s total inertial speed, placed in the planar " +
      "Moon-centred frame as a circular-plane state with zero radial rate.",
    basis:
      "Apollo 11 powered-descent workbook MissionLog row 18 (secondary " +
      "reconstruction) combined with the M4.0 planar kernel frame definition.",
    sources: [
      "apollo11-powered-descent-technical-reconstruction-workbook-v1 (MissionLog:18)",
      "docs/M4_0_LUNAR_FLIGHT_KERNEL.md",
    ],
    confidence: "medium",
    falsifiableBy:
      "A recovered Apollo 11 PDI state vector (RN/VN at 102:33:05 GET) differing " +
      "from this position/velocity by more than the declared tolerance.",
  },
  {
    id: "pdi-mission-time",
    category: "initial-state",
    statement:
      "Scenario mission time zero corresponds to PDI ignition at 102:33:05 GET; " +
      "the AGC's own clock is NOT set to Apollo 11 GET.",
    basis:
      "The rope is started from a reset AGC, so its TIME2/TIME1 pair begins at " +
      "zero. Mapping is documented rather than faked.",
    sources: ["docs/M3_3C_PAD_LOAD_AND_ACCEPTANCE.md"],
    confidence: "high",
    falsifiableBy:
      "Any lesson or scoring path that treats the AGC clock as Apollo 11 GET.",
  },
  {
    id: "refsmmat-and-cdu",
    category: "coordinate-alignment",
    statement:
      "The stable-member orientation and initial CDU angles are the frozen " +
      "fixed-attitude bootstrap, not the flown Apollo 11 landing-site REFSMMAT.",
    basis:
      "M3.3C Phase 4A derived a right-handed orthonormal REFSMMAT and matching " +
      "CDU counts that the pad load installs and validates before any CPU step.",
    sources: [
      "src/simulation/agcio/imuBootstrap.ts",
      "docs/M3_3C_PHASE4A_COORDINATE_CHAIN.md",
    ],
    confidence: "medium",
    falsifiableBy:
      "Comparing decoded REFSMMAT words against a recovered Apollo 11 alignment.",
  },
  {
    id: "erasable-p63-initialisation",
    category: "erasable-initialisation",
    statement:
      "Erasable words that the pre-PDI mission phases would have set (target " +
      "state, guidance bookkeeping, Average-G enable) are reconstructed rather " +
      "than recovered, and are declared record-by-record.",
    basis:
      "The 1969 MIT input deck transcription was frozen incomplete; READACCS is " +
      "only reachable with AVEGFLAG set, which no recovered artefact provides.",
    sources: ["docs/M3_3D_POWERED_DESCENT_CHECKPOINT.md", "docs/M3_3E_HARDWARE_INTERFACE_LAB_FREEZE.md"],
    confidence: "low",
    falsifiableBy:
      "A recovered deck listing whose erasable values differ from the manifest.",
  },
  {
    id: "average-g-activation",
    category: "erasable-initialisation",
    statement:
      "Average-G (AVEGFLAG) is treated as activated at the reconstructed PDI " +
      "checkpoint, which is what makes PIPA pulses reach READACCS.",
    basis:
      "Servicer reachability proof: with AVEGFLAG clear in P00, delivered PIPA " +
      "pulses are provably never consumed by the rope.",
    sources: ["src/simulation/agcio/__tests__/servicerReachability.test.ts"],
    confidence: "low",
    falsifiableBy:
      "Rope tracing that shows the flag being set by a program step we skipped.",
  },
  {
    id: "landing-radar-timing",
    category: "sensor-timing",
    statement:
      "Landing-radar altitude is supplied ONLY in answer to a CHAN13 " +
      "solicitation written by the rope; there is no host-side radar timer.",
    basis:
      "M3.3E frozen request-driven RNRAD/RADARUPT transaction; proven in the " +
      "hardware-interface lab against real WASM.",
    sources: ["docs/M3_3E_HARDWARE_INTERFACE_LAB_FREEZE.md"],
    confidence: "high",
    falsifiableBy:
      "Observing a radar transaction on a tick with no CHAN13 solicitation.",
  },
  {
    id: "guidance-target-extraction",
    category: "guidance-extraction",
    statement:
      "AGC intent is read as high-level targets (commanded attitude, descent " +
      "rate, throttle tendency, program phase) rather than as direct engine " +
      "words, because the uncertain-word mapping is not yet proven.",
    basis:
      "Deliberate M4.5a scope decision: an adapter with declared bounds is more " +
      "defensible than an unverified word-to-thrust map.",
    sources: ["docs/M4_5A_RECONSTRUCTED_AGC_GUIDANCE.md"],
    confidence: "medium",
    falsifiableBy:
      "A verified decode of the guidance words that disagrees with the targets.",
  },
  {
    id: "control-electronics-response",
    category: "control-electronics",
    statement:
      "The LM control electronics, DPS throttle actuator and gimbal response " +
      "are approximated by a first-order lag with hard rate and authority " +
      "limits; no historical transfer function is claimed.",
    basis:
      "The AGC never drove the engine directly — commands passed through the " +
      "LM control and propulsion electronics. The adapter stands in for those.",
    sources: ["Grumman LM Vehicle Familiarization Manual (1969), general behaviour"],
    confidence: "low",
    falsifiableBy:
      "Measured DPS throttle slew or RCS attitude response outside the bounds.",
  },
  {
    id: "program-transition-conditions",
    category: "program-transition",
    statement:
      "Where rope-driven P63/P64/P66 transition conditions cannot be observed, " +
      "the historically grounded procedure bridge supplies the transition.",
    basis: "Frozen M4.1 procedure bridge; kept as the reliable default mode.",
    sources: ["docs/M4_1_PLAYABLE_DESCENT.md"],
    confidence: "medium",
    falsifiableBy:
      "Observing the rope announce the phase change itself on the same tick.",
  },
] as const;

export function assumptionById(id: string): ReconstructionAssumptionV1 {
  const a = RECONSTRUCTION_ASSUMPTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`undeclared reconstruction assumption: ${id}`);
  return a;
}

/** Throws if any referenced assumption id is not declared in the registry. */
export function assertAssumptionsDeclared(ids: readonly string[]): void {
  for (const id of ids) assumptionById(id);
}
