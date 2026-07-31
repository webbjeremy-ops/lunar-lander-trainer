// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3D Gate 4 — validation of the transcribed 1969 MIT input deck.
//
// The validator is the admissibility gate. A deck that fails ANY check is not
// executable: the loader must refuse it rather than partly apply it.

import symbolTable from "./luminary099.erasableSymbols.json";
import {
  PROHIBITED_RUNTIME_SYMBOLS,
  type Apollo11Deck1969,
  type Apollo11AgcDeckRecord,
} from "./deck1969.schema";
import { isOctalAddress, isOctalWord } from "./deck1969Parser";

export interface DeckValidationIssue {
  readonly code:
    | "unresolved-field"
    | "unknown-symbol"
    | "address-mismatch"
    | "illegal-octal"
    | "word-count-mismatch"
    | "duplicate-address"
    | "prohibited-runtime-symbol"
    | "scan-ref-unresolved"
    | "card-order-broken";
  readonly ordinal: number | null;
  readonly detail: string;
}

export const PINNED_SYMBOLS: Readonly<Record<string, number>> = (
  symbolTable as { symbols: Record<string, number> }
).symbols;

/**
 * Resolve SYMBOL, SYMBOL+n and SYMBOL+nD forms against the pinned rope.
 *
 * The 1969 printout writes element offsets in DECIMAL, with or without the
 * assembler's `D` suffix (verified: `ABTCOF+10` prints at 02562 = 01350+10,
 * and `REFSMMAT+16D` prints at 01753 = 01733+16). Octal offsets would place
 * both records elsewhere.
 */
export function resolvePinnedSymbol(symbol: string): number | null {
  const m = /^(-?[A-Z0-9][A-Z0-9/*\-.]*?)(?:\s*\+\s*(\d+)\s*D?)?$/.exec(
    symbol.trim(),
  );
  if (!m) return null;
  const base = PINNED_SYMBOLS[m[1]];
  if (base === undefined) return null;
  if (m[2] === undefined) return base;
  return base + parseInt(m[2], 10);
}


export function expectedWordCount(format: Apollo11AgcDeckRecord["format"]): number | null {
  switch (format) {
    case "OCT":
    case "DEC":
      return 1;
    case "2DEC":
      // A printed 2DEC record may occupy one or two printed word columns.
      return null;
    default:
      return null;
  }
}

export function validateDeck(deck: Apollo11Deck1969): {
  readonly ok: boolean;
  readonly issues: readonly DeckValidationIssue[];
} {
  const issues: DeckValidationIssue[] = [];
  const pageLeaves = new Set(deck.pages.map((p) => p.scanLeaf));
  const seenAddresses = new Map<number, number>();

  for (const rec of deck.agcRecords) {
    // 1. every field carries two agreeing visual passes
    for (const f of rec.fields) {
      if (f.status !== "verified" || f.finalValue === null) {
        issues.push({
          code: "unresolved-field",
          ordinal: rec.ordinal,
          detail: `${rec.symbol}: field on leaf ${f.scanLeaf} is ${f.status}`,
        });
      }
      if (!pageLeaves.has(f.scanLeaf)) {
        issues.push({
          code: "scan-ref-unresolved",
          ordinal: rec.ordinal,
          detail: `leaf ${f.scanLeaf} is not in the page manifest`,
        });
      }
    }

    // 2. prohibited runtime mechanisms may never be host-authored
    const bare = rec.symbol.split("+")[0].trim();
    if (PROHIBITED_RUNTIME_SYMBOLS.includes(bare)) {
      issues.push({
        code: "prohibited-runtime-symbol",
        ordinal: rec.ordinal,
        detail: `${rec.symbol} is a runtime mechanism and cannot be host-authored`,
      });
    }

    // 3. symbol must exist in the pinned Luminary099 erasable assignments.
    //    A continuation line prints no symbol; it is checked by address only.
    if (rec.symbol !== "" && rec.address >= 0) {
      const pinned = resolvePinnedSymbol(rec.symbol);
      if (pinned === null) {
        issues.push({
          code: "unknown-symbol",
          ordinal: rec.ordinal,
          detail: `${rec.symbol} is absent from pinned Luminary099`,
        });
      } else if (pinned !== rec.address) {
        issues.push({
          code: "address-mismatch",
          ordinal: rec.ordinal,
          detail: `${rec.symbol}: printed ${rec.addressOctal} (${rec.address}) vs pinned ${pinned.toString(8)}`,
        });
      }
    }


    // 4. octal legality (an unreadable address is already reported above)
    if (rec.address >= 0 && !isOctalAddress(rec.addressOctal)) {
      issues.push({
        code: "illegal-octal",
        ordinal: rec.ordinal,
        detail: `illegal erasable address ${rec.addressOctal}`,
      });
    }
    for (const w of rec.rawWordsOctal) {
      if (!isOctalWord(w)) {
        issues.push({
          code: "illegal-octal",
          ordinal: rec.ordinal,
          detail: `illegal 15-bit word ${w}`,
        });
      }
    }

    // 5. word count implied by the printed format
    const expect = expectedWordCount(rec.format);
    if (expect !== null && rec.rawWordsOctal.length !== expect) {
      issues.push({
        code: "word-count-mismatch",
        ordinal: rec.ordinal,
        detail: `${rec.symbol}: format ${rec.format} implies ${expect} word(s), got ${rec.rawWordsOctal.length}`,
      });
    }

    // 6. no duplicate or overlapping address unless the printed card order
    //    explicitly re-writes a later card over an earlier one
    rec.rawWordsOctal.forEach((_, i) => {
      const addr = rec.address + i;
      const prev = seenAddresses.get(addr);
      if (prev !== undefined && prev > rec.ordinal) {
        issues.push({
          code: "duplicate-address",
          ordinal: rec.ordinal,
          detail: `address ${addr.toString(8)} written out of printed card order`,
        });
      }
      seenAddresses.set(addr, rec.ordinal);
    });
  }

  // 7. card order stability
  deck.agcRecords.forEach((rec, i) => {
    if (rec.ordinal !== i + 1) {
      issues.push({
        code: "card-order-broken",
        ordinal: rec.ordinal,
        detail: `AGC record at index ${i} has ordinal ${rec.ordinal}`,
      });
    }
  });
  deck.astronautProgram.forEach((a, i) => {
    if (a.ordinal !== i + 1) {
      issues.push({
        code: "card-order-broken",
        ordinal: a.ordinal,
        detail: `astronaut card at index ${i} has ordinal ${a.ordinal}`,
      });
    }
  });

  return { ok: issues.length === 0, issues };
}

/** Deterministic content hash over the adopted deck values only. */
export function deckContentHashInput(deck: Apollo11Deck1969): string {
  const agc = deck.agcRecords
    .map(
      (r) =>
        `${r.ordinal}|${r.symbol}|${r.format}|${r.addressOctal}|${r.rawWordsOctal.join(",")}`,
    )
    .join("\n");
  const ext = deck.externalRecords
    .map((r) => `${r.ordinal}|${r.subsystem}|${r.cardId}|${r.implementationStatus}`)
    .join("\n");
  const ast = deck.astronautProgram
    .map((a) => `${a.ordinal}|${a.trigger.kind}|${a.action.kind}|${a.action.printed}`)
    .join("\n");
  return `${deck.deckId}\n--AGC--\n${agc}\n--EXT--\n${ext}\n--AST--\n${ast}\n`;
}
