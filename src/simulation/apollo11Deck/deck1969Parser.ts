// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3D Gate 3/4 — pure parser for the transcribed 1969 MIT input deck.
// This module never invents a value. It only reshapes the double-pass
// transcription file into the typed deck and computes derived numeric forms.

import type {
  Apollo11AgcDeckRecord,
  Apollo11AstronautCardAction,
  Apollo11Deck1969,
  Apollo11ExternalDeckRecord,
  PrimaryScanPageRef,
  SourceTranscribedField,
} from "./deck1969.schema";

export interface RawTranscribedField {
  readonly pass1: string;
  readonly pass2: string;
  readonly agreed: boolean;
  readonly final: string | null;
  readonly status?: "verified" | "conflict" | "unreadable";
}

/** The printout pads octal fields with leading zeros; value range decides. */
export function isOctalWord(text: string): boolean {
  return /^[0-7]{1,8}$/.test(text) && parseInt(text, 8) <= 0o77777;
}

export function isOctalAddress(text: string): boolean {
  return /^[0-7]{1,8}$/.test(text) && parseInt(text, 8) <= 0o3777;
}


export function parseOctal(text: string): number {
  if (!/^[0-7]+$/.test(text)) {
    throw new Error(`not an octal literal: ${text}`);
  }
  return parseInt(text, 8);
}

export function fieldOf(
  raw: RawTranscribedField,
  scanLeaf: number,
  printedPage: string | null,
  column: string,
  ocrLocatorText: string | null,
): SourceTranscribedField {
  const agreed = raw.pass1 === raw.pass2;
  return {
    pass1: raw.pass1,
    pass2: raw.pass2,
    agreed,
    scanLeaf,
    printedPage,
    boundingBoxOrColumn: column,
    ocrLocatorText,
    finalValue: agreed ? raw.pass1 : null,
    status: raw.status ?? (agreed ? "verified" : "conflict"),
  };
}

/** A record is admissible only when every one of its fields is verified. */
export function recordIsVerified(
  fields: readonly SourceTranscribedField[],
): boolean {
  return fields.every((f) => f.status === "verified" && f.finalValue !== null);
}

export interface TranscribedDeckFile {
  readonly deckId: string;
  readonly itemId: string;
  readonly software: string;
  readonly run: string;
  readonly marsrotTape: string;
  readonly pages: readonly PrimaryScanPageRef[];
  readonly agcRecords: readonly Apollo11AgcDeckRecord[];
  readonly externalRecords: readonly Apollo11ExternalDeckRecord[];
  readonly astronautProgram: readonly Apollo11AstronautCardAction[];
  readonly admissibility: Apollo11Deck1969["admissibility"];
}

export function parseDeck(file: TranscribedDeckFile): Apollo11Deck1969 {
  return {
    deckId: "apollo11-1969-mit-input-deck-v1",
    itemId: "apollo11landingd00miti_0",
    software: file.software,
    run: file.run,
    marsrotTape: file.marsrotTape,
    pages: file.pages,
    agcRecords: file.agcRecords,
    externalRecords: file.externalRecords,
    astronautProgram: file.astronautProgram,
    admissibility: file.admissibility,
  };
}
