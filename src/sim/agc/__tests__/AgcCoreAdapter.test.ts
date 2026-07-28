// SPDX-License-Identifier: GPL-2.0-or-later
// Adapter-level tests. We bypass WebAssembly instantiation by installing a
// fake YaAgcExports on a pre-constructed adapter (see AgcCoreAdapter.__test).
import { describe, it, expect, vi } from "vitest";
import { AgcCoreAdapter } from "../AgcCoreAdapter";

function makeFakeExports(script: Array<[number, number]>) {
  const mem = new WebAssembly.Memory({ initial: 1 });
  let idx = 0;
  const writes: Array<[number, number]> = [];
  const exports = {
    memory: mem,
    version: () => 0, // pointer 0; adapter returns empty string
    packet_write: (ch: number, v: number) => writes.push([ch, v]),
    packet_read: () => {
      if (idx >= script.length) return 0;
      const [ch, v] = script[idx++];
      return ((ch & 0xffff) << 16) | (v & 0xffff);
    },
    cpu_step: vi.fn(),
    cpu_reset: vi.fn(),
    get_erasable_ptr: () => 0,
    set_fixed: vi.fn(),
    malloc: () => 0,
    free: vi.fn(),
  };
  return { exports, mem, writes };
}

describe("AgcCoreAdapter", () => {
  it("keyPress writes to input channel 0o15", () => {
    const { exports, mem, writes } = makeFakeExports([]);
    const a = new AgcCoreAdapter();
    a.__testInstall(mem, exports);
    a.keyPress(0o21); // VERB
    expect(writes).toContainEqual([0o15, 0o21]);
  });

  it("proceedKey uses channel 0o32 with active-low semantics", () => {
    const { exports, mem, writes } = makeFakeExports([]);
    const a = new AgcCoreAdapter();
    a.__testInstall(mem, exports);
    a.proceedKey(true);
    a.proceedKey(false);
    expect(writes).toContainEqual([0o32, 0]);
    expect(writes).toContainEqual([0o32, 1 << 13]);
  });

  it("reset() calls cpu_reset and re-primes PROCEED + key channel", () => {
    const { exports, mem, writes } = makeFakeExports([]);
    const a = new AgcCoreAdapter();
    a.__testInstall(mem, exports);
    a.reset();
    expect(exports.cpu_reset).toHaveBeenCalled();
    expect(writes).toContainEqual([0o32, 1 << 13]);
    expect(writes).toContainEqual([0o15, 0]);
  });

  it("drainIo() fires onChannelUpdate + onDskyLampsUpdate from packet stream", () => {
    const script: Array<[number, number]> = [
      [0o11, 0b110],       // COMP_ACTY | UPLINK_ACTY
      [0o10, 0x1234],      // relay word
      [0o163, 0b100000],   // KEY REL lamp (bit 5)
    ];
    const { exports, mem } = makeFakeExports(script);
    const chUpdates: Array<[number, number]> = [];
    const lampUpdates: number[] = [];
    const a = new AgcCoreAdapter({
      onChannelUpdate: (c, v) => chUpdates.push([c, v]),
      onDskyLampsUpdate: (b) => lampUpdates.push(b),
    });
    a.__testInstall(mem, exports);
    a.drainIo();

    expect(chUpdates).toEqual([[0o11, 0b110], [0o10, 0x1234], [0o163, 0b100000]]);
    // 2 lamp-affecting channels → 2 lamp updates
    expect(lampUpdates.length).toBe(2);
  });

  it("stepCpu advances the step count", () => {
    const { exports, mem } = makeFakeExports([]);
    const a = new AgcCoreAdapter();
    a.__testInstall(mem, exports);
    a.stepCpu(100);
    a.stepCpu(50);
    expect(a.totalCpuSteps()).toBe(150);
    expect(exports.cpu_step).toHaveBeenCalledTimes(2);
  });
});
