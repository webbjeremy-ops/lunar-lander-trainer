// SPDX-License-Identifier: GPL-3.0-or-later
// M4.6A — pure tests for the reconstructed-PDI shadow layer.

import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTED_VALUES,
  REQUIRED_VALUE_CATEGORIES,
  UNRESOLVED_VALUES,
  validateReconstructedValues,
  reconstructedValueById,
} from "../reconstructedValues";
import {
  AVEGFBIT_MASK,
  FLAGWRD7_ADDRESS,
  MODREG_ADDRESS,
  OBSERVED_AT_INSTALL,
  RECONSTRUCTED_PDI_SHADOW_PAD_LOAD_V1 as MANIFEST,
  buildAuditTable,
  encodeShadowPadLoad,
  resolveRecord,
  validateShadowPadLoad,
  type ShadowPadLoadRecord,
} from "../pdiShadowPadLoad";
import {
  INACTIVE_SHADOW_PROFILE,
  RECONSTRUCTED_PDI_SHADOW_PROFILE_ID,
  SHADOW_BANNER_LINES,
  SHADOW_PROFILE_IS_DEFAULT,
  applyAgcEpoch,
  exitShadowProfile,
} from "../shadowProfile";
import {
  SHADOW_MONITOR_FIELDS,
  classifyPipaConsumption,
  classifyRadarConsumption,
  monitorField,
  presentObservable,
} from "../shadowObservables";
import {
  buildShadowTrace,
  exportShadowTrace,
  shadowTraceChecksum,
  type ShadowTraceSampleV1,
} from "../shadowTrace";
import {
  M4_6A_OBSERVED_RESULT,
  M4_6A_VERDICT,
  classifyShadowOutcome,
} from "../verdict";
import { LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 } from "@/simulation/agcio/padLoadManifest";

describe("M4.6A reconstructed-value registry", () => {
  it("is complete, unique and only cites declared M4.5a assumptions", () => {
    expect(validateReconstructedValues()).toEqual([]);
  });

  it("covers every required category", () => {
    for (const c of REQUIRED_VALUE_CATEGORIES) {
      expect(RECONSTRUCTED_VALUES.some((v) => v.category === c)).toBe(true);
    }
  });

  it("declares unresolved values instead of guessing them", () => {
    const ids = UNRESOLVED_VALUES.map((v) => v.id);
    expect(ids).toContain("nav.rn-vn");
    expect(ids).toContain("site.rls");
    expect(ids).toContain("averageg.integration-state");
    for (const v of UNRESOLVED_VALUES) expect(v.uncertainty.length).toBeGreaterThan(0);
  });

  it("rejects an undeclared value id", () => {
    expect(() => reconstructedValueById("nope")).toThrow();
  });
});

describe("M4.6A experimental pad-load manifest", () => {
  it("validates clean", () => {
    expect(validateShadowPadLoad()).toEqual([]);
  });

  it("does not touch the frozen M3.3E manifest", () => {
    expect(LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1.id).toBe(
      "luminary099-fixed-attitude-descent-padload-v1",
    );
    expect(MANIFEST.id).not.toBe(LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1.id);
    const frozen = new Set(
      LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1.records.map((r) => r.address),
    );
    for (const r of MANIFEST.records) expect(frozen.has(r.address)).toBe(false);
  });

  it("requires P00 and carries a rope citation on every record", () => {
    expect(MANIFEST.requiredMajorMode).toBe(0);
    for (const r of MANIFEST.records) {
      expect(r.ropeCitation).toMatch(/911e5c0/);
      expect(r.purpose.length).toBeGreaterThan(0);
    }
  });

  it("rejects duplicates, out-of-window addresses, illegal words and MODREG", () => {
    const base = MANIFEST.records[0];
    const bad = (over: Partial<ShadowPadLoadRecord>): ShadowPadLoadRecord =>
      ({ ...base, ...over }) as ShadowPadLoadRecord;

    const dup = validateShadowPadLoad({ ...MANIFEST, records: [base, base] });
    expect(dup.some((e) => e.kind === "duplicate-address")).toBe(true);

    const oob = validateShadowPadLoad({
      ...MANIFEST,
      records: [bad({ address: 9999, addressOctal: "0o23417" })],
    });
    expect(oob.some((e) => e.kind === "address-out-of-window")).toBe(true);

    const word = validateShadowPadLoad({
      ...MANIFEST,
      records: [bad({ value: 0o100000 })],
    });
    expect(word.some((e) => e.kind === "illegal-word")).toBe(true);

    const modreg = validateShadowPadLoad({
      ...MANIFEST,
      records: [bad({ address: MODREG_ADDRESS, addressOctal: "0o1011" })],
    });
    expect(modreg.some((e) => e.kind === "major-mode-must-not-be-written")).toBe(true);

    const octal = validateShadowPadLoad({
      ...MANIFEST,
      records: [bad({ addressOctal: "0o777" })],
    });
    expect(octal.some((e) => e.kind === "octal-mismatch")).toBe(true);
  });

  it("resolves the AVEGFLAG record against the observed word (compare-before-write)", () => {
    const rec = MANIFEST.records[0];
    expect(rec.address).toBe(FLAGWRD7_ADDRESS);
    expect(rec.expectedBefore).toBe(OBSERVED_AT_INSTALL);
    const r = resolveRecord(rec, 0o100);
    expect(r.expectedBefore).toBe(0o100);
    expect(r.value).toBe(0o100 | AVEGFBIT_MASK);
    expect(r.value & AVEGFBIT_MASK).toBe(AVEGFBIT_MASK);
  });

  it("encodes the exact little-endian v4 record layout", () => {
    const bytes = encodeShadowPadLoad([
      { address: FLAGWRD7_ADDRESS, expectedBefore: 0o100, value: 0o120 },
    ]);
    expect(bytes.length).toBe(6);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint16(0, true)).toBe(FLAGWRD7_ADDRESS);
    expect(dv.getUint16(2, true)).toBe(0o100);
    expect(dv.getUint16(4, true)).toBe(0o120);
  });

  it("builds the audit table from observed words only", () => {
    const rows = buildAuditTable([0o100]);
    expect(rows).toHaveLength(MANIFEST.records.length);
    expect(rows[0]).toMatchObject({
      symbol: "FLAGWRD7",
      addressOctal: "0o103",
      previousValueOctal: "0o100",
      installedValueOctal: "0o120",
      confidence: "source-derived",
    });
  });
});

describe("M4.6A experimental profile lifecycle", () => {
  it("is never the default descent mode", () => {
    expect(SHADOW_PROFILE_IS_DEFAULT).toBe(false);
    expect(INACTIVE_SHADOW_PROFILE.active).toBe(false);
    expect(SHADOW_BANNER_LINES[0]).toBe("EXPERIMENTAL LUMINARY SHADOW MODE");
    expect(SHADOW_BANNER_LINES.join(" ")).toMatch(/NOT THE ORIGINAL APOLLO 11 INPUT DECK/);
    expect(SHADOW_BANNER_LINES.join(" ")).toMatch(/NO AGC CONTROL OF VEHICLE PHYSICS/);
  });

  it("invalidates installed state on a new AGC epoch (reset)", () => {
    const installed = {
      profileId: RECONSTRUCTED_PDI_SHADOW_PROFILE_ID,
      active: true,
      bootstrap: "installed",
      installedInAgcEpoch: 3,
    } as const;
    expect(applyAgcEpoch(installed, 3)).toBe(installed);
    const after = applyAgcEpoch(installed, 4);
    expect(after.bootstrap).toBe("invalidated");
    expect(after.active).toBe(false);
    expect(after.installedInAgcEpoch).toBeNull();
  });

  it("profile exit removes all experimental state", () => {
    expect(exitShadowProfile()).toEqual(INACTIVE_SHADOW_PROFILE);
  });
});

describe("M4.6A observables: delivered is not consumed", () => {
  it("declares confidence and citations for every field", () => {
    for (const f of SHADOW_MONITOR_FIELDS) {
      expect(f.ropeCitations.length).toBeGreaterThan(0);
      expect(["source-derived", "probable", "unresolved"]).toContain(f.confidence);
    }
  });

  it("keeps unresolved scales as raw octal", () => {
    const rn = monitorField("RN");
    expect(rn.scale).toBeNull();
    expect(presentObservable(rn, 0o1234)).toBe("0o1234 (UNRESOLVED SCALE)");
  });

  it("preserves the THRUST/DECA warning", () => {
    expect(monitorField("THRUST (out-counter 0o55)").meaning).toMatch(
      /DECA SUMMING JUNCTION/,
    );
    expect(monitorField("THRUST (out-counter 0o55)").meaning).toMatch(
      /NOT PHYSICAL ENGINE THRUST/,
    );
  });

  it("never reports delivery as consumption", () => {
    expect(
      classifyPipaConsumption({ pulsesDelivered: 350, drainEvents: 0, servicerRunning: false }),
    ).toBe("not-consumed");
    expect(
      classifyPipaConsumption({ pulsesDelivered: 350, drainEvents: 4, servicerRunning: true }),
    ).toBe("consumed");
    expect(
      classifyPipaConsumption({ pulsesDelivered: 0, drainEvents: 0, servicerRunning: false }),
    ).toBe("indeterminate");
  });

  it("reports no radar consumption when the rope never solicited", () => {
    expect(
      classifyRadarConsumption({
        requestsObserved: 0,
        responsesDelivered: 0,
        updatesAccepted: 0,
      }),
    ).toBe("indeterminate");
  });
});

const SAMPLE: ShadowTraceSampleV1 = {
  missionTimeUs: 20_000,
  referencePhase: "p63",
  altitudeM: 15_231.5,
  horizontalSpeedMps: 1_694.6,
  verticalSpeedMps: -0.4,
  referencePitchRad: -1.47,
  referenceThrottle: 0.94,
  majorMode: 63,
  wchPhase: 0,
  avegflag: true,
  servicerRunning: false,
  rnRaw: [0, 0],
  vnRaw: [0, 0],
  pipaCounters: [5, 0, 2],
  pipaPulsesDelivered: 7,
  radarRequests: 0,
  alarmCodeOctal: "0o1107",
  restarts: 0,
};

describe("M4.6A shadow trace", () => {
  it("is deterministic for identical sample series", () => {
    const a = buildShadowTrace("apollo11-descent", [SAMPLE, SAMPLE]);
    const b = buildShadowTrace("apollo11-descent", [SAMPLE, SAMPLE]);
    expect(a.checksum).toBe(b.checksum);
    expect(exportShadowTrace(a)).toBe(exportShadowTrace(b));
  });

  it("changes when any observed quantity changes", () => {
    const base = shadowTraceChecksum([SAMPLE]);
    expect(shadowTraceChecksum([{ ...SAMPLE, majorMode: 64 }])).not.toBe(base);
    expect(shadowTraceChecksum([{ ...SAMPLE, pipaCounters: [6, 0, 2] }])).not.toBe(base);
  });
});

describe("M4.6A verdict classifier", () => {
  it("classifies the recorded acceptance observation as FAIL", () => {
    expect(M4_6A_VERDICT.verdict).toBe("FAIL");
    expect(M4_6A_VERDICT.recommendM4_6B).toBe(false);
    expect(M4_6A_VERDICT.blockers).toContain("pipa-repeatedly-consumed");
    expect(M4_6A_VERDICT.blockers).toContain("average-g-path-active");
    expect(M4_6A_VERDICT.blockers).toContain("authentic-radar-request");
  });

  it("records the positive findings honestly", () => {
    expect(M4_6A_OBSERVED_RESULT.bootstrapInstalled).toBe(true);
    expect(M4_6A_OBSERVED_RESULT.p63EnteredViaDsky).toBe(true);
    expect(M4_6A_OBSERVED_RESULT.majorModeAfterEntry).toBe(63);
    expect(M4_6A_OBSERVED_RESULT.repeatingAlarmOrRestartLoop).toBe(false);
  });

  it("would only recommend M4.6B on a full PASS", () => {
    const pass = classifyShadowOutcome({
      ...M4_6A_OBSERVED_RESULT,
      servicerRunning: true,
      navigationStateEvolved: true,
      guidanceQuantityEvolved: true,
      delivery: {
        ...M4_6A_OBSERVED_RESULT.delivery,
        radarRequestsObserved: 3,
        radarResponsesDelivered: 3,
        radarUpdatesAccepted: 3,
      },
      consumption: {
        ...M4_6A_OBSERVED_RESULT.consumption,
        pipa: "consumed",
        pipaDrainEvents: 12,
        servicerRunning: true,
        navigationStateEvolved: true,
        radar: "consumed",
      },
    });
    expect(pass.verdict).toBe("PASS");
    expect(pass.recommendM4_6B).toBe(true);
  });

  it("classifies PARTIAL only when the rope actually consumes sensors", () => {
    const partial = classifyShadowOutcome({
      ...M4_6A_OBSERVED_RESULT,
      servicerRunning: true,
      consumption: {
        ...M4_6A_OBSERVED_RESULT.consumption,
        pipa: "consumed",
        pipaDrainEvents: 5,
        servicerRunning: true,
      },
    });
    expect(partial.verdict).toBe("PARTIAL");
    expect(partial.recommendM4_6B).toBe(false);
    expect(partial.recommendation).toMatch(/M5\.0/);
  });
});
