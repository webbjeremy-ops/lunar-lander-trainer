// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { allRelayCodes, decodeRelayCode } from "../DskyRelayTable";
import {
  applyDskyOutput,
  applyDskyOutputBatch,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "../DskyDecoder";
import { parseCh010, SELECTOR_TABLE } from "../DskyChannelMap";

function encodeCh010(opts: { codeA?: number; codeB?: number; sign?: number; selector: number }): number {
  const a = (opts.codeA ?? 0) & 0b11111;
  const b = (opts.codeB ?? 0) & 0b11111;
  const s = (opts.sign ?? 0) & 0b1;
  const sel = opts.selector & 0b1111;
  return (a << 10) | (b << 5) | (s << 4) | sel;
}

describe("relay table", () => {
  it("decodes all listed relay codes to expected digits", () => {
    expect(decodeRelayCode(0b10101).value).toBe(0);
    expect(decodeRelayCode(0b00011).value).toBe(1);
    expect(decodeRelayCode(0b11001).value).toBe(2);
    expect(decodeRelayCode(0b11011).value).toBe(3);
    expect(decodeRelayCode(0b01111).value).toBe(4);
    expect(decodeRelayCode(0b11110).value).toBe(5);
    expect(decodeRelayCode(0b11100).value).toBe(6);
    expect(decodeRelayCode(0b10011).value).toBe(7);
    expect(decodeRelayCode(0b11101).value).toBe(8);
    expect(decodeRelayCode(0b11111).value).toBe(9);
  });

  it("returns blank for all unlisted 5-bit codes", () => {
    const listed = new Set([0, 0b10101, 0b00011, 0b11001, 0b11011, 0b01111, 0b11110, 0b11100, 0b10011, 0b11101, 0b11111]);
    for (const { code, value, segments } of allRelayCodes()) {
      if (!listed.has(code)) {
        expect(value, `code ${code} should be blank`).toBeNull();
        expect(segments).toBe(0);
      }
    }
  });
});

describe("channel 010 parsing", () => {
  it("splits AAAAA BBBBB S CCCC correctly", () => {
    const w = encodeCh010({ codeA: 0b11101, codeB: 0b10101, sign: 1, selector: 11 });
    const p = parseCh010(w);
    expect(p.codeA).toBe(0b11101);
    expect(p.codeB).toBe(0b10101);
    expect(p.sign).toBe(1);
    expect(p.selector).toBe(11);
  });
});

describe("dsky decoder — latched, ordered", () => {
  it("initial state is blank with no annunciators", () => {
    const s = makeEmptyDecodedDsky();
    expect(decodedDskyCanonical(s)).toContain("PROG:__");
    expect(decodedDskyCanonical(s)).toContain("VERB:__");
    expect(decodedDskyCanonical(s)).toContain("R1:..__" + "___");
    for (const v of Object.values(s.annunciators)) expect(v).toBe(false);
  });

  it("latches VERB 11 (11) via selector 11 (both digits = 1)", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyOutput(s, encodeCh010({ codeA: 0b00011, codeB: 0b00011, selector: 11 }));
    expect(s.verb.digits[0].value).toBe(1);
    expect(s.verb.digits[1].value).toBe(1);
  });

  it("preserves R1 digits across an unrelated selector 3 sign latch", () => {
    const s = makeEmptyDecodedDsky();
    // Set R1 D2/D3 to 4,5 via selector 8
    applyDskyOutput(s, encodeCh010({ codeA: 0b01111, codeB: 0b11110, selector: 8 }));
    expect(s.r1.digits[1].value).toBe(4);
    expect(s.r1.digits[2].value).toBe(5);
    // Selector 6 (R2 sign) must not touch R1.
    applyDskyOutput(s, encodeCh010({ sign: 1, selector: 6 }));
    expect(s.r1.digits[1].value).toBe(4);
    expect(s.r1.digits[2].value).toBe(5);
  });

  it("PLUS and MINUS latches are independent for R2", () => {
    const s = makeEmptyDecodedDsky();
    // sign=1, codeA bit0=0 → plus on, minus off
    applyDskyOutput(s, encodeCh010({ sign: 1, codeA: 0b00000, selector: 6 }));
    expect(s.r2.sign).toEqual({ plus: true, minus: false });
    // sign=0, codeA bit0=1 → plus off, minus on
    applyDskyOutput(s, encodeCh010({ sign: 0, codeA: 0b00001, selector: 6 }));
    expect(s.r2.sign).toEqual({ plus: false, minus: true });
    // both bits on — both-on state is preserved (surfaces anomaly, not masked)
    applyDskyOutput(s, encodeCh010({ sign: 1, codeA: 0b00001, selector: 6 }));
    expect(s.r2.sign).toEqual({ plus: true, minus: true });
  });

  it("selector 12 sets and clears annunciator bits independently", () => {
    const s = makeEmptyDecodedDsky();
    // Turn on COMP ACTY (A bit0), KEY REL (B bit2), VN flash (sign=1)
    applyDskyOutput(s, encodeCh010({ codeA: 0b00001, codeB: 0b00100, sign: 1, selector: 12 }));
    expect(s.annunciators.compActy).toBe(true);
    expect(s.annunciators.keyRelease).toBe(true);
    expect(s.annunciators.verbNounFlash).toBe(true);
    expect(s.annunciators.operError).toBe(false);
    // Clear KEY REL and VN flash; leave COMP ACTY on
    applyDskyOutput(s, encodeCh010({ codeA: 0b00001, codeB: 0b00000, sign: 0, selector: 12 }));
    expect(s.annunciators.keyRelease).toBe(false);
    expect(s.annunciators.verbNounFlash).toBe(false);
    expect(s.annunciators.compActy).toBe(true);
  });

  it("selector 12 also updates PROG digits", () => {
    const s = makeEmptyDecodedDsky();
    // PROG = "63"
    applyDskyOutput(s, encodeCh010({ codeA: 0b11100, codeB: 0b11011, selector: 12 }));
    expect(s.program.digits[0].value).toBe(6);
    expect(s.program.digits[1].value).toBe(3);
  });

  it("deterministic: same event stream ⇒ identical canonical output", () => {
    const words = [
      encodeCh010({ codeA: 0b00011, codeB: 0b11001, selector: 11 }),
      encodeCh010({ codeA: 0b11001, codeB: 0b00011, selector: 10 }),
      encodeCh010({ codeA: 0b11100, codeB: 0b11011, selector: 12, sign: 1 }),
      encodeCh010({ sign: 1, codeA: 0, selector: 9 }),
      encodeCh010({ codeA: 0b11101, codeB: 0b10101, selector: 8 }),
    ];
    const a = applyDskyOutputBatch(makeEmptyDecodedDsky(), words);
    const b = applyDskyOutputBatch(makeEmptyDecodedDsky(), words);
    expect(decodedDskyCanonical(a)).toBe(decodedDskyCanonical(b));
  });

  it("selector table covers all 12 slots without gaps", () => {
    for (let i = 1; i <= 12; i++) expect(SELECTOR_TABLE[i]).toBeDefined();
  });
});
