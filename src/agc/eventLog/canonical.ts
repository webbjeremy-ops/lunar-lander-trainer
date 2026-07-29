// SPDX-License-Identifier: GPL-3.0-or-later
// Canonical JSON serialization + SHA-256 for event-log exports.
//
// Canonical rules:
//   * Object keys are sorted lexicographically at every depth.
//   * Arrays keep their declared order.
//   * Numbers are serialized with JSON.stringify (finite; NaN/Infinity are
//     rejected — the payload never contains them).
//   * Strings are JSON.stringify-encoded (RFC 8259).
//
// Hashing:
//   * SHA-256 of the UTF-8 canonical payload bytes, lowercase hex.
//   * Only `payload` is hashed. `envelope.exportedAt` and `integrity`
//     are OUTSIDE the hashed region by construction (see schema.ts).

export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonical-json: non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    // BigInt is not JSON — reject explicitly so we never silently coerce.
    throw new Error("canonical-json: bigint not supported");
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error(`canonical-json: unsupported value type ${typeof value}`);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toHex(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 of the canonical JSON encoding of `value`. Async because the
 *  browser's WebCrypto SHA-256 is async; Node exposes the same API on
 *  globalThis.crypto in v20+. */
export async function canonicalSha256(value: unknown): Promise<string> {
  const bytes = utf8(canonicalJsonStringify(value));
  const subtle =
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("canonical-sha256: WebCrypto SubtleCrypto not available");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer);
  return toHex(digest);
}
