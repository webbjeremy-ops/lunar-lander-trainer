// SPDX-License-Identifier: GPL-3.0-or-later
// Observable-state regression checksum. NOT a complete emulator-state dump —
// this is what the determinism tests compare, so it covers every field the
// project treats as a "protected observable" of the simulation.
//
// Canonical byte layout, in this exact order:
//   1. missionTimeUs                8-byte big-endian (bigint)
//   2. timingRemainderNs            4-byte big-endian
//   3. totalAgcSteps                8-byte big-endian (bigint)
//   4. erasable memory              2048 × 2-byte big-endian words
//   5. channels                     sorted by numeric channel, each:
//                                   [2-byte channel BE, 2-byte value BE]
//   6. lamp bits                    4-byte big-endian
//   7. mission-system state         canonical JSON (sorted keys) → UTF-8
//   8. PRNG state                   4-byte big-endian
//   9. eventLog.logVersion          4-byte big-endian
//  10. eventLog.cursor              4-byte big-endian
//
// FNV-1a 32-bit uses Math.imul so the multiplication truncates to 32 bits
// deterministically across engines.

export interface ObservableAgcState {
  missionTimeUs: bigint;
  timingRemainderNs: number;
  totalAgcSteps: bigint;
  erasable: Uint16Array; // 2048 words expected
  channels: ReadonlyMap<number, number> | Record<number, number>;
  lampBits: number;
  missionSystemState: unknown;
  prngState: number;
  eventLogVersion: number;
  eventLogCursor: number;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(bytes: Uint8Array, seed: number = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, n >>> 0, false);
  return b;
}

function u16be(n: number): Uint8Array {
  const b = new Uint8Array(2);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, n & 0xffff, false);
  return b;
}

function u64be(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(0, BigInt.asUintN(64, n), false);
  return b;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Canonical bytes; exposed so tests can diff serializations, not just hashes. */
export function canonicalBytes(state: ObservableAgcState): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(u64be(state.missionTimeUs));
  chunks.push(u32be(state.timingRemainderNs));
  chunks.push(u64be(state.totalAgcSteps));

  // Erasable memory: pad/truncate to 2048 words.
  const erasable = new Uint8Array(2048 * 2);
  const dv = new DataView(erasable.buffer);
  const n = Math.min(state.erasable.length, 2048);
  for (let i = 0; i < n; i++) dv.setUint16(i * 2, state.erasable[i] & 0xffff, false);
  chunks.push(erasable);

  // Channels: sort by numeric channel.
  const entries: [number, number][] =
    state.channels instanceof Map
      ? Array.from(state.channels.entries())
      : Object.entries(state.channels as Record<string, number>).map(
          ([k, v]) => [Number(k), v] as [number, number],
        );
  entries.sort((a, b) => a[0] - b[0]);
  for (const [ch, val] of entries) {
    chunks.push(u16be(ch));
    chunks.push(u16be(val));
  }
  // Terminator so channel list is unambiguous vs. the next field.
  chunks.push(u16be(0xffff));
  chunks.push(u16be(0xffff));

  chunks.push(u32be(state.lampBits >>> 0));
  chunks.push(new TextEncoder().encode(canonicalJson(state.missionSystemState)));
  chunks.push(u32be(state.prngState >>> 0));
  chunks.push(u32be(state.eventLogVersion >>> 0));
  chunks.push(u32be(state.eventLogCursor >>> 0));
  return concat(chunks);
}

export function stateChecksum(state: ObservableAgcState): number {
  return fnv1a32(canonicalBytes(state));
}
