import { describe, it, expect } from "vitest";
import { canonicalBytes, stateChecksum, type ObservableAgcState } from "../checksum";

function base(): ObservableAgcState {
  return {
    missionTimeUs: 12345n,
    timingRemainderNs: 42,
    totalAgcSteps: 987n,
    erasable: new Uint16Array(2048),
    channels: new Map<number, number>([
      [0o010, 0o1234],
      [0o011, 0o5],
    ]),
    lampBits: 0b10110,
    missionSystemState: { alt: 15000, phase: "P63" },
    prngState: 0xdeadbeef,
    eventLogVersion: 1,
    eventLogCursor: 7,
  };
}

describe("state checksum", () => {
  it("is deterministic", () => {
    expect(stateChecksum(base())).toBe(stateChecksum(base()));
  });

  it("changes when any observable field changes", () => {
    const s0 = stateChecksum(base());
    const cases: Array<(s: ObservableAgcState) => void> = [
      (s) => (s.missionTimeUs = 12346n),
      (s) => (s.timingRemainderNs = 43),
      (s) => (s.totalAgcSteps = 988n),
      (s) => (s.lampBits = s.lampBits ^ 1),
      (s) => (s.missionSystemState = { alt: 15001, phase: "P63" }),
      (s) => (s.prngState = 0xdeadbef0),
      (s) => (s.eventLogVersion = 2),
      (s) => (s.eventLogCursor = 8),
      (s) => s.erasable.set([1], 5),
      (s) => (s.channels as Map<number, number>).set(0o012, 1),
    ];
    for (const mut of cases) {
      const s = base();
      mut(s);
      expect(stateChecksum(s)).not.toBe(s0);
    }
  });

  it("channel serialization is order-independent", () => {
    const a = base();
    a.channels = new Map([[0o010, 1], [0o020, 2]]);
    const b = base();
    b.channels = new Map([[0o020, 2], [0o010, 1]]);
    expect(stateChecksum(a)).toBe(stateChecksum(b));
  });

  it("json key order does not affect checksum", () => {
    const a = base();
    a.missionSystemState = { a: 1, b: 2 };
    const b = base();
    b.missionSystemState = { b: 2, a: 1 };
    expect(stateChecksum(a)).toBe(stateChecksum(b));
  });

  it("canonical bytes are stable across runs", () => {
    const x = canonicalBytes(base());
    const y = canonicalBytes(base());
    expect(x).toEqual(y);
  });
});
