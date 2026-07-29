// SPDX-License-Identifier: GPL-3.0-or-later
// Defensive event-log importer.
//
// Pipeline (each step MUST complete before the next reads the value):
//   bytes → size gate → UTF-8 decode → JSON parse → schema discrimination
//   → structural validation → semantic validation → canonical hash
//   recomputation → integrity comparison → compatibility report
//   → immutable ValidatedAgcEventLogV1 (deep-cloned).
//
// Nothing is trusted before validation. TypeScript casts are used ONLY to
// name intermediate untrusted shapes for the compiler — every field is
// still explicitly checked at runtime.

import { canonicalJsonStringify, canonicalSha256 } from "./canonical";
import {
  AGC_EVENT_LOG_FORMAT,
  AGC_EVENT_LOG_SCHEMA_VERSION,
  type AgcEventLogExportV1,
  type AgcEventLogPayloadV1,
} from "./schema";
import type { DecodedDsky } from "../dsky/DskyTypes";
import { decodedDskyCanonical } from "../dsky/DskyDecoder";
import { DSKY_KEYS } from "@/sim/agc/AgcChannelRegistry";
import {
  IMPORT_LIMITS,
  type ImportErrorCode,
  type ImportResult,
  type ImportValidationError,
  type ValidatedAgcEventLogV1,
} from "./importSchema";
import {
  buildCompatibilityReport,
  type CurrentSessionContext,
} from "./importCompatibility";

// ---- Constants ------------------------------------------------------------

/** Superset of legal DSKY numeric keycodes. Kept in sync with DSKY_KEYS. */
const VALID_KEYCODES: ReadonlySet<number> = new Set(Object.values(DSKY_KEYS));

const VALID_INPUT_KINDS = new Set(["dskyKeyDown", "dskyKeyUp", "proceedKey"]);
const VALID_INPUT_SOURCES = new Set(["dsky", "system"]);

/** AGC output channels use 9-bit addresses (0..0o777). */
const MAX_CHANNEL = 0o777;
/** AGC output values are 15-bit words. Numeric 0..0o77777. */
const MAX_CHANNEL_VALUE = 0o77777;

const SHA256_RE = /^[0-9a-f]{64}$/;

// ---- Validation collector -------------------------------------------------

class Collector {
  errors: ImportValidationError[] = [];
  droppedCount = 0;
  private stopped = false;

  add(code: ImportErrorCode, path: string, message: string): void {
    if (this.stopped) return;
    if (this.errors.length >= IMPORT_LIMITS.maxValidationErrors) {
      this.droppedCount++;
      return;
    }
    this.errors.push({ code, path, message });
  }

  get isFatal(): boolean {
    return this.errors.length > 0;
  }

  /** Immediately stop accumulating; used after top-level rejects (bad
   *  format/schema/size) where continued walking would be misleading. */
  halt(): void {
    this.stopped = true;
  }
}

function invalid(errors: ImportValidationError[], truncated: boolean): ImportResult {
  return { status: "invalid", errors, truncated };
}

// ---- Type-guard helpers ---------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireField(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  c: Collector,
): boolean {
  if (!(key in obj)) {
    c.add("missing-field", `${path}.${key}`, `Required field is missing.`);
    return false;
  }
  return true;
}

function checkType(
  v: unknown,
  expected: "string" | "number" | "boolean" | "object" | "array",
  path: string,
  c: Collector,
): boolean {
  const actual = Array.isArray(v) ? "array" : typeof v;
  const ok = expected === actual;
  if (!ok) c.add("wrong-type", path, `Expected ${expected}, got ${actual}.`);
  return ok;
}

function checkSafeNonNegInt(v: unknown, path: string, c: Collector): v is number {
  if (typeof v !== "number") {
    c.add("wrong-type", path, `Expected number.`);
    return false;
  }
  if (!Number.isSafeInteger(v)) {
    c.add("not-safe-integer", path, `Value is not a safe integer.`);
    return false;
  }
  if (v < 0) {
    c.add("out-of-range", path, `Value must be nonnegative.`);
    return false;
  }
  return true;
}

function checkBoundedString(v: unknown, path: string, c: Collector): v is string {
  if (typeof v !== "string") {
    c.add("wrong-type", path, `Expected string.`);
    return false;
  }
  if (v.length > IMPORT_LIMITS.maxUntrustedStringLen) {
    c.add("string-too-long", path, `String exceeds ${IMPORT_LIMITS.maxUntrustedStringLen} chars.`);
    return false;
  }
  return true;
}

function checkSha256(v: unknown, path: string, c: Collector): v is string {
  if (typeof v !== "string" || !SHA256_RE.test(v)) {
    c.add("invalid-sha256", path, `Expected 64-char lowercase hex SHA-256.`);
    return false;
  }
  return true;
}

// ---- Structural validation ------------------------------------------------

function validateEnvelope(root: Record<string, unknown>, c: Collector): void {
  if (!requireField(root, "envelope", "", c)) return;
  const env = root.envelope;
  if (!isPlainObject(env)) {
    c.add("wrong-type", "envelope", `Expected object.`);
    return;
  }
  if (!requireField(env, "exportedAt", "envelope", c)) return;
  if (typeof env.exportedAt !== "string") {
    c.add("wrong-type", "envelope.exportedAt", "Expected string.");
    return;
  }
  const t = Date.parse(env.exportedAt);
  if (!Number.isFinite(t)) {
    c.add("invalid-timestamp", "envelope.exportedAt", "Not an ISO-8601 timestamp.");
  }
}

function validateProvenance(p: Record<string, unknown>, c: Collector): void {
  const P = "payload.provenance";
  if (!isPlainObject(p)) {
    c.add("wrong-type", P, "Expected object.");
    return;
  }
  for (const k of [
    "emulatorRepo",
    "emulatorCommit",
    "emulatorVersionString",
    "ropeId",
    "ropeSourceCommit",
  ]) {
    if (requireField(p, k, P, c)) checkBoundedString(p[k], `${P}.${k}`, c);
  }
  if (requireField(p, "wasmSha256", P, c)) checkSha256(p.wasmSha256, `${P}.wasmSha256`, c);
  if (requireField(p, "ropeSha256", P, c)) checkSha256(p.ropeSha256, `${P}.ropeSha256`, c);
  if (requireField(p, "ropeByteLength", P, c))
    checkSafeNonNegInt(p.ropeByteLength, `${P}.ropeByteLength`, c);
  if (requireField(p, "protocolVersion", P, c))
    checkSafeNonNegInt(p.protocolVersion, `${P}.protocolVersion`, c);
}

function validateTiming(t: Record<string, unknown>, c: Collector): void {
  const P = "payload.timing";
  if (!isPlainObject(t)) {
    c.add("wrong-type", P, "Expected object.");
    return;
  }
  if (requireField(t, "nominalStepNs", P, c))
    checkSafeNonNegInt(t.nominalStepNs, `${P}.nominalStepNs`, c);
  if (requireField(t, "schedulerTickUs", P, c))
    checkSafeNonNegInt(t.schedulerTickUs, `${P}.schedulerTickUs`, c);
}

function validateSession(s: Record<string, unknown>, c: Collector): void {
  const P = "payload.session";
  if (!isPlainObject(s)) {
    c.add("wrong-type", P, "Expected object.");
    return;
  }
  for (const k of ["sessionEpoch", "resetCount", "startupRsetCode", "settledAtTick"]) {
    if (requireField(s, k, P, c)) checkSafeNonNegInt(s[k], `${P}.${k}`, c);
  }
  for (const k of ["initialResetPerformed", "startupRsetSent"]) {
    if (requireField(s, k, P, c)) {
      if (typeof s[k] !== "boolean")
        c.add("wrong-type", `${P}.${k}`, "Expected boolean.");
    }
  }
}

function validateDskyRegister(r: unknown, path: string, c: Collector): boolean {
  if (!isPlainObject(r)) {
    c.add("invalid-decoded-baseline", path, "Register must be an object.");
    return false;
  }
  const digits = r.digits;
  if (!Array.isArray(digits) || digits.length !== 5) {
    c.add("invalid-decoded-baseline", `${path}.digits`, "Expected non-empty array (\u22648) of digits.");
    return false;
  }
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i];
    if (!isPlainObject(d) || (d.value !== null && typeof d.value !== "number") ||
        typeof d.segments !== "number") {
      c.add("invalid-decoded-baseline", `${path}.digits[${i}]`, "Digit shape invalid.");
      return false;
    }
  }
  if (r.sign !== undefined) {
    if (!isPlainObject(r.sign) || typeof r.sign.plus !== "boolean" ||
        typeof r.sign.minus !== "boolean") {
      c.add("invalid-decoded-baseline", `${path}.sign`, "Sign relays shape invalid.");
      return false;
    }
  }
  return true;
}

function validateBaseline(b: Record<string, unknown>, c: Collector): DecodedDsky | null {
  const P = "payload.baseline";
  if (!isPlainObject(b)) {
    c.add("wrong-type", P, "Expected object.");
    return null;
  }
  if (b.eventId !== 0) {
    c.add("baseline-boundary-mismatch", `${P}.eventId`, "Baseline eventId must be 0.");
  }
  let ok = true;
  for (const k of ["tickIndex", "missionTimeUs", "totalAgcSteps"]) {
    if (!requireField(b, k, P, c) || !checkSafeNonNegInt(b[k], `${P}.${k}`, c)) ok = false;
  }
  if (!requireField(b, "decodedDskyChecksum", P, c) ||
      typeof b.decodedDskyChecksum !== "string") {
    c.add("wrong-type", `${P}.decodedDskyChecksum`, "Expected string.");
    ok = false;
  }
  // Channel values
  const cv = b.channelValues;
  if (!isPlainObject(cv)) {
    c.add("invalid-channel-baseline", `${P}.channelValues`, "Expected object.");
    ok = false;
  } else {
    for (const [key, val] of Object.entries(cv)) {
      const chNum = Number(key);
      if (!Number.isInteger(chNum) || chNum < 0 || chNum > MAX_CHANNEL) {
        c.add("invalid-channel-baseline", `${P}.channelValues["${key}"]`, "Channel key out of range.");
        ok = false;
        continue;
      }
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_CHANNEL_VALUE) {
        c.add("invalid-channel-baseline", `${P}.channelValues["${key}"]`, "Channel value out of range.");
        ok = false;
      }
    }
  }
  // Decoded DSKY structural validation
  const dd = b.decodedDsky;
  if (!isPlainObject(dd)) {
    c.add("invalid-decoded-baseline", `${P}.decodedDsky`, "Expected object.");
    return null;
  }
  for (const reg of ["program", "verb", "noun", "r1", "r2", "r3"]) {
    if (!validateDskyRegister(dd[reg], `${P}.decodedDsky.${reg}`, c)) ok = false;
  }
  const anns = dd.annunciators;
  if (!isPlainObject(anns)) {
    c.add("invalid-decoded-baseline", `${P}.decodedDsky.annunciators`, "Expected object.");
    ok = false;
  } else {
    for (const [k, v] of Object.entries(anns)) {
      if (typeof v !== "boolean") {
        c.add("invalid-decoded-baseline", `${P}.decodedDsky.annunciators.${k}`, "Expected boolean.");
        ok = false;
      }
    }
  }
  if (typeof dd.eventCount !== "number" || !Number.isSafeInteger(dd.eventCount)) {
    c.add("invalid-decoded-baseline", `${P}.decodedDsky.eventCount`, "Expected safe integer.");
    ok = false;
  }
  return ok ? (dd as unknown as DecodedDsky) : null;
}

function validateRetention(r: Record<string, unknown>, c: Collector): void {
  const P = "payload.retention";
  if (!isPlainObject(r)) {
    c.add("wrong-type", P, "Expected object.");
    return;
  }
  if (typeof r.completeEpoch !== "boolean") {
    c.add("wrong-type", `${P}.completeEpoch`, "Expected boolean.");
  }
  if (r.droppedBeforeEventId !== null && !checkSafeNonNegInt(r.droppedBeforeEventId, `${P}.droppedBeforeEventId`, c)) {
    // error already recorded
  }
  if (r.retainedEventLimit !== null && !checkSafeNonNegInt(r.retainedEventLimit, `${P}.retainedEventLimit`, c)) {
    // error already recorded
  }
}

function validateIntegrityCounts(i: Record<string, unknown>, c: Collector): void {
  const P = "payload.integrity";
  if (!isPlainObject(i)) {
    c.add("wrong-type", P, "Expected object.");
    return;
  }
  if (!checkSafeNonNegInt(i.eventCount, `${P}.eventCount`, c)) return;
  if (i.firstEventId !== null && !checkSafeNonNegInt(i.firstEventId, `${P}.firstEventId`, c)) {
    /* recorded */
  }
  if (i.lastEventId !== null && !checkSafeNonNegInt(i.lastEventId, `${P}.lastEventId`, c)) {
    /* recorded */
  }
}

function validateEvent(
  e: unknown,
  path: string,
  sessionEpoch: number,
  c: Collector,
): boolean {
  if (!isPlainObject(e)) {
    c.add("wrong-type", path, "Expected object.");
    return false;
  }
  let ok = true;
  if (e.type !== "inputAccepted" && e.type !== "channelUpdate") {
    c.add("invalid-event-discriminator", `${path}.type`,
      `Unknown event type: ${JSON.stringify(String(e.type)).slice(0, 64)}`);
    return false;
  }
  for (const k of ["eventId", "sessionEpoch", "tickIndex", "missionTimeUs", "totalAgcSteps"]) {
    if (!requireField(e, k, path, c) || !checkSafeNonNegInt(e[k], `${path}.${k}`, c)) ok = false;
  }
  if (typeof e.sessionEpoch === "number" && e.sessionEpoch !== sessionEpoch) {
    c.add("session-epoch-mismatch", `${path}.sessionEpoch`,
      `Event sessionEpoch (${e.sessionEpoch}) differs from payload.session.sessionEpoch (${sessionEpoch}).`);
    ok = false;
  }
  if (e.type === "inputAccepted") {
    if (typeof e.kind !== "string" || !VALID_INPUT_KINDS.has(e.kind)) {
      c.add("invalid-input-kind", `${path}.kind`, "Unknown input kind.");
      ok = false;
    }
    if (typeof e.source !== "string" || !VALID_INPUT_SOURCES.has(e.source)) {
      c.add("invalid-input-source", `${path}.source`, "Unknown input source.");
      ok = false;
    }
    if (e.keyCode !== undefined) {
      if (typeof e.keyCode !== "number" || !Number.isSafeInteger(e.keyCode) || !VALID_KEYCODES.has(e.keyCode)) {
        c.add("invalid-keycode", `${path}.keyCode`, "Unknown DSKY keycode.");
        ok = false;
      } else if (e.keyCode === DSKY_KEYS.RSET && (e.source === "dsky" || e.source === undefined)) {
        // Canonical startup RSET must never appear in the PUBLIC input
        // stream — it is emitted privately before public phase begins.
        c.add("startup-rset-leaked-to-public-input", `${path}.keyCode`,
          "Canonical startup RSET (0o22) must not appear in public input events.");
        ok = false;
      }
    }
    if (e.pressed !== undefined && typeof e.pressed !== "boolean") {
      c.add("wrong-type", `${path}.pressed`, "Expected boolean.");
      ok = false;
    }
  } else {
    // channelUpdate
    if (typeof e.channel !== "number" || !Number.isSafeInteger(e.channel) ||
        e.channel < 0 || e.channel > MAX_CHANNEL) {
      c.add("invalid-channel", `${path}.channel`, "Channel out of range.");
      ok = false;
    }
    if (typeof e.value !== "number" || !Number.isSafeInteger(e.value) ||
        e.value < 0 || e.value > MAX_CHANNEL_VALUE) {
      c.add("out-of-range", `${path}.value`, "Value out of AGC 15-bit range.");
      ok = false;
    }
  }
  return ok;
}

// ---- Public entry point ---------------------------------------------------

export interface ValidateImportOptions {
  /** Present size of the incoming file in bytes. When `input` is a string,
   *  this is the UTF-8 byte length. When `input` is bytes, it is the byte
   *  length. Exceeding IMPORT_LIMITS.maxUploadBytes rejects the file
   *  before any parsing. */
  currentSession?: CurrentSessionContext;
}

export type ImportInput = ArrayBuffer | Uint8Array | string;

/** Validate + integrity-check + classify an event-log import. */
export async function validateImport(
  input: ImportInput,
  opts: ValidateImportOptions = {},
): Promise<ImportResult> {
  // ---- Size gate -----------------------------------------------------
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  if (bytes.byteLength === 0) {
    return invalid([{ code: "empty-file", path: "", message: "File is empty." }], false);
  }
  if (bytes.byteLength > IMPORT_LIMITS.maxUploadBytes) {
    return invalid(
      [{ code: "file-too-large", path: "",
         message: `File exceeds max upload size (${IMPORT_LIMITS.maxUploadBytes} bytes).` }],
      false,
    );
  }
  const fileSizeBytes = bytes.byteLength;

  // ---- UTF-8 decode --------------------------------------------------
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid([{ code: "not-utf8", path: "", message: "File is not valid UTF-8." }], false);
  }

  // ---- JSON parse ----------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return invalid(
      [{ code: "malformed-json", path: "", message: `Malformed JSON: ${String(e).slice(0, 200)}` }],
      false,
    );
  }
  if (!isPlainObject(parsed)) {
    return invalid([{ code: "not-an-object", path: "", message: "Root value must be a JSON object." }], false);
  }

  // ---- Schema discrimination ----------------------------------------
  const root = parsed;
  const c = new Collector();
  if (root.format !== AGC_EVENT_LOG_FORMAT) {
    c.add("wrong-format", "format", `Expected format="${AGC_EVENT_LOG_FORMAT}".`);
    c.halt();
    return invalid(c.errors, c.droppedCount > 0);
  }
  // Unsupported schemaVersion is a SPECIFIC error, not a generic parse fail.
  if (root.schemaVersion !== AGC_EVENT_LOG_SCHEMA_VERSION) {
    c.add("unsupported-schema-version", "schemaVersion",
      `Unsupported schemaVersion: ${JSON.stringify(root.schemaVersion)} (this build supports ${AGC_EVENT_LOG_SCHEMA_VERSION}).`);
    c.halt();
    return invalid(c.errors, c.droppedCount > 0);
  }

  // ---- Envelope + integrity presence --------------------------------
  validateEnvelope(root, c);
  if (!requireField(root, "integrity", "", c)) {
    return invalid(c.errors, c.droppedCount > 0);
  }
  const integrityBlock = root.integrity;
  if (!isPlainObject(integrityBlock) || !checkSha256(integrityBlock.canonicalSha256, "integrity.canonicalSha256", c)) {
    return invalid(c.errors, c.droppedCount > 0);
  }

  // ---- Payload structural validation --------------------------------
  if (!requireField(root, "payload", "", c)) return invalid(c.errors, c.droppedCount > 0);
  const payload = root.payload;
  if (!isPlainObject(payload)) {
    c.add("wrong-type", "payload", "Expected object.");
    return invalid(c.errors, c.droppedCount > 0);
  }
  validateProvenance(payload.provenance as Record<string, unknown>, c);
  validateTiming(payload.timing as Record<string, unknown>, c);
  validateSession(payload.session as Record<string, unknown>, c);
  const decodedBaseline = validateBaseline(payload.baseline as Record<string, unknown>, c);
  validateRetention(payload.retention as Record<string, unknown>, c);
  validateIntegrityCounts(payload.integrity as Record<string, unknown>, c);

  const sessionEpoch =
    isPlainObject(payload.session) && typeof payload.session.sessionEpoch === "number"
      ? (payload.session.sessionEpoch as number)
      : -1;

  // Events
  if (!requireField(payload, "events", "payload", c)) return invalid(c.errors, c.droppedCount > 0);
  const events = payload.events;
  if (!Array.isArray(events)) {
    c.add("wrong-type", "payload.events", "Expected array.");
    return invalid(c.errors, c.droppedCount > 0);
  }
  if (events.length > IMPORT_LIMITS.maxEventCount) {
    c.add("too-many-events", "payload.events",
      `Event array exceeds max (${IMPORT_LIMITS.maxEventCount}).`);
    return invalid(c.errors, c.droppedCount > 0);
  }

  // Per-event structural validation
  for (let i = 0; i < events.length; i++) {
    validateEvent(events[i], `payload.events[${i}]`, sessionEpoch, c);
    if (c.errors.length >= IMPORT_LIMITS.maxValidationErrors) break;
  }
  if (c.isFatal) return invalid(c.errors, c.droppedCount > 0);

  // ---- Semantic validation (single ordered pass) --------------------
  const typedPayload = payload as unknown as AgcEventLogPayloadV1;

  // Monotonicity: strictly increasing eventId; nondecreasing
  // tick / missionTime / totalAgcSteps; each event's sessionEpoch equals
  // the payload's session epoch (already covered per-event above).
  let prevId = 0;
  let prevTick = typedPayload.baseline.tickIndex;
  let prevMet = typedPayload.baseline.missionTimeUs;
  let prevSteps = typedPayload.baseline.totalAgcSteps;
  for (let i = 0; i < typedPayload.events.length; i++) {
    const e = typedPayload.events[i];
    if (e.eventId <= prevId) {
      c.add("event-ids-not-strictly-increasing", `payload.events[${i}].eventId`,
        `Event IDs must be strictly increasing (id=${e.eventId} <= prev=${prevId}).`);
    }
    if (e.tickIndex < prevTick) {
      c.add("non-monotonic-tick", `payload.events[${i}].tickIndex`,
        `tickIndex moved backward (${e.tickIndex} < prev ${prevTick}).`);
    }
    if (e.missionTimeUs < prevMet) {
      c.add("non-monotonic-mission-time", `payload.events[${i}].missionTimeUs`,
        `missionTimeUs moved backward (${e.missionTimeUs} < prev ${prevMet}).`);
    }
    if (e.totalAgcSteps < prevSteps) {
      c.add("non-monotonic-total-steps", `payload.events[${i}].totalAgcSteps`,
        `totalAgcSteps moved backward (${e.totalAgcSteps} < prev ${prevSteps}).`);
    }
    prevId = e.eventId;
    prevTick = e.tickIndex;
    prevMet = e.missionTimeUs;
    prevSteps = e.totalAgcSteps;
    if (c.errors.length >= IMPORT_LIMITS.maxValidationErrors) break;
  }

  // Integrity counts vs actual array.
  const declaredCount = typedPayload.integrity.eventCount;
  if (declaredCount !== typedPayload.events.length) {
    c.add("event-count-mismatch", "payload.integrity.eventCount",
      `eventCount (${declaredCount}) does not match events.length (${typedPayload.events.length}).`);
  }
  const expectedFirst = typedPayload.events.length > 0 ? typedPayload.events[0].eventId : null;
  const expectedLast = typedPayload.events.length > 0
    ? typedPayload.events[typedPayload.events.length - 1].eventId
    : null;
  if (typedPayload.integrity.firstEventId !== expectedFirst) {
    c.add("first-event-id-mismatch", "payload.integrity.firstEventId",
      `firstEventId (${typedPayload.integrity.firstEventId}) does not match events[0].eventId (${expectedFirst}).`);
  }
  if (typedPayload.integrity.lastEventId !== expectedLast) {
    c.add("last-event-id-mismatch", "payload.integrity.lastEventId",
      `lastEventId (${typedPayload.integrity.lastEventId}) does not match events[last].eventId (${expectedLast}).`);
  }

  // Retention consistency: completeEpoch=true is incompatible with a
  // dropped-event marker.
  const ret = typedPayload.retention;
  if (ret.completeEpoch && ret.droppedBeforeEventId !== null) {
    c.add("retention-inconsistent", "payload.retention",
      "completeEpoch=true cannot coexist with a non-null droppedBeforeEventId.");
  }
  // If dropped-before is set and events present, the first eventId must
  // be >= droppedBeforeEventId.
  if (ret.droppedBeforeEventId !== null && expectedFirst !== null &&
      expectedFirst < ret.droppedBeforeEventId) {
    c.add("retention-inconsistent", "payload.retention.droppedBeforeEventId",
      `Retention says events before id ${ret.droppedBeforeEventId} are dropped, but events[0].eventId=${expectedFirst}.`);
  }

  // Baseline event id must be 0 (already checked structurally); baseline
  // precedes the first exported event (first eventId > 0). And session
  // epoch cross-check.
  if (typedPayload.session.sessionEpoch !== sessionEpoch) {
    c.add("session-epoch-mismatch", "payload.session.sessionEpoch",
      "Payload session epoch changed during validation.");
  }

  // Baseline decoded checksum: recompute canonical and compare.
  if (decodedBaseline) {
    let recomputed: string | null = null;
    try {
      recomputed = decodedDskyCanonical(decodedBaseline);
    } catch {
      c.add("invalid-decoded-baseline", "payload.baseline.decodedDsky",
        "decodedDsky failed canonicalization.");
    }
    if (recomputed !== null && recomputed !== typedPayload.baseline.decodedDskyChecksum) {
      c.add("baseline-checksum-mismatch", "payload.baseline.decodedDskyChecksum",
        "Recomputed decoded-DSKY canonical does not match declared checksum.");
    }
  }

  if (c.isFatal) return invalid(c.errors, c.droppedCount > 0);

  // ---- Integrity: recompute canonical SHA-256 from the VALIDATED
  //      payload, then compare to the declared canonicalSha256 --------
  const canonicalHex = await canonicalSha256(typedPayload);
  const declaredHash = (integrityBlock.canonicalSha256 as string).toLowerCase();
  if (canonicalHex !== declaredHash) {
    c.add("integrity-hash-mismatch", "integrity.canonicalSha256",
      "The event log's integrity hash does not match its contents.");
    return invalid(c.errors, c.droppedCount > 0);
  }

  // ---- Deep-clone the whole document to guarantee immutability of the
  //      validated recording (via canonical JSON round trip). --------
  const cloned = JSON.parse(canonicalJsonStringify(root)) as AgcEventLogExportV1;
  // Preserve envelope.exportedAt as originally supplied (canonical JSON
  // already sorts keys but does not drop known fields).
  const validated: ValidatedAgcEventLogV1 = {
    raw: cloned,
    summary: {
      schemaVersion: cloned.schemaVersion,
      exportedAt: cloned.envelope.exportedAt,
      ropeId: cloned.payload.provenance.ropeId,
      ropeSha256: cloned.payload.provenance.ropeSha256,
      emulatorCommit: cloned.payload.provenance.emulatorCommit,
      protocolVersion: cloned.payload.provenance.protocolVersion,
      sessionEpoch: cloned.payload.session.sessionEpoch,
      eventCount: cloned.payload.integrity.eventCount,
      firstEventId: cloned.payload.integrity.firstEventId,
      lastEventId: cloned.payload.integrity.lastEventId,
      firstTickIndex: cloned.payload.events.length > 0 ? cloned.payload.events[0].tickIndex : null,
      lastTickIndex: cloned.payload.events.length > 0
        ? cloned.payload.events[cloned.payload.events.length - 1].tickIndex : null,
      firstMissionTimeUs: cloned.payload.events.length > 0
        ? cloned.payload.events[0].missionTimeUs : null,
      lastMissionTimeUs: cloned.payload.events.length > 0
        ? cloned.payload.events[cloned.payload.events.length - 1].missionTimeUs : null,
      completeEpoch: cloned.payload.retention.completeEpoch,
      droppedBeforeEventId: cloned.payload.retention.droppedBeforeEventId,
      retainedEventLimit: cloned.payload.retention.retainedEventLimit,
      canonicalSha256: cloned.integrity.canonicalSha256.toLowerCase(),
      fileSizeBytes,
    },
  };

  const compatibility = buildCompatibilityReport(validated, opts.currentSession ?? { ready: null });
  const status = compatibility.replayEligible ? "valid-compatible" : "valid-incompatible";
  // Silence unused-import warning: DskyRegister is used only in typedoc.
  return { status, recording: validated, compatibility };
}
