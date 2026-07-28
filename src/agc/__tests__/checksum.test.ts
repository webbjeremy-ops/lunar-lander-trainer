import { describe, it, expect } from "vitest";
import { fnv1a32 } from "../checksum";

describe("checksum fnv1a32", () => {
  it("is deterministic and length-sensitive", () => {
    const a = fnv1a32(new Uint8Array([1, 2, 3, 4]));
    const b = fnv1a32(new Uint8Array([1, 2, 3, 4]));
    const c = fnv1a32(new Uint8Array([1, 2, 3, 5]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("known vector for empty input", () => {
    // FNV offset basis 32-bit
    expect(fnv1a32(new Uint8Array())).toBe(0x811c9dc5 >>> 0);
  });
});
