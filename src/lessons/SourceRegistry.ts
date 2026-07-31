// SPDX-License-Identifier: GPL-3.0-or-later
// A tiny registry of primary and authoritative sources every lesson step
// cites. Kept as data so the /learn route and tests can enumerate them.

export interface SourceEntry {
  id: string;
  title: string;
  kind:
    | "primary-source"
    | "pinned-source"
    | "documentation"
    | "nasa"
    | "mit"
    | "secondary-reconstruction";
  url?: string;
  pinnedCommit?: string;
  note?: string;
}

export const SOURCE_REGISTRY: Readonly<Record<string, SourceEntry>> = {
  luminary099: {
    id: "luminary099",
    title:
      "Luminary099 flight software (Apollo 11 LM primary guidance rope)",
    kind: "primary-source",
    url: "https://github.com/chrislgarry/Apollo-11",
    pinnedCommit: "911e5c0283c629c50cb97666f34065e8c07d71a5",
    note:
      "This is the actual rope memory Buzz Aldrin's DSKY read verbs and nouns against on 20 Jul 1969.",
  },
  "yaDSKY2-ddc65e7b": {
    id: "yaDSKY2-ddc65e7b",
    title:
      "Virtual AGC — yaDSKY2 DSKY implementation, source-normative for the pinned emulator",
    kind: "pinned-source",
    url: "https://github.com/michaelfranzl/virtualagc",
    pinnedCommit: "ddc65e7bed41f1301921b934fcbaaee93db99dda",
    note:
      "Owns the channel-010 selector table, sign latch semantics, and annunciator row masks used by DskyChannelMap.ts.",
  },
  "webAGC-0575ea7": {
    id: "webAGC-0575ea7",
    title: "michaelfranzl/webAGC (yaAGC compiled to WebAssembly)",
    kind: "pinned-source",
    url: "https://github.com/michaelfranzl/webAGC",
    pinnedCommit: "0575ea7a1231e3948bae7d2c22a6ac146da0c38d",
    note:
      "Provides the synthetic channels 011 and 0163 that drive COMP ACTY, UPLINK ACTY, and the alarm annunciators.",
  },
  "block-ii-agc-r-393": {
    id: "block-ii-agc-r-393",
    title:
      "MIT/IL R-393 — Block II AGC Functional Description (Sept 1967)",
    kind: "mit",
    note:
      "Primary source for AGC I/O channel assignments, DSKY relay word format, and PROG/VERB/NOUN semantics.",
  },
  "apollo-15-dsky-manual": {
    id: "apollo-15-dsky-manual",
    title: "Apollo 15 Delco Manual — Section 4, DSKY Operation",
    kind: "documentation",
    note:
      "Describes standard verbs (V35 lamp test, V16 monitor decimal), noun assignments, key codes.",
  },
  "colossus-users-guide": {
    id: "colossus-users-guide",
    title:
      "COLOSSUS/LUMINARY Users Guide (Apollo Operations Handbook Vol I §4)",
    kind: "documentation",
    note:
      "Defines Noun 65 (sampled AGC time / mission-elapsed time monitor) and V16 monitor cadence.",
  },
  "saturn-v-lvdc": {
    id: "saturn-v-lvdc",
    title:
      "IBM Saturn V Launch Vehicle Digital Computer (LVDC) reference",
    kind: "nasa",
    note:
      "Cited in Lesson 1 to contrast the LVDC — which flew the Saturn V launch — with the AGC.",
  },
  "apollo11-powered-descent-technical-reconstruction-workbook-v1": {
    id: "apollo11-powered-descent-technical-reconstruction-workbook-v1",
    title:
      "Apollo 11 Powered Descent — A Technical Reconstruction (ENG workbook), v1",
    kind: "secondary-reconstruction",
    note:
      "Secondary reconstruction. Combines NASA primary sources, Luminary material, air-to-ground transcript, Computer Words telemetry, secondary literature, and author inference. Used only for timeline markers, narration, scoring context, and debrief comparison. Its summarized Verb/Noun dictionary (including N60–N64) and rope-cadence claims are NOT imported.",
  },
} as const;

export function sourcesForLesson(ids: readonly string[]): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const id of ids) {
    const e = SOURCE_REGISTRY[id];
    if (e) out.push(e);
  }
  return out;
}
