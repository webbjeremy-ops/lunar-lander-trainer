// SPDX-License-Identifier: GPL-3.0-or-later
import { v35LampTestPredicate } from "../predicates/v35LampTest";
import { V35_FIXTURE_ID } from "../fixtureExpectations";
import type { LessonDefinition } from "../types";

export const LESSON_03_V35_LAMP_TEST: LessonDefinition = {
  id: "lesson-03-v35-lamp-test",
  title: "Run V35 — the DSKY lamp test",
  summary:
    "Type VERB 3 5 ENTR on the DSKY. Luminary099 will drive every digit position to '8' and light the fixture-defined annunciator set. The lesson only completes when the AGC actually reports that state — not when the UI looks right.",
  steps: [
    {
      id: "explain-v35",
      kind: "reading",
      title: "What V35 does",
      body:
        "Verb 35 is 'test lamps'. When accepted, Luminary099 drives every 7-segment digit to '8' (which lights all seven segments) and asserts a specific set of status annunciators for the astronaut to visually confirm the DSKY is working. The exact lit set is defined by the flight software, not by the DSKY hardware.",
      sources: [
        { id: "apollo-15-dsky-manual" },
        { id: "luminary099" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "type-v35-entr",
      kind: "interactive",
      title: "Type V-3-5-ENTR",
      body:
        "Press VERB, 3, 5, ENTR on the DSKY keypad or with the keyboard. Wait for the AGC to drive the peak state. The lesson recognizes completion only when the decoded DSKY matches the committed V35 fixture peak checksum AND every fixture-lit annunciator is currently on AND the state came from channel events emitted after your ENTR press.",
      sources: [
        { id: "luminary099" },
        { id: "yaDSKY2-ddc65e7b" },
      ],
      classification: "authentic-emulator",
      predicate: v35LampTestPredicate,
      fixtureId: V35_FIXTURE_ID,
    },
  ],
};
