// SPDX-License-Identifier: GPL-2.0-or-later
// Documented AGC I/O channel map. Octal numbers preserved (Apollo convention).
// Sources:
//   - Virtual AGC channel documentation: https://www.ibiblio.org/apollo/developer.html
//   - Luminary099 / Comanche055 source (chrislgarry/Apollo-11)
//   - webAGC demo (michaelfranzl/webAGC)
//
// This file is the canonical place to add new documented channels. Do NOT
// spread magic octal numbers through the rest of the codebase.

export interface AgcChannelDoc {
  readonly channel: number;          // octal channel number
  readonly direction: "input" | "output" | "bidirectional";
  readonly name: string;
  readonly notes: string;
}

// Only channels we currently rely on for the Milestone-0 spike + first vertical
// slice are documented here. Extend as subsystems come online.
export const AGC_CHANNELS: readonly AgcChannelDoc[] = [
  { channel: 0o10, direction: "output", name: "DSKY relay word (register digits)", notes: "Row-multiplexed 7-segment digit values. Decoded to lamp/register state by DSKY hardware." },
  { channel: 0o11, direction: "output", name: "DSKY lamp bits (COMP ACTY, UPLINK ACTY, etc.) + engine on/off", notes: "Bit 2: COMP ACTY. Bit 3: UPLINK ACTY. Other bits drive engines / discretes depending on program." },
  { channel: 0o13, direction: "output", name: "DSKY test / misc discretes", notes: "Includes DSKY test bit; blinking lamps land on fictitious channel 0o163." },
  { channel: 0o15, direction: "input",  name: "Main keyboard keycode", notes: "Numeric + VERB/NOUN/PRO/CLR/KEY REL/ENTR/RSET keycodes injected here." },
  { channel: 0o32, direction: "input",  name: "PROCEED / mark reject discretes", notes: "PROCEED key is bit 14 (0-based bit 13). Active-low semantics handled by the adapter." },
  { channel: 0o163, direction: "output", name: "Fictitious blinking-lamp channel (yaAGC-generated)", notes: "Bit 1: AGC warning. Bit 4: TEMP. Bit 5: KEY REL. Bit 6: VERB/NOUN flash. Bit 7: OPER ERR. Bit 8: RESTART. Bit 9: STBY. Bit 10: EL off." },
];

// DSKY lamp bitmask — combined COMP ACTY / UPLINK ACTY (from ch 011) and the
// blinking lamps (from ch 0163). This is the canonical bit layout the UI reads.
export const DSKY_LAMPS = {
  COMP_ACTY: 1 << 1,   // ch 011 bit 2
  UPLINK_ACTY: 1 << 2, // ch 011 bit 3
  AGC_WARN: 1 << 3,    // ch 0163 bit 1  (shifted into our combined word bit 3)
  TEMP: 1 << 4,        // ch 0163 bit 4
  KEY_REL: 1 << 5,     // ch 0163 bit 5
  VERB_NOUN_FLASH: 1 << 6, // ch 0163 bit 6
  OPER_ERR: 1 << 7,    // ch 0163 bit 7
  RESTART: 1 << 8,     // ch 0163 bit 8
  STBY: 1 << 9,        // ch 0163 bit 9
  EL_OFF: 1 << 10,     // ch 0163 bit 10
} as const;

// DSKY key codes (octal). From Luminary099 KEYRUPT decode table.
export const DSKY_KEYS = {
  ZERO: 0o20,
  ONE:  0o01,
  TWO:  0o02,
  THREE: 0o03,
  FOUR: 0o04,
  FIVE: 0o05,
  SIX:  0o06,
  SEVEN: 0o07,
  EIGHT: 0o10,
  NINE: 0o11,
  VERB: 0o21,
  NOUN: 0o37,
  PLUS: 0o32,
  MINUS: 0o33,
  ENTR: 0o34,
  CLR:  0o36,
  RSET: 0o22,
  KEY_REL: 0o31,
} as const;

export type DskyKey = keyof typeof DSKY_KEYS;
