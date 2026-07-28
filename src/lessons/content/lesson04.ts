// SPDX-License-Identifier: GPL-3.0-or-later
import { v16N65Predicate } from "../predicates/v16N65MissionTime";
import { V16_FIXTURE_ID } from "../fixtureExpectations";
import type { LessonDefinition } from "../types";

export const LESSON_04_V16_N65: LessonDefinition = {
  id: "lesson-04-v16-n65-mission-time",
  title: "Monitor mission-elapsed time with V16 N65",
  summary:
    "Verb 16 = 'monitor decimal'. Noun 65 = 'sampled AGC time'. Together V16 N65 tells the AGC to keep updating R1/R2/R3 with the current mission-elapsed time, refreshed once per major cycle.",
  steps: [
    {
      id: "explain-v16-n65",
      kind: "reading",
      title: "What V16 N65 does",
      body:
        "V16 is a monitor verb: after ENTR, the AGC keeps refreshing the requested noun. Noun 65 is 'sampled AGC time', shown as hours in R1, minutes in R2, and seconds.centiseconds in R3. Individual captured frames may catch the AGC mid-write — expect transient blanks. Only the settled tuple (VERB 16, NOUN 65) with a forward-advancing time counts as authentic.",
      sources: [
        { id: "colossus-users-guide" },
        { id: "apollo-15-dsky-manual" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "type-v16-n65-entr",
      kind: "interactive",
      title: "Type V-1-6 N-6-5 ENTR",
      body:
        "Press VERB 1 6 NOUN 6 5 ENTR. Then wait — the lesson only completes after the DSKY has settled with VERB=16 and NOUN=65 across at least two observations, the AGC step counter has advanced between them, and the displayed mission time has moved forward.",
      sources: [
        { id: "luminary099" },
        { id: "yaDSKY2-ddc65e7b" },
      ],
      classification: "authentic-emulator",
      predicate: v16N65Predicate,
      fixtureId: V16_FIXTURE_ID,
    },
  ],
};
