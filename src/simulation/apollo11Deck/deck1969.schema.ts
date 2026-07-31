// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3D Gate 2 — typed representation of the 1969 MIT Apollo 11 Landing
// Digital Simulation input deck.
//
// Three deck classes are kept strictly separate. AGC erasable memory records,
// external simulator environment cards, and astronaut/operator actions are NOT
// interchangeable and must never be merged into one untyped list.
//
// Nothing in this file adopts a value. Values live in
// deck1969.transcribed.json and are admitted to runtime only after
// deck1969Validator.ts accepts them.

/** A page of the primary scan. Images are not stored in the repository. */
export interface PrimaryScanPageRef {
  readonly itemId: "apollo11landingd00miti_0";
  readonly scanLeaf: number;
  readonly printedPage: string | null;
  readonly section: string;
  readonly sourceImageFilename: string;
  readonly sourceImageSha256: string;
  readonly transcriptionStatus:
    | "not-started"
    | "pass-1"
    | "pass-2"
    | "verified"
    | "unreadable";
}

/** One numerical or textual field, carrying both independent visual passes. */
export interface SourceTranscribedField {
  readonly pass1: string;
  readonly pass2: string;
  readonly agreed: boolean;
  readonly scanLeaf: number;
  readonly printedPage: string | null;
  readonly boundingBoxOrColumn: string;
  readonly ocrLocatorText: string | null;
  readonly finalValue: string | null;
  readonly status: "verified" | "conflict" | "unreadable";
}

export interface PrimaryScanFieldRef {
  readonly scanLeaf: number;
  readonly printedPage: string | null;
  readonly boundingBoxOrColumn: string;
}

/** An AGC erasable-memory input record printed in the BLK2 input listing. */
export interface Apollo11AgcDeckRecord {
  readonly ordinal: number;
  readonly symbol: string;
  readonly format: "OCT" | "DEC" | "2DEC" | "other";
  readonly addressOctal: string;
  readonly address: number;
  readonly rawWordsOctal: readonly string[];
  readonly rawWords: readonly number[];
  readonly printedDecodedValue: string | null;
  /** Address of `symbol` in the pinned Luminary099 build, for cross-check. */
  readonly pinnedSymbolAddress: number;
  readonly recordClass:
    | "pad-load"
    | "calibration-constant"
    | "mission-state"
    | "runtime-state"
    | "unclassified";
  readonly scan: PrimaryScanFieldRef;
  readonly fields: readonly SourceTranscribedField[];
}

export interface SourceMappedExternalSemantics {
  readonly sourceValue: string;
  readonly sourceUnits: string;
  readonly sourceFrame: string;
  readonly browserRepresentation: string;
  readonly projection: string;
  /** Dimensional information discarded by the browser's 1-D model, if any. */
  readonly dimensionalLoss: string | null;
}

export interface Apollo11ExternalDeckRecord {
  readonly ordinal: number;
  readonly subsystem:
    | "inputprog"
    | "universe"
    | "prelaunch"
    | "lem"
    | "imu"
    | "special-request";
  readonly cardId: string;
  readonly fields: readonly SourceTranscribedField[];
  readonly semantics: SourceMappedExternalSemantics | null;
  readonly implementationStatus: "mapped" | "validation-only" | "unresolved";
}

export type SourceMappedDskyAction = {
  readonly kind: "dsky";
  /** Verbatim printed card text, e.g. "V 37 E 63 E". */
  readonly printed: string;
  /** Key sequence resolved onto the authentic Channel 015 path. */
  readonly keys: readonly string[];
};

export type SourceMappedExternalSwitchAction = {
  readonly kind: "switch";
  readonly printed: string;
  readonly signal: string;
  readonly value: string;
};

export interface Apollo11AstronautCardAction {
  readonly ordinal: number;
  readonly trigger:
    | { readonly kind: "immediate" }
    | { readonly kind: "wait-seconds"; readonly seconds: number }
    | {
        readonly kind: "display-condition";
        readonly verb: number;
        readonly noun: number;
      }
    | {
        readonly kind: "register-condition";
        readonly register: 1 | 2 | 3;
        readonly value: string;
      };
  readonly action: SourceMappedDskyAction | SourceMappedExternalSwitchAction;
  readonly scan: PrimaryScanFieldRef;
  readonly rawLine: SourceTranscribedField;
}

export interface Apollo11Deck1969 {
  readonly deckId: "apollo11-1969-mit-input-deck-v1";
  readonly itemId: "apollo11landingd00miti_0";
  readonly software: string;
  readonly run: string;
  readonly marsrotTape: string;
  readonly pages: readonly PrimaryScanPageRef[];
  readonly agcRecords: readonly Apollo11AgcDeckRecord[];
  readonly externalRecords: readonly Apollo11ExternalDeckRecord[];
  readonly astronautProgram: readonly Apollo11AstronautCardAction[];
  readonly admissibility: {
    readonly verdict: "admissible" | "input-deck-transcription-incomplete";
    readonly unresolvedFieldCount: number;
    readonly notes: string;
  };
}

/**
 * Runtime mechanisms a source deck may never host-author. Presence of any of
 * these in an executable manifest is a hard validation failure: Average-G,
 * READACCS scheduling and P63 entry must be reached by rope execution alone.
 */
export const PROHIBITED_RUNTIME_SYMBOLS: readonly string[] = [
  "AVEGFLAG",
  "V37FLAG",
  "FLAGWRD7",
  "Z",
  "BANKSET",
  "LST1",
  "LST2",
  "TIME3",
  "NEWJOB",
  "BRUPT",
  "ARUPT",
  "QRUPT",
];
