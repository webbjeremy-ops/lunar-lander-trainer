// SPDX-License-Identifier: GPL-3.0-or-later
//
// Decoder unit tests. Selector/annunciator tables are transcribed
// source-normative from michaelfranzl/virtualagc @ ddc65e7b... — these
// tests encode that mapping and MUST NOT be relaxed to match a wrong
// decoder implementation.

import { describe, expect, it } from "vitest";
import { allRelayCodes, decodeRelayCode } from "../DskyRelayTable";
import {
  applyDskyChannel011,
  applyDskyChannel0163,
  applyDskyOutput,
  applyDskyOutputBatch,
  decodedDskyCanonical,
  makeEmptyDecodedDsky,
} from "../DskyDecoder";
import {
  ANNUNCIATOR_ROW_TAG_VALUE,
  parseCh010,
  SELECTOR_TABLE,
} from "../DskyChannelMap";

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

describe("selector table (yaDSKY2 source-normative)", () => {
  it("has digit rows 1..11 (12 is the annunciator row, decoded via tag)", () => {
    for (let i = 1; i <= 11; i++) expect(SELECTOR_TABLE[i], `selector ${i}`).toBeDefined();
    expect(SELECTOR_TABLE[12]).toBeUndefined();
  });

  it("selector 8 uses only the right (B) field to drive R1 D1", () => {
    const t = SELECTOR_TABLE[8]!;
    expect(t.fieldA).toBeNull();
    expect(t.fieldB).toEqual({ register: "r1", digit: 0 });
    expect(t.signLatch).toBeUndefined();
  });

  it("selector 3 spans registers: R2 D5 (A) + R3 D1 (B)", () => {
    const t = SELECTOR_TABLE[3]!;
    expect(t.fieldA).toEqual({ register: "r2", digit: 4 });
    expect(t.fieldB).toEqual({ register: "r3", digit: 0 });
    expect(t.signLatch).toBeUndefined();
  });

  it("selectors 7/5/2 latch PLUS, 6/4/1 latch MINUS", () => {
    expect(SELECTOR_TABLE[7]!.signLatch).toEqual({ register: "r1", kind: "plus"  });
    expect(SELECTOR_TABLE[6]!.signLatch).toEqual({ register: "r1", kind: "minus" });
    expect(SELECTOR_TABLE[5]!.signLatch).toEqual({ register: "r2", kind: "plus"  });
    expect(SELECTOR_TABLE[4]!.signLatch).toEqual({ register: "r2", kind: "minus" });
    expect(SELECTOR_TABLE[2]!.signLatch).toEqual({ register: "r3", kind: "plus"  });
    expect(SELECTOR_TABLE[1]!.signLatch).toEqual({ register: "r3", kind: "minus" });
  });
});

describe("dsky decoder — digit rows", () => {
  it("initial state is blank with no annunciators", () => {
    const s = makeEmptyDecodedDsky();
    expect(decodedDskyCanonical(s)).toContain("PROG:__");
    expect(decodedDskyCanonical(s)).toContain("VERB:__");
    expect(decodedDskyCanonical(s)).toContain("R1:..__" + "___");
    for (const v of Object.values(s.annunciators)) expect(v).toBe(false);
  });

  it("selector 11 drives PROG D1 (A) and PROG D2 (B)", () => {
    const s = makeEmptyDecodedDsky();
    // code 0b00011 = digit "1"
    applyDskyOutput(s, encodeCh010({ codeA: 0b00011, codeB: 0b11001, selector: 11 }));
    expect(s.program.digits[0].value).toBe(1);
    expect(s.program.digits[1].value).toBe(2);
  });

  it("selector 8 sets R1 D1 via the B field only", () => {
    const s = makeEmptyDecodedDsky();
    // A=arbitrary, B=digit "8"
    applyDskyOutput(s, encodeCh010({ codeA: 0b11111, codeB: 0b11101, selector: 8 }));
    expect(s.r1.digits[0].value).toBe(8);
    // The other four R1 digits are untouched (still blank).
    for (let i = 1; i < 5; i++) expect(s.r1.digits[i].value).toBeNull();
  });

  it("selector 3 writes R2 D5 (A) and R3 D1 (B) — cross-register span", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyOutput(s, encodeCh010({ codeA: 0b11110, codeB: 0b11100, selector: 3 }));
    expect(s.r2.digits[4].value).toBe(5);
    expect(s.r3.digits[0].value).toBe(6);
    for (let i = 0; i < 4; i++) expect(s.r2.digits[i].value).toBeNull();
    for (let i = 1; i < 5; i++) expect(s.r3.digits[i].value).toBeNull();
  });

  it("PLUS and MINUS latches are independent (selector 5 vs 4 for R2)", () => {
    const s = makeEmptyDecodedDsky();
    // sel 5 with S=1 → R2 PLUS on
    applyDskyOutput(s, encodeCh010({ sign: 1, selector: 5 }));
    expect(s.r2.sign).toEqual({ plus: true, minus: false });
    // sel 4 with S=1 → R2 MINUS on; PLUS stays on
    applyDskyOutput(s, encodeCh010({ sign: 1, selector: 4 }));
    expect(s.r2.sign).toEqual({ plus: true, minus: true });
    // sel 5 with S=0 clears PLUS; MINUS stays on
    applyDskyOutput(s, encodeCh010({ sign: 0, selector: 5 }));
    expect(s.r2.sign).toEqual({ plus: false, minus: true });
  });
});

describe("dsky decoder — selector-12 annunciator row (channel 010)", () => {
  const TAG = ANNUNCIATOR_ROW_TAG_VALUE; // 0o60000

  it("recognizes the row by tag and latches NO ATT / GIMBAL LOCK", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyOutput(s, TAG | 0o10 | 0o40); // NO ATT + GIMBAL LOCK
    expect(s.annunciators.noAtt).toBe(true);
    expect(s.annunciators.gimbalLock).toBe(true);
    expect(s.annunciators.prog).toBe(false);
    expect(s.annunciators.tracker).toBe(false);
    // A non-annunciator selector 11 write MUST NOT touch annunciators.
    applyDskyOutput(s, encodeCh010({ codeA: 0b00011, codeB: 0b00011, selector: 11 }));
    expect(s.annunciators.noAtt).toBe(true);
    expect(s.annunciators.gimbalLock).toBe(true);
  });

  it("clears annunciators when the corresponding mask bit is zero", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyOutput(s, TAG | 0o400 | 0o200); // PROG + TRACKER on
    expect(s.annunciators.prog).toBe(true);
    expect(s.annunciators.tracker).toBe(true);
    applyDskyOutput(s, TAG); // all bits zero
    expect(s.annunciators.prog).toBe(false);
    expect(s.annunciators.tracker).toBe(false);
  });

  it("does NOT modify digit registers", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyOutput(s, encodeCh010({ codeA: 0b11100, codeB: 0b11011, selector: 11 })); // PROG "63"
    applyDskyOutput(s, TAG | 0o10);
    expect(s.program.digits[0].value).toBe(6);
    expect(s.program.digits[1].value).toBe(3);
  });
});

describe("dsky decoder — channel 011 (webAGC synthetic)", () => {
  it("bit 2 → COMP ACTY, bit 3 → UPLINK ACTY", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyChannel011(s, 0o2);
    expect(s.annunciators.compActy).toBe(true);
    expect(s.annunciators.uplinkActy).toBe(false);
    applyDskyChannel011(s, 0o4);
    expect(s.annunciators.compActy).toBe(false);
    expect(s.annunciators.uplinkActy).toBe(true);
    applyDskyChannel011(s, 0o6);
    expect(s.annunciators.compActy).toBe(true);
    expect(s.annunciators.uplinkActy).toBe(true);
  });
});

describe("dsky decoder — channel 0163 (webAGC synthetic)", () => {
  it("latches TEMP / KEY REL / VN FLASH / OPR ERR / RESTART / STBY / EL OFF / AGC warn", () => {
    const s = makeEmptyDecodedDsky();
    applyDskyChannel0163(s, 0o1 | 0o10 | 0o20 | 0o40 | 0o100 | 0o200 | 0o400 | 0o1000);
    expect(s.annunciators.agcWarning).toBe(true);
    expect(s.annunciators.temp).toBe(true);
    expect(s.annunciators.keyRelease).toBe(true);
    expect(s.annunciators.verbNounFlash).toBe(true);
    expect(s.annunciators.operError).toBe(true);
    expect(s.annunciators.restart).toBe(true);
    expect(s.annunciators.standby).toBe(true);
    expect(s.annunciators.elOff).toBe(true);
    applyDskyChannel0163(s, 0);
    for (const k of ["agcWarning","temp","keyRelease","verbNounFlash","operError","restart","standby","elOff"] as const) {
      expect(s.annunciators[k]).toBe(false);
    }
  });
});

describe("dsky decoder — determinism", () => {
  it("same event stream ⇒ identical canonical output", () => {
    const words = [
      encodeCh010({ codeA: 0b00011, codeB: 0b11001, selector: 11 }),
      encodeCh010({ codeA: 0b11001, codeB: 0b00011, selector: 10 }),
      ANNUNCIATOR_ROW_TAG_VALUE | 0o10 | 0o400,
      encodeCh010({ sign: 1, selector: 5 }),
      encodeCh010({ codeA: 0b11101, codeB: 0b10101, selector: 8 }),
    ];
    const a = applyDskyOutputBatch(makeEmptyDecodedDsky(), words);
    const b = applyDskyOutputBatch(makeEmptyDecodedDsky(), words);
    expect(decodedDskyCanonical(a)).toBe(decodedDskyCanonical(b));
  });
});
