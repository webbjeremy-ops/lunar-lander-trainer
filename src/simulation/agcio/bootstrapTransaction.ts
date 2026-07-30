// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4B §5 — the Worker-owned bootstrap transaction.
//
// This is the ONLY caller of the HW-I/O v4 pad-load ABI. It is a pure
// function of an injected port + context so its ordering, preconditions and
// failure modes are unit-testable without a Worker.
//
// It is NOT a generic `writeMemory` command: the record set comes from the
// source-derived manifest module and is validated before a window is opened.

import {
  LUMINARY099_FIXED_ATTITUDE_PAD_LOAD_V1 as MANIFEST,
  encodePadLoadRecords,
  validatePadLoadManifest,
  type AgcScenarioPadLoadManifestV1,
} from "./padLoadManifest";
import {
  REFSMMAT_ECADR,
  REFSMMAT_WORD_COUNT,
  CDUX_ADDRESS,
  CDUY_ADDRESS,
  CDUZ_ADDRESS,
  FLAGWRD3_ADDRESS,
  REFSMFLG_MASK,
  LUMINARY099_FIXED_ATTITUDE_IMU_V1 as BOOT,
  cduCountsToDegrees,
  isRightHandedOrthonormal,
  wordsToRefsmmat,
  xnbFromCduDegrees,
} from "./imuBootstrap";

/** Narrow adapter subset. Deliberately excludes every execution control. */
export interface BootstrapPadLoadPort {
  padLoadSupported(): boolean;
  hwioVersion(): number;
  padLoadStatus(): number;
  padLoadAppliedCount(): number;
  padLoadLastErrorIndex(): number;
  openPadLoadWindow(): number;
  closePadLoadWindow(): number;
  applyPadLoad(encoded: Uint8Array, count: number): number;
  readErasableWord(address: number): number;
  traceEnabled(): boolean;
}

export interface BootstrapContext {
  /** Mission clock must be paused for the whole transaction. */
  readonly clockPaused: boolean;
  /** Any monitor profile other than "off" forbids the transaction. */
  readonly monitorProfile: string;
  /** Bounded diagnostic ring must be empty. */
  readonly traceRingCount: number;
  /** Host HW-input batch must be empty. */
  readonly pendingHwInputRecords: number;
  readonly ropeId: string | null;
  readonly ropeSha256: string;
  readonly runtimeSha256: string;
  readonly agcEpoch: number;
  readonly simulationEpoch: number;
  /** Epoch in which a bootstrap was already installed, if any. */
  readonly installedInAgcEpoch: number | null;
  /** AGC major mode observed by the caller (P00 required). */
  readonly majorMode: number;
  /** Scenario the bootstrap is declared for. */
  readonly scenarioId: string;
  readonly allowedScenarioIds: readonly string[];
}

export interface BootstrapFailure {
  readonly code: string;
  readonly detail: string;
}

export interface BootstrapResult {
  readonly ok: boolean;
  readonly installedWords: number;
  readonly agcEpoch: number;
  readonly manifestId: string;
  readonly failures: readonly BootstrapFailure[];
  /** Read-back words, in manifest order, on success. */
  readonly readBack: readonly number[];
}

const CANONICAL_HWIO_VERSION = 4;

function preconditionFailures(
  ctx: BootstrapContext,
  manifest: AgcScenarioPadLoadManifestV1,
  port: BootstrapPadLoadPort,
): BootstrapFailure[] {
  const f: BootstrapFailure[] = [];
  if (!port.padLoadSupported() || port.hwioVersion() !== CANONICAL_HWIO_VERSION) {
    f.push({ code: "hwio-version", detail: `pad load requires HW-I/O v${CANONICAL_HWIO_VERSION}` });
  }
  if (!ctx.clockPaused) f.push({ code: "clock-running", detail: "mission clock must be paused" });
  if (ctx.monitorProfile !== "off") {
    f.push({ code: "monitor-active", detail: `profile ${ctx.monitorProfile} is active` });
  }
  if (port.traceEnabled()) f.push({ code: "trace-enabled", detail: "output trace is armed" });
  if (ctx.traceRingCount !== 0) {
    f.push({ code: "trace-not-empty", detail: `${ctx.traceRingCount} retained events` });
  }
  if (ctx.pendingHwInputRecords !== 0) {
    f.push({ code: "hw-input-pending", detail: "a host input batch is pending" });
  }
  if (ctx.ropeId !== "Luminary099" || ctx.ropeSha256 !== manifest.ropeSha256) {
    f.push({ code: "rope-provenance", detail: "loaded rope is not the pinned Luminary099" });
  }
  if (ctx.runtimeSha256 !== manifest.runtimeSha256) {
    f.push({ code: "runtime-provenance", detail: "running runtime is not the canonical artifact" });
  }
  if (ctx.majorMode !== manifest.requiredMajorMode) {
    f.push({ code: "major-mode", detail: `requires major mode ${manifest.requiredMajorMode}` });
  }
  if (!ctx.allowedScenarioIds.includes(ctx.scenarioId)) {
    f.push({ code: "scenario-incompatible", detail: ctx.scenarioId });
  }
  if (ctx.installedInAgcEpoch === ctx.agcEpoch) {
    f.push({ code: "already-installed", detail: `AGC epoch ${ctx.agcEpoch}` });
  }
  if (port.padLoadStatus() !== 0) {
    f.push({ code: "window-not-pristine", detail: `status ${port.padLoadStatus()}` });
  }
  return f;
}

/** Decode the installed words and prove the coordinate chain end to end. */
function verifyReadBack(port: BootstrapPadLoadPort): BootstrapFailure[] {
  const f: BootstrapFailure[] = [];
  const words: number[] = [];
  for (let i = 0; i < REFSMMAT_WORD_COUNT; i++) {
    words.push(port.readErasableWord(REFSMMAT_ECADR + i));
  }
  if (words.some((w) => w < 0 || w > 0o77777)) {
    f.push({ code: "readback-word", detail: "illegal word read back" });
    return f;
  }
  const m = wordsToRefsmmat(words);
  if (!isRightHandedOrthonormal(m, 1e-6)) {
    f.push({ code: "readback-refsmmat", detail: "installed REFSMMAT is not right-handed orthonormal" });
  }
  for (let i = 0; i < 9; i++) {
    if (Math.abs(m[i] - BOOT.refsmmat[i]) > 1e-6) {
      f.push({ code: "readback-refsmmat-mismatch", detail: `element ${i}` });
    }
  }
  const cdu = {
    x: port.readErasableWord(CDUX_ADDRESS),
    y: port.readErasableWord(CDUY_ADDRESS),
    z: port.readErasableWord(CDUZ_ADDRESS),
  };
  if (cdu.x !== BOOT.initialCduCounts.x || cdu.y !== BOOT.initialCduCounts.y ||
      cdu.z !== BOOT.initialCduCounts.z) {
    f.push({ code: "readback-cdu", detail: JSON.stringify(cdu) });
  } else {
    const xnb = xnbFromCduDegrees(
      cduCountsToDegrees(cdu.x), cduCountsToDegrees(cdu.y), cduCountsToDegrees(cdu.z),
    );
    for (let i = 0; i < 9; i++) {
      if (Math.abs(xnb[i] - BOOT.bodyToStableMember[i]) > 1e-9) {
        f.push({ code: "readback-body-matrix", detail: `element ${i}` });
      }
    }
  }
  const flag = port.readErasableWord(FLAGWRD3_ADDRESS);
  if ((flag & REFSMFLG_MASK) !== REFSMFLG_MASK) {
    f.push({ code: "readback-refsmflg", detail: `FLAGWRD3=${flag.toString(8)}` });
  }
  return f;
}

/**
 * Install the fixed-attitude IMU bootstrap atomically.
 *
 * Lifecycle (mandated order):
 *   validate manifest -> verify preconditions -> open window -> apply all
 *   records atomically -> close window (permanently) -> read back and decode
 *   -> report.
 *
 * The caller pauses the clock BEFORE calling and resumes only on `ok: true`.
 * Any failure leaves the bootstrap uninstalled and the window closed.
 */
export function applyFixedAttitudeImuBootstrapV1(
  port: BootstrapPadLoadPort,
  ctx: BootstrapContext,
  manifest: AgcScenarioPadLoadManifestV1 = MANIFEST,
): BootstrapResult {
  const fail = (failures: BootstrapFailure[]): BootstrapResult => ({
    ok: false,
    installedWords: 0,
    agcEpoch: ctx.agcEpoch,
    manifestId: manifest.id,
    failures,
    readBack: [],
  });

  const manifestErrors = validatePadLoadManifest(manifest);
  if (manifestErrors.length > 0) {
    return fail(manifestErrors.map((e) => ({ code: `manifest:${e.kind}`, detail: e.detail })));
  }

  const pre = preconditionFailures(ctx, manifest, port);
  if (pre.length > 0) return fail(pre);

  const opened = port.openPadLoadWindow();
  if (opened !== 0) {
    return fail([{ code: "window-open-failed", detail: `rc=${opened}` }]);
  }

  const encoded = encodePadLoadRecords(manifest.records);
  const rc = port.applyPadLoad(encoded, manifest.records.length);
  // The window is sealed unconditionally — success or failure.
  port.closePadLoadWindow();

  if (rc !== 0) {
    return fail([{
      code: "pad-load-rejected",
      detail: `rc=${rc} at record index ${port.padLoadLastErrorIndex()}`,
    }]);
  }
  if (port.padLoadAppliedCount() !== manifest.records.length) {
    return fail([{ code: "partial-apply", detail: `${port.padLoadAppliedCount()} words` }]);
  }

  const readBack = manifest.records.map((r) => port.readErasableWord(r.address));
  const mismatches = manifest.records
    .map((r, i) => (readBack[i] === r.value ? null : { code: "readback-mismatch", detail: r.symbol }))
    .filter((x): x is BootstrapFailure => x !== null);
  const semantic = verifyReadBack(port);
  const failures = [...mismatches, ...semantic];
  if (failures.length > 0) return fail(failures);

  return {
    ok: true,
    installedWords: manifest.records.length,
    agcEpoch: ctx.agcEpoch,
    manifestId: manifest.id,
    failures: [],
    readBack,
  };
}
