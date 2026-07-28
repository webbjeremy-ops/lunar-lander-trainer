// SPDX-License-Identifier: GPL-3.0-or-later
import type { LessonDefinition } from "../types";

export const LESSON_01_MEET_THE_AGC: LessonDefinition = {
  id: "lesson-01-meet-the-agc",
  title: "Meet the AGC",
  summary:
    "What the Apollo Guidance Computer is, what Luminary099 is, and why the Lunar Module carried its own onboard computer separate from the Saturn V launch guidance.",
  steps: [
    {
      id: "purpose",
      kind: "reading",
      title: "Purpose of the AGC",
      body:
        "The Apollo Guidance Computer (AGC) was a 15-bit, 2.048 MHz onboard digital computer built by MIT Instrumentation Lab and Raytheon. It performed navigation, guidance, and control (GN&C) for the Command Module and the Lunar Module. On Apollo 11, one AGC was inside the CM (Columbia) and another was inside the LM (Eagle). This simulator runs the LM's AGC.",
      sources: [
        { id: "block-ii-agc-r-393" },
        { id: "luminary099" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "luminary099",
      kind: "reading",
      title: "Luminary099 — the LM flight rope",
      body:
        "Luminary 099 is the flight-software release that Buzz Aldrin's DSKY read verbs and nouns against on 20 July 1969. It contains the descent guidance program (P63/P64/P66), the lunar-surface programs, and every low-level executive routine. The rope we load is the byte-identical image from the pinned chrislgarry/Apollo-11 mirror.",
      sources: [{ id: "luminary099" }],
      classification: "historically-grounded",
    },
    {
      id: "lm-scope",
      kind: "reading",
      title: "Lunar Module scope",
      body:
        "The LM AGC handled powered descent, hover, landing, powered ascent, and rendezvous. It did NOT fly the Saturn V into orbit — the Saturn V Launch Vehicle Digital Computer (LVDC), a separate IBM machine mounted in the instrument unit, did that. Confusing the two is the single most common Apollo-computing misconception.",
      sources: [
        { id: "block-ii-agc-r-393" },
        { id: "saturn-v-lvdc" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "memory-model",
      kind: "reading",
      title: "Fixed, erasable, and core-rope memory",
      body:
        "The AGC had 2 kilowords of read/write core memory (called 'erasable') and 36 kilowords of read-only 'fixed' memory built from woven copper-wire cores threaded through tiny magnetic donuts (the famous 'core rope'). Programs and constants lived in rope; live variables lived in erasable. The DSKY inspects erasable via verbs like V16 and V05.",
      sources: [{ id: "block-ii-agc-r-393" }],
      classification: "historically-grounded",
    },
    {
      id: "dsky-role",
      kind: "reading",
      title: "The DSKY is a terminal, not the computer",
      body:
        "The DSKY (Display and Keyboard) is a peripheral. It sends key codes to the AGC on channel 015, and the AGC drives its lamps and digit relays on channels 010, 011, and 0163. Everything you see on the display in this simulator is being written by Luminary099 executing on the pinned yaAGC WebAssembly core — nothing is faked in the UI.",
      sources: [
        { id: "yaDSKY2-ddc65e7b" },
        { id: "block-ii-agc-r-393" },
      ],
      classification: "historically-grounded",
    },
  ],
};
