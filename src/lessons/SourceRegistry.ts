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
  "nasa-sp-4029": {
    id: "nasa-sp-4029",
    title: "NASA SP-4029 — Apollo by the Numbers: A Statistical Reference",
    kind: "nasa",
    note:
      "Mission-level reference for lunar environment figures and Apollo flight statistics used by the M4.0 constants registry.",
  },
  "apollo-11-mission-report": {
    id: "apollo-11-mission-report",
    title: "Apollo 11 Mission Report (NASA SP-238 / MSC-00171)",
    kind: "nasa",
    note:
      "Primary flight report: descent performance, propellant margins, and landing-gear contact criteria.",
  },
  "lm-familiarization-manual": {
    id: "lm-familiarization-manual",
    title: "Grumman LM Familiarization Manual / Apollo Operations Handbook (LM)",
    kind: "documentation",
    note:
      "Vehicle-level source for descent and ascent propulsion ratings, throttle band, and stage masses.",
  },
  "lunar2d-jpl-de-lunar-gm": {
    id: "lunar2d-jpl-de-lunar-gm",
    title: "JPL DE-series lunar gravitational parameter (GM) and mean radius",
    kind: "nasa",
    note:
      "Source of μ = 4.9028e12 m^3/s^2 and mean radius 1,737.4 km used by the M4.0 inverse-square field.",
  },
  "m4-0-kernel": {
    id: "m4-0-kernel",
    title: "AGC — Tranquility M4.0 deterministic planar lunar-flight kernel",
    kind: "documentation",
    note:
      "This project's own physics kernel and its constants registry (src/simulation/lunar2d). Values derived here are labelled source-derived; tuning choices are labelled gameplay-tuned.",
  },
  "m3-3e-hardware-lab": {
    id: "m3-3e-hardware-lab",
    title: "AGC — Tranquility M3.3E Synthetic Hardware-Interface Laboratory (frozen)",
    kind: "documentation",
    note:
      "Frozen HW-I/O v4 lab: PIPA PINC/MINC delivery, Channel 13 radar request decoding, and two-phase RNRAD/RADARUPT transactions, proven against real WASM. Synthetic fixture — not Apollo 11 telemetry.",
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
