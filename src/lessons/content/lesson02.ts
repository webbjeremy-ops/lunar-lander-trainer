// SPDX-License-Identifier: GPL-3.0-or-later
import type { LessonDefinition } from "../types";

export const LESSON_02_READING_THE_DSKY: LessonDefinition = {
  id: "lesson-02-reading-the-dsky",
  title: "Reading the DSKY",
  summary:
    "How to read PROG, VERB, NOUN, R1..R3, signs, blanks, flashing, and status annunciators on the real Apollo DSKY.",
  steps: [
    {
      id: "prog-verb-noun",
      kind: "reading",
      title: "Program, Verb, Noun",
      body:
        "The top-left two-digit window is the PROG — the currently active major mode program (e.g. P00 idle, P63 braking phase). VERB names an action ('display', 'monitor', 'load') and NOUN names the data ('lunar-lander state', 'attitude error', 'sampled AGC time'). VERB × NOUN together compose a request: V16 N65 = 'monitor decimal, AGC time'.",
      sources: [
        { id: "apollo-15-dsky-manual" },
        { id: "colossus-users-guide" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "registers",
      kind: "reading",
      title: "R1, R2, R3",
      body:
        "The three 5-digit displays below VERB/NOUN are the data registers. Each drives 5 relay-decoded digit positions plus two INDEPENDENT sign latches (PLUS and MINUS). Both-on is legal and is a diagnostic state — the real yaDSKY gives PLUS display priority. Digit positions can be individually blanked, so a partially-updated register (e.g. '__945') is a completely normal transient.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
    {
      id: "blank-and-flash",
      kind: "reading",
      title: "Blanks and flashing",
      body:
        "A blank digit position means the AGC has driven the relay code 00 for that position (no segments). VERB/NOUN flash is a separate annunciator (channel 0163) telling the astronaut 'I need input from you'. The simulator does NOT synthesize flashing in JavaScript — the annunciator is set only when Luminary099 asserts it.",
      sources: [
        { id: "yaDSKY2-ddc65e7b" },
        { id: "webAGC-0575ea7" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "annunciators",
      kind: "reading",
      title: "Status annunciators",
      body:
        "The lamps around the display (UPLINK ACTY, TEMP, NO ATT, GIMBAL LOCK, PROG, KEY REL, RESTART, OPR ERR, TRACKER, ALT, VEL, COMP ACTY, STBY, EL OFF) are each driven by an independent latch. This simulator maps them via the source-normative masks from the pinned yaDSKY2. Nothing about a lit lamp is inferred — the AGC either asserted it or it is dark.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
    {
      id: "authentic-vs-overlay",
      kind: "reading",
      title: "Authentic output vs. educational overlays",
      body:
        "The digit segments, sign latches, and annunciators come straight from AGC channel writes. Any commentary, replay marker, or on-screen hint you see beside the DSKY is an educational overlay — always visually distinct and never fed back into the AGC. If it does not come from a channel event, it does not affect a lesson's evidence.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "educational-visualization",
    },
  ],
};
