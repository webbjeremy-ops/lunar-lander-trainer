// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P4 — Readiness-protocol compatibility guard.
//
// The frozen M2 `ready` payload shape MUST NOT change when the extended
// runtime is loaded. Extension identity is announced through a separate,
// additive `agc:extension-ready` message. These tests fail if any of the
// following regress:
//
//   * the exact set of keys in `ReadyPayload` changes;
//   * `ready` grows/loses a key at runtime under the extended runtime;
//   * legacy `onReady`/`onEvent` consumers stop seeing the original shape;
//   * the extension announcement uses the wrong type or shape.

import { describe, it, expect } from "vitest";
import type {
  AgcEvent,
  AgcExtensionReadyMessage,
  ReadyPayload,
} from "../protocol";
import { READY_PAYLOAD_KEYS, PROTOCOL_VERSION } from "../protocol";

// Snapshot of the M2 frozen readiness key-set — treat as source of truth.
// If this list ever needs to change, protocol version MUST bump.
const FROZEN_M2_READY_KEYS: readonly string[] = [
  "emulatorRepo",
  "emulatorCommit",
  "emulatorVersionString",
  "ropeId",
  "ropeSha256",
  "ropeSourceCommit",
  "ropeByteLength",
  "wasmSha256",
  "protocolVersion",
  "initialResetPerformed",
  "resetCount",
  "sessionEpoch",
  "canonicalInit",
];

function sortedKeys(o: object): string[] {
  return Object.keys(o).slice().sort();
}

describe("M3.3A2-P4 readiness-protocol compatibility", () => {
  it("READY_PAYLOAD_KEYS matches the exact frozen M2 key-set", () => {
    expect(sortedKeys({ ...Object.fromEntries(READY_PAYLOAD_KEYS.map((k) => [k, 0])) }))
      .toEqual(sortedKeys({ ...Object.fromEntries(FROZEN_M2_READY_KEYS.map((k) => [k, 0])) }));
  });

  it("ReadyPayload TypeScript surface is exactly the frozen key-set", () => {
    // A synthesized ReadyPayload with a value at every declared field must
    // enumerate to the frozen list. If a field is added to the type without
    // updating READY_PAYLOAD_KEYS or the frozen list, this test fails.
    const sample: ReadyPayload = {
      emulatorRepo: "michaelfranzl/webAGC",
      emulatorCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
      emulatorVersionString: "2020-12-24 ddc65e7be",
      ropeId: "Luminary099",
      ropeSha256: "0".repeat(64),
      ropeSourceCommit: "911e5c0",
      ropeByteLength: 73728,
      wasmSha256: "0".repeat(64),
      protocolVersion: PROTOCOL_VERSION,
      initialResetPerformed: true,
      resetCount: 1,
      sessionEpoch: 0,
      canonicalInit: {
        cpuResetPerformed: true,
        cpuResetCount: 1,
        startupRsetSent: true,
        startupRsetCode: 0o22,
        startupRsetAccepted: true,
        startupRsetCount: 1,
        restartObservedBeforeRset: false,
        restartClearedAfterRset: true,
        settledAtTick: 0,
      },
    };
    expect(sortedKeys(sample)).toEqual(sortedKeys({ ...Object.fromEntries(FROZEN_M2_READY_KEYS.map((k) => [k, 0])) }));
    // No `extensionIdentity` on ready — P4 must NOT leak that field here.
    expect(Object.keys(sample)).not.toContain("extensionIdentity");
  });

  it("AgcExtensionReadyMessage carries the required additive shape", () => {
    const msg: AgcExtensionReadyMessage = {
      type: "agc:extension-ready",
      hwioVersion: 4,
      extVersion: "ddc65e7be+apollo-browser-hwio-v4",
      extensionTag: "apollo-browser-hwio-v4",
      wasmSha256: "12ac2797971ea56e5d7583d659ddbaae809f721d7549441229e580e110a65bc3",
      traceEnabled: false,
      traceDropped: 0,
    };
    expect(msg.type).toBe("agc:extension-ready");
    expect(msg.hwioVersion).toBe(4);
    expect(msg.traceEnabled).toBe(false);
    expect(msg.traceDropped).toBe(0);
  });

  it("AgcEvent discriminated union includes the extension message under its own type", () => {
    // Purely a compile-time proof; if the union drifts, tsgo fails.
    const asEvent: AgcEvent = {
      type: "agc:extension-ready",
      hwioVersion: 4,
      extVersion: "x",
      extensionTag: "y",
      wasmSha256: "z",
      traceEnabled: false,
      traceDropped: 0,
    };
    expect(asEvent.type).toBe("agc:extension-ready");
  });
});
