// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify, canonicalSha256 } from "../canonical";

describe("canonicalJsonStringify", () => {
  it("sorts object keys deterministically at every depth", () => {
    const a = { b: 1, a: { z: 2, y: [3, { d: 4, c: 5 }] } };
    const b = { a: { y: [3, { c: 5, d: 4 }], z: 2 }, b: 1 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe(
      '{"a":{"y":[3,{"c":5,"d":4}],"z":2},"b":1}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("skips undefined fields", () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it("rejects non-finite numbers and bigints", () => {
    expect(() => canonicalJsonStringify(NaN)).toThrow(/non-finite/);
    expect(() => canonicalJsonStringify(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalJsonStringify(1n)).toThrow(/bigint/);
  });
});

describe("canonicalSha256", () => {
  it("is stable across key orderings", async () => {
    const a = await canonicalSha256({ a: 1, b: [1, 2], c: { d: 3, e: 4 } });
    const b = await canonicalSha256({ c: { e: 4, d: 3 }, b: [1, 2], a: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when values change", async () => {
    const a = await canonicalSha256({ x: 1 });
    const b = await canonicalSha256({ x: 2 });
    expect(a).not.toBe(b);
  });
});
