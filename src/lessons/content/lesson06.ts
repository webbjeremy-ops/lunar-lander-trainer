// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 6 — The DSKY annunciators.
//
// Reading-only lesson. Every annunciator claim maps to a source-normative
// mask in DskyChannelMap.ts. The engine never mutates AGC state.

import type { LessonDefinition } from "../types";

export const LESSON_06_ANNUNCIATORS: LessonDefinition = {
  id: "lesson-06-annunciators",
  title: "The DSKY annunciators",
  summary:
    "How every lamp around the DSKY display is driven by an independent latch, sourced from channels 010 (selector 12), 011, and 0163 in the pinned emulator.",
  steps: [
    {
      id: "three-channels",
      kind: "reading",
      title: "Three channels drive the lamps",
      body:
        "Real Block-II AGC hardware exposes the annunciators across several output channels. In the pinned webAGC/yaAGC build they are consolidated as: channel 010 selector-12 (the historical row: NO ATT, GIMBAL LOCK, PROG, TRACKER, ALT, VEL, PRIO DISP, NO DAP); synthetic channel 011 (COMP ACTY, UPLINK ACTY); synthetic channel 0163 (TEMP, KEY REL, VERB/NOUN FLASH, OPR ERR, RESTART, STANDBY, EL OFF, AGC WARNING). Each mask is one independent latch bit — see CH010/011/0163_ANNUNCIATOR_MASKS in DskyChannelMap.ts.",
      sources: [
        { id: "yaDSKY2-ddc65e7b", cite: "CH010_ANNUNCIATOR_MASKS" },
        { id: "webAGC-0575ea7", cite: "channels 011 and 0163" },
        { id: "block-ii-agc-r-393" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "no-synthesis",
      kind: "reading",
      title: "Nothing is synthesized",
      body:
        "The simulator does NOT invent lamp state. UPLINK ACTY only lights when Luminary099 asserts bit 3 of channel 011. OPR ERR only lights when bit 7 of channel 0163 is set. There is no JavaScript timer that blinks VERB/NOUN — the flash annunciator is a latch the AGC drives. If a lamp is dark, the AGC is not currently asserting it; if it is lit, the emulator produced an event you can find in the diagnostic ring.",
      sources: [{ id: "webAGC-0575ea7" }],
      classification: "historically-grounded",
    },
    {
      id: "v35-set",
      kind: "reading",
      title: "The V35 authoritative set",
      body:
        "When the V35 lamp test peaks, a specific set of annunciators is expected on. This set is captured from the committed golden trace (v35-lamp-test.json) and used by Lesson 3's predicate; it is NOT hand-picked. Any deviation from the fixture-lit set means either the rope changed, the emulator changed, or the decoder changed — the mismatch is a signal to investigate, not to loosen the test.",
      sources: [
        { id: "yaDSKY2-ddc65e7b" },
        { id: "luminary099" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "alarm-latching",
      kind: "reading",
      title: "Alarms are latched, not coalesced",
      body:
        "OPR ERR, RESTART, and PROG alarms are single-bit latches. The worker's event stream preserves each set/clear as an ordered event with its original event id and tick — the UI never coalesces alarm transitions across ticks. This is why Lesson 4 can safely tolerate an OPR ERR that appears after V16 N65 has already stabilized: the lit alarm is authentic history, not a lesson failure signal.",
      sources: [{ id: "webAGC-0575ea7" }],
      classification: "historically-grounded",
    },
    {
      id: "inspect",
      kind: "reading",
      title: "Inspect it live",
      body:
        "Open /sim and watch the diagnostic ring while pressing keys. Every annunciator change is a channel event — you can read the raw octal value, apply the mask table, and predict which latch flipped. This is the same evidence Lesson 3's predicate uses to certify the V35 peak.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
  ],
};
