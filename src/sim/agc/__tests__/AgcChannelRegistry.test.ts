// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { AGC_CHANNELS, DSKY_KEYS, DSKY_LAMPS } from "../AgcChannelRegistry";

describe("AgcChannelRegistry", () => {
  it("documents the DSKY-critical channels in octal", () => {
    const nums = AGC_CHANNELS.map((c) => c.channel);
    for (const ch of [0o10, 0o11, 0o13, 0o15, 0o32, 0o163]) {
      expect(nums).toContain(ch);
    }
  });

  it("uses correct Luminary keycodes (octal)", () => {
    expect(DSKY_KEYS.VERB).toBe(0o21);
    expect(DSKY_KEYS.NOUN).toBe(0o37);
    expect(DSKY_KEYS.ENTR).toBe(0o34);
    expect(DSKY_KEYS.KEY_REL).toBe(0o31);
    expect(DSKY_KEYS.RSET).toBe(0o22);
  });

  it("DSKY_LAMPS bit positions are unique", () => {
    const values = Object.values(DSKY_LAMPS);
    expect(new Set(values).size).toBe(values.length);
  });
});
