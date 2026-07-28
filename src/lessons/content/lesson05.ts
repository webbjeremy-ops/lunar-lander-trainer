// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 5 — Decoding a Channel 010 relay word.
//
// Reading-only lesson. The engine never mutates AGC state. Every claim
// about bit layout, selector semantics, sign latches, and digit codes is
// cited to the pinned yaDSKY2 source (ddc65e7b) or Block-II documentation.
//
// The worked-example words below are literal frames from the committed
// V35 lamp-test golden trace and can be recomputed from the fixture at
// any time; see the "Verify" step and the accompanying test suite.

import type { LessonDefinition } from "../types";

export const LESSON_05_DECODING_CH010: LessonDefinition = {
  id: "lesson-05-decoding-ch010",
  title: "Decoding a Channel 010 relay word",
  summary:
    "Walk the exact bit layout the AGC drives onto channel 010 to update the DSKY, using literal words captured from Luminary099's V35 lamp test.",
  steps: [
    {
      id: "why-ch010",
      kind: "reading",
      title: "Why channel 010",
      body:
        "The Block-II AGC does not talk to the DSKY over a memory-mapped display buffer. It writes a 15-bit word onto output channel 010 whenever a relay row needs to change. Each write updates exactly one row of relays; the DSKY latches the row and holds the last value until the AGC writes it again. This is why the DSKY 'remembers' digits even when the AGC is busy with other tasks.",
      sources: [
        { id: "block-ii-agc-r-393" },
        { id: "yaDSKY2-ddc65e7b" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "bit-layout",
      kind: "reading",
      title: "The 15-bit word layout",
      body:
        "Bits (MSB→LSB): WWWW | S | AAAAA | BBBBB. WWWW is a 4-bit selector 1..12 identifying the target row. S is a single sign-latch drive bit. AAAAA and BBBBB are 5-bit relay codes for the row's two digit fields. Selectors 1..11 target digit rows in a fixed table (see /sources); selector 12 is the annunciator row, additionally identified by (word & 0o74000) === 0o60000.",
      sources: [{ id: "yaDSKY2-ddc65e7b", cite: "SELECTOR_TABLE in DskyChannelMap.ts" }],
      classification: "historically-grounded",
    },
    {
      id: "digit-codes",
      kind: "reading",
      title: "Digit relay codes",
      body:
        "A 5-bit relay code is NOT the digit's binary value — it is which of the 5 segments to energize on that display position. Code 00 blanks the position. Code 21 = digit 0, code 03 = digit 1, code 25 = digit 2, ... code 29 = digit 8, code 27 = digit 9. Anything outside this table is an unsupported glyph and MUST NOT be rendered — the decoder holds the previous latched digit rather than invent a shape.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
    {
      id: "sign-latches",
      kind: "reading",
      title: "Two independent sign latches per register",
      body:
        "Each of R1/R2/R3 has TWO independent sign latches: PLUS and MINUS. Different selectors drive different latches — e.g. selector 7 drives R1 PLUS, selector 6 drives R1 MINUS. Both-on is a legal diagnostic state and the real yaDSKY gives PLUS display priority. The decoder faithfully preserves this — never fuse the two into one 'sign' field.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
    {
      id: "worked-example-prog",
      kind: "reading",
      title: "Worked example — PROG '88' during V35",
      body:
        "During the V35 lamp test the AGC writes 0o55675 (decimal 23485) to channel 010. Decoding: selector = (0o55675 >>> 11) & 0xf = 11 (PROG row); S = 0; A = (0o55675 >>> 5) & 0x1f = 29 = digit 8; B = 0o55675 & 0x1f = 29 = digit 8. Result: PROG displays '88'. This is event id 199 at tick 101 in the committed V35 fixture — reproducible verbatim.",
      sources: [
        { id: "yaDSKY2-ddc65e7b" },
        { id: "luminary099", cite: "V35 lamp test entry point" },
      ],
      classification: "historically-grounded",
    },
    {
      id: "worked-example-r1",
      kind: "reading",
      title: "Worked example — R1 digits and PLUS latch",
      body:
        "The AGC writes 0o37675 (decimal 16317) to channel 010. selector = 7 (R1 digits 1..2, PLUS latch); S = 1 (assert R1 PLUS); A = 29 = digit 8; B = 29 = digit 8. Result: R1 positions 1 and 2 show '8' and the R1 PLUS lamp lights. This is event id 173 at tick 87 in the committed V35 fixture. Note: R1 digit 0 is set separately by selector 8 (only field B is used there — the row has no left field).",
      sources: [{ id: "yaDSKY2-ddc65e7b" }],
      classification: "historically-grounded",
    },
    {
      id: "verify",
      kind: "reading",
      title: "Verify against the fixture",
      body:
        "Open the DSKY (/sim), press V-3-5-ENTR, and inspect the diagnostic ring. Every channel-010 event will show its raw octal value; apply the decoder above by hand and you will match what the SVG renders. The pure decoder is also tested against every event in the committed fixture — see goldenTraceReplay.test.ts.",
      sources: [
        { id: "yaDSKY2-ddc65e7b" },
        { id: "webAGC-0575ea7" },
      ],
      classification: "historically-grounded",
    },
  ],
};
