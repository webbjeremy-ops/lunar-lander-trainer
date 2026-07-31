// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3D Gate 4 — validation of the transcribed 1969 MIT input deck.
//
// These tests are the admissibility gate. They deliberately assert on the
// REAL transcription, so a regression in the deck file or in the pinned
// symbol table fails the suite rather than silently degrading provenance.

import { describe, expect, it } from "vitest";
import deckJson from "../deck1969.transcribed.json";
import symbolJson from "../luminary099.erasableSymbols.json";
import type { Apollo11Deck1969 } from "../deck1969.schema";
import {
  PINNED_SYMBOLS,
  resolvePinnedSymbol,
  validateDeck,
  deckContentHashInput,
} from "../deck1969Validator";
import { isOctalAddress, isOctalWord, parseOctal } from "../deck1969Parser";

const deck = deckJson as unknown as Apollo11Deck1969;

describe("pinned Luminary099 erasable symbol table", () => {
  it("is derived from the pinned rope commit", () => {
    expect(symbolJson.source.commit).toBe(
      "911e5c0283c629c50cb97666f34065e8c07d71a5",
    );
    expect(symbolJson.source.files.map((f) => f.path)).toEqual([
      "Luminary099/ERASABLE_ASSIGNMENTS.agc",
      "Luminary099/FLAGWORD_ASSIGNMENTS.agc",
    ]);
  });

  it("reproduces independently known erasable addresses", () => {
    // Cross-checked against the printed 1969 deck AND the rope source.
    expect(PINNED_SYMBOLS.REFSMMAT).toBe(0o1733);
    expect(PINNED_SYMBOLS.RANGEVAR).toBe(0o1770);
    expect(PINNED_SYMBOLS.RATEVAR).toBe(0o1772);
    expect(PINNED_SYMBOLS.TIME2).toBe(0o24);
    expect(PINNED_SYMBOLS.FLAGWRD3).toBe(0o77);
  });

  it("resolves decimal element offsets the way the printout does", () => {
    expect(resolvePinnedSymbol("REFSMMAT+16D")).toBe(0o1753);
    expect(resolvePinnedSymbol("ABTCOF+10")).toBe(0o2562);
    expect(resolvePinnedSymbol("VBRFG*")).toBe(0o2424);
    expect(resolvePinnedSymbol("-AYO+1")).toBe(0o1714);
    expect(resolvePinnedSymbol("NOTASYMBOL")).toBeNull();
  });
});

describe("octal field legality", () => {
  it("accepts zero-padded printed fields and rejects out-of-range ones", () => {
    expect(isOctalAddress("001702")).toBe(true);
    expect(isOctalAddress("004000")).toBe(false);
    expect(isOctalWord("73052")).toBe(true);
    expect(isOctalWord("173052")).toBe(false);
    expect(isOctalWord("00008")).toBe(false);
    expect(parseOctal("001702")).toBe(0o1702);
  });
});

describe("1969 MIT input deck — provenance", () => {
  it("identifies the run and rope printed on every page", () => {
    expect(deck.deckId).toBe("apollo11-1969-mit-input-deck-v1");
    expect(deck.itemId).toBe("apollo11landingd00miti_0");
    expect(deck.software).toBe("LMY99");
    expect(deck.marsrotTape).toBe("MARSROT 20414415");
  });

  it("references only pages present in the acquisition manifest", () => {
    const leaves = new Set(deck.pages.map((p) => p.scanLeaf));
    expect(leaves.size).toBe(deck.pages.length);
    for (const rec of deck.agcRecords) {
      expect(leaves.has(rec.scan.scanLeaf)).toBe(true);
    }
    for (const page of deck.pages) {
      expect(page.sourceImageSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("carries two independent visual passes for every adopted field", () => {
    for (const rec of deck.agcRecords) {
      for (const f of rec.fields) {
        if (f.status === "verified") {
          expect(f.pass1).toBe(f.pass2);
          expect(f.finalValue).not.toBeNull();
        }
      }
    }
  });
});

describe("1969 MIT input deck — cross-check against pinned Luminary099", () => {
  const named = deck.agcRecords.filter((r) => r.symbol !== "");

  it("transcribed a substantial erasable deck", () => {
    expect(deck.agcRecords.length).toBeGreaterThanOrEqual(270);
    expect(named.length).toBeGreaterThanOrEqual(265);
  });

  it("has zero printed-vs-rope address contradictions", () => {
    const mismatches = named
      .filter((r) => r.address >= 0)
      .map((r) => ({ r, pinned: resolvePinnedSymbol(r.symbol) }))
      .filter((x) => x.pinned !== null && x.pinned !== x.r.address)
      .map((x) => `${x.r.symbol} printed ${x.r.addressOctal}`);
    expect(mismatches).toEqual([]);
  });

  it("resolves the overwhelming majority of printed symbols in the rope", () => {
    // 9 of 265 printed symbols do not appear in pinned Luminary099. Each sits
    // at the exact address of a near-identical rope symbol (DKKACSN vs
    // DKKAOSN, 505LM vs 504LM). A third independent visual pass overturned
    // exactly one of them (LMKACSN -> LMKAOSN) and confirmed the rest as
    // printed. The remainder are NOT corrected: the deck records what the page
    // shows, and the validator reports them as `unknown-symbol` — i.e. the
    // 1969 printout names symbols this rope revision does not define.
    const resolved = named.filter((r) => resolvePinnedSymbol(r.symbol) !== null);
    expect(resolved.length / named.length).toBeGreaterThan(0.96);

    const unknown = named
      .filter((r) => resolvePinnedSymbol(r.symbol) === null)
      .map((r) => r.symbol);
    expect(unknown).toEqual([
      "DKKACSN",
      "IGNACSQ",
      "IGNACSR",
      "505LM",
      "505LM+1",
      "505LM+2",
      "505LM+3",
      "505LM+4",
      "505LM+5",
    ]);
  });

  it("never host-authors a prohibited runtime mechanism", () => {
    const issues = validateDeck(deck).issues.filter(
      (i) => i.code === "prohibited-runtime-symbol",
    );
    expect(issues).toEqual([]);
  });

  it("keeps printed card order intact", () => {
    const issues = validateDeck(deck).issues.filter(
      (i) => i.code === "card-order-broken",
    );
    expect(issues).toEqual([]);
  });

  it("contains the printed REFSMMAT block", () => {
    const refs = named.filter((r) => r.symbol.startsWith("REFSMMAT"));
    expect(refs.length).toBeGreaterThanOrEqual(9);
    for (const r of refs) {
      expect(r.format).toBe("2DEC");
      expect(r.rawWordsOctal.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("1969 MIT input deck — astronaut card program", () => {
  it("is a 24-card program that enters P63 by DSKY, not by pad load", () => {
    expect(deck.astronautProgram.length).toBe(24);
    const p63 = deck.astronautProgram.find((c) =>
      c.action.printed.replace(/\s+/g, "").includes("V37E63E"),
    );
    expect(p63).toBeDefined();
    expect(p63!.action.kind).toBe("dsky");
  });

  it("reaches Average-G through rope execution only", () => {
    const text = deck.astronautProgram
      .map((c) => c.action.printed)
      .join("\n");
    expect(text).not.toMatch(/AVEGFLAG/);
    expect(text).toMatch(/V\s*37\s*E\s*63\s*E/);
  });

  it("records every card verbatim with both passes", () => {
    for (const card of deck.astronautProgram) {
      expect(card.rawLine.pass1).toBe(card.rawLine.pass2);
      expect(card.rawLine.status).toBe("verified");
    }
  });
});

describe("deck admissibility verdict", () => {
  const result = validateDeck(deck);

  it("is not silently admissible while any field is unresolved", () => {
    const unresolved = result.issues.filter(
      (i) => i.code === "unresolved-field",
    );
    if (unresolved.length > 0) {
      expect(deck.admissibility.verdict).toBe(
        "input-deck-transcription-incomplete",
      );
      expect(result.ok).toBe(false);
    }
  });

  it("reports only the expected residual issue classes", () => {
    const codes = new Set(result.issues.map((i) => i.code));
    for (const c of codes) {
      expect([
        "unresolved-field",
        "unknown-symbol",
        "duplicate-address",
      ]).toContain(c);
    }
  });

  it("produces a stable content hash input", () => {
    const a = deckContentHashInput(deck);
    const b = deckContentHashInput(deck);
    expect(a).toBe(b);
    expect(a).toContain("apollo11-1969-mit-input-deck-v1");
  });
});
