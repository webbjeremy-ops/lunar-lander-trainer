// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3A2-P5.d — authoritative host→AGC input-channel shadow.
//
// yaAGC's `packet_write(channel, value)` is a WHOLE-WORD store into
// `State->InputChannel[channel]`; there is no bit-masked input path. A
// monitor profile that owns only a few bits of CHAN30/CHAN33 therefore MUST
// merge its owned bits into the complete current word before writing, or it
// would silently clobber every unowned bit.
//
// This module owns the single Worker-side shadow of every host-written input
// channel. EVERY host input packet (DSKY key codes on CH015, PROCEED on
// CH032, and monitor discretes on CH030/CH033) goes through
// `AgcInputChannelShadow.write()`, so the shadow is authoritative rather
// than a guess.
//
// Seed values are SOURCE-PROVEN, not invented: yaAGC's
// `agc_engine_init.c` initializes every input channel to 0 except
//     InputChannel[030] = 037777
//     InputChannel[031] = 077777
//     InputChannel[032] = 077777
//     InputChannel[033] = 077777
// (virtualagc @ ddc65e7b, yaAGC/agc_engine_init.c lines 254-258). Those are
// the emulator's own post-init values for the active-low discrete channels,
// so seeding the shadow with them means the first monitor write preserves
// the emulator's real unowned-bit state instead of asserting unowned
// discretes.
//
// The frozen adapter reset path additionally writes CH032 = 020000
// (PROCEED released) and CH015 = 0. `seedAfterCpuReset()` records those two
// writes so the shadow matches the emulator immediately after `cpu_reset()`.

import { applyChannelMaskUpdate } from "./discreteEncoder";
import type { ChannelMaskUpdateAction } from "./types";

/** yaAGC post-init input-channel values (see module header for citation). */
export const YAAGC_INPUT_CHANNEL_INIT: { readonly [channel: number]: number } = {
  0o30: 0o37777,
  0o31: 0o77777,
  0o32: 0o77777,
  0o33: 0o77777,
};

/** Values the frozen `AgcCoreAdapter.reset()` writes immediately after
 *  `cpu_reset()`. Mirrored here so the shadow never diverges. */
export const ADAPTER_POST_RESET_WRITES: { readonly [channel: number]: number } = {
  0o32: 1 << 13, // PROCEED active-low: high == not pressed
  0o15: 0,
};

export const AGC_CHANNEL_WORD_MASK = 0o77777;

export interface InputShadowEntry {
  readonly channel: number;
  readonly word: number;
  /** True when the value is the emulator's documented init value and no
   *  host write has replaced it yet. */
  readonly seeded: boolean;
}

export class AgcInputChannelShadow {
  private words = new Map<number, number>();
  private hostWritten = new Set<number>();

  constructor() {
    this.seedInitial();
  }

  private seedInitial(): void {
    this.words.clear();
    this.hostWritten.clear();
    for (const key of Object.keys(YAAGC_INPUT_CHANNEL_INIT)) {
      const ch = Number(key);
      this.words.set(ch, YAAGC_INPUT_CHANNEL_INIT[ch]);
    }
  }

  /** Full re-seed for a fresh AGC epoch (cpu_reset). Records the frozen
   *  adapter's own post-reset writes so the shadow stays authoritative. */
  seedAfterCpuReset(): void {
    this.seedInitial();
    for (const key of Object.keys(ADAPTER_POST_RESET_WRITES)) {
      const ch = Number(key);
      this.words.set(ch, ADAPTER_POST_RESET_WRITES[ch]);
      this.hostWritten.add(ch);
    }
  }

  /** Current complete word for `channel`. Unknown channels read 0, which is
   *  the emulator's own init value for every channel outside the table. */
  read(channel: number): number {
    return this.words.get(channel) ?? 0;
  }

  /** Record a complete host write. Called for EVERY accepted input packet. */
  write(channel: number, word: number): number {
    const masked = word & AGC_CHANNEL_WORD_MASK;
    this.words.set(channel, masked);
    this.hostWritten.add(channel);
    return masked;
  }

  /** Merge one owned-bit update and return the complete word to transmit.
   *  Does NOT write — the caller performs the packet write and then calls
   *  `write()` (or uses `applyMaskUpdate` which does both). */
  mergeMaskUpdate(action: ChannelMaskUpdateAction): number {
    return applyChannelMaskUpdate(this.read(action.channel), action);
  }

  /** Merge + record. Returns the complete word to transmit. */
  applyMaskUpdate(action: ChannelMaskUpdateAction): number {
    const next = this.mergeMaskUpdate(action);
    this.write(action.channel, next);
    return next;
  }

  hasHostWrite(channel: number): boolean {
    return this.hostWritten.has(channel);
  }

  entries(): readonly InputShadowEntry[] {
    return [...this.words.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([channel, word]) => ({
        channel,
        word,
        seeded: !this.hostWritten.has(channel),
      }));
  }
}
