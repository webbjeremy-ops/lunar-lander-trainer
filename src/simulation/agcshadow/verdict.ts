// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.6A — honest outcome classification.
//
// The verdict is COMPUTED from the observed evidence, so it cannot drift away
// from what the experiment actually showed. `M4_6A_OBSERVED_RESULT` is the
// recorded real-WASM observation from the acceptance run; the real-WASM test
// re-derives it and asserts the classifier agrees.

import type { RopeConsumptionEvidence, SensorDeliveryCounts } from "./shadowObservables";

export type ShadowVerdict = "PASS" | "PARTIAL" | "FAIL";

export interface ShadowEvidenceV1 {
  readonly bootstrapInstalled: boolean;
  /** P63 reached by keying V37E 63E on the real shared DSKY. */
  readonly p63EnteredViaDsky: boolean;
  readonly majorModeAfterEntry: number;
  readonly avegflagRaised: boolean;
  readonly servicerRunning: boolean;
  readonly delivery: SensorDeliveryCounts;
  readonly consumption: RopeConsumptionEvidence;
  readonly navigationStateEvolved: boolean;
  readonly guidanceQuantityEvolved: boolean;
  readonly repeatingAlarmOrRestartLoop: boolean;
  readonly replayChecksumStable: boolean;
}

export interface ShadowVerdictResult {
  readonly verdict: ShadowVerdict;
  readonly passCriteria: readonly { readonly id: string; readonly met: boolean }[];
  readonly blockers: readonly string[];
  /** M4.6B may only be recommended on PASS. */
  readonly recommendM4_6B: boolean;
  readonly recommendation: string;
}

export function classifyShadowOutcome(e: ShadowEvidenceV1): ShadowVerdictResult {
  const passCriteria = [
    { id: "atomic-bootstrap-installed", met: e.bootstrapInstalled },
    { id: "p63-entered-via-real-dsky", met: e.p63EnteredViaDsky && e.majorModeAfterEntry === 63 },
    { id: "average-g-path-active", met: e.avegflagRaised && e.servicerRunning },
    { id: "pipa-repeatedly-consumed", met: e.consumption.pipa === "consumed" },
    { id: "navigation-state-evolves", met: e.navigationStateEvolved },
    { id: "authentic-radar-request", met: e.delivery.radarRequestsObserved > 0 },
    { id: "radar-delivered-through-hardware", met: e.delivery.radarUpdatesAccepted > 0 },
    { id: "no-alarm-or-restart-loop", met: !e.repeatingAlarmOrRestartLoop },
    { id: "guidance-quantity-evolves", met: e.guidanceQuantityEvolved },
    { id: "deterministic-replay-checksum", met: e.replayChecksumStable },
  ];
  const blockers = passCriteria.filter((c) => !c.met).map((c) => c.id);

  let verdict: ShadowVerdict;
  if (blockers.length === 0) {
    verdict = "PASS";
  } else if (
    // PARTIAL requires meaningful rope activity: the rope must at minimum have
    // been reached through the real DSKY AND be consuming delivered sensors.
    e.bootstrapInstalled &&
    e.p63EnteredViaDsky &&
    e.consumption.pipa === "consumed"
  ) {
    verdict = "PARTIAL";
  } else {
    verdict = "FAIL";
  }

  const recommendM4_6B = verdict === "PASS";
  const recommendation = recommendM4_6B
    ? "M4.6B is eligible: bounded adapter work may proceed with the reference controller retained as fallback."
    : "M4.6B is NOT eligible. Freeze these findings and proceed to M5.0 rather than continuing indefinite bootstrap tuning.";

  return { verdict, passCriteria, blockers, recommendM4_6B, recommendation };
}

/**
 * The recorded acceptance observation (real yaAGC + pinned Luminary099 +
 * HW-I/O v4). See docs/M4_6A_RECONSTRUCTED_PDI_SHADOW.md for the full ledger.
 */
export const M4_6A_OBSERVED_RESULT: ShadowEvidenceV1 = {
  bootstrapInstalled: true,
  p63EnteredViaDsky: true,
  majorModeAfterEntry: 63,
  avegflagRaised: true,
  servicerRunning: false,
  delivery: {
    pipaPulsesDelivered: 350,
    pipaBatchesRefused: 0,
    pipaResidualPulses: 0,
    radarRequestsObserved: 0,
    radarResponsesDelivered: 0,
    radarUpdatesAccepted: 0,
    cduStatus: "static-reconstructed",
  },
  consumption: {
    pipa: "not-consumed",
    pipaDrainEvents: 0,
    averageGActive: true,
    servicerRunning: false,
    navigationStateEvolved: false,
    radar: "indeterminate",
    notes: [
      "AVEGFLAG is raised, but SERVICER.agc:42 PREREAD never runs, so READACCS is never scheduled.",
      "PREREAD is reached only from BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc:339-343 (REDO4.2) at TIG-30.",
      "That path needs TIG/TLAND/RLS and a valid state vector, whose erasable scaling is UNRESOLVED in-repo.",
      "PIPA counters increase monotonically under delivery and are never drained.",
      "HW-I/O v4 seals the pad-load window after the first batch per AGC epoch, so the experimental batch cannot be combined with the frozen M3.3E coordinate bootstrap without a rebuild.",
    ],

  },
  navigationStateEvolved: false,
  guidanceQuantityEvolved: false,
  repeatingAlarmOrRestartLoop: false,
  replayChecksumStable: true,
};

export const M4_6A_VERDICT = classifyShadowOutcome(M4_6A_OBSERVED_RESULT);
