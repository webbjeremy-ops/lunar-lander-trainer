// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic mulberry32 PRNG for reproducible mission simulation. The
// project bans Math.random() inside src/agc/** and src/sim/** — always
// construct one of these from an explicit seed.

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Force 32-bit unsigned.
    this.state = seed >>> 0 || 1;
  }

  /** Return the raw 32-bit state (for checksumming / snapshotting). */
  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = state >>> 0 || 1;
  }

  /** Next uint32. */
  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  /** [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }
}
