// SPDX-License-Identifier: GPL-3.0-or-later
// M4.8 — 1201 / 1202 program-alarm reducer.

import { describe, expect, it } from "vitest";
import { AGC_KEY, digitKey } from "@/lessons/keyCodes";
import {
  ALARM_READ_KEYS,
  APOLLO11_ALARM_TIMELINE,
  bridgedAlarmFor,
  createProgramAlarmState,
  reduceProgramAlarms,
  summarizeAlarms,
  type ProgramAlarmDefinition,
  type ProgramAlarmState,
} from "../programAlarms";

const S = 1_000_000;

const TIMELINE: readonly ProgramAlarmDefinition[] = [
  { ...APOLLO11_ALARM_TIMELINE[0]!, atSinceIgnitionSec: 10 },
  { ...APOLLO11_ALARM_TIMELINE[1]!, atSinceIgnitionSec: 60 },
];

function tick(s: ProgramAlarmState, sec: number): ProgramAlarmState {
  return reduceProgramAlarms(s, { kind: "tick", sinceIgnitionUs: sec * S }, TIMELINE);
}

function keys(
  s: ProgramAlarmState,
  codes: readonly number[],
  sec: number,
): ProgramAlarmState {
  let next = s;
  for (const code of codes) {
    next = reduceProgramAlarms(next, { kind: "key", code, sinceIgnitionUs: sec * S }, TIMELINE);
  }
  return next;
}

describe("program alarms", () => {
  it("starts dark", () => {
    const s = createProgramAlarmState();
    expect(s.lampOn).toBe(false);
    expect(bridgedAlarmFor(s)).toBeNull();
  });

  it("raises the alarm at the scheduled point in the burn", () => {
    let s = tick(createProgramAlarmState(), 5);
    expect(s.lampOn).toBe(false);
    s = tick(s, 10);
    expect(s.lampOn).toBe(true);
    expect(s.active?.code).toBe(TIMELINE[0]!.code);
    const overlay = bridgedAlarmFor(s);
    expect(overlay?.variant).toBe("alarm");
    expect(overlay?.flashing).toBe(true);
    expect(overlay?.code).toBe(TIMELINE[0]!.code);
  });

  it("refuses RSET before the code has been read", () => {
    let s = tick(createProgramAlarmState(), 10);
    s = keys(s, [AGC_KEY.RSET], 12);
    expect(s.lampOn).toBe(true);
    expect(s.active).not.toBeNull();
    expect(s.lastMessage).toMatch(/read/i);
  });

  it("clears once the code is read and RSET is pressed", () => {
    let s = tick(createProgramAlarmState(), 10);
    s = keys(s, ALARM_READ_KEYS, 20);
    expect(s.active?.codeRead).toBe(true);
    expect(bridgedAlarmFor(s)?.flashing).toBe(false);
    s = keys(s, [AGC_KEY.RSET], 25);
    expect(s.lampOn).toBe(false);
    expect(s.active).toBeNull();
    const score = summarizeAlarms(s);
    expect(score.raised).toBe(1);
    expect(score.cleared).toBe(1);
    expect(score.unresolved).toBe(0);
    expect(score.meanResponseSeconds).toBeCloseTo(15, 6);
  });

  it("resets a partial read sequence on a wrong key", () => {
    let s = tick(createProgramAlarmState(), 10);
    s = keys(s, [AGC_KEY.VERB, digitKey(0), digitKey(7)], 12);
    expect(s.readBuffer).toBe(0);
    s = keys(s, [AGC_KEY.RSET], 13);
    expect(s.lampOn).toBe(true);
  });

  it("records an unanswered alarm when the next one supersedes it", () => {
    let s = tick(createProgramAlarmState(), 10);
    s = tick(s, 60);
    expect(s.active?.code).toBe(TIMELINE[1]!.code);
    const score = summarizeAlarms(s);
    expect(score.raised).toBe(2);
    expect(score.unresolved).toBe(2);
  });

  it("is a pure reducer", () => {
    const a = keys(tick(createProgramAlarmState(), 10), ALARM_READ_KEYS, 20);
    const b = keys(tick(createProgramAlarmState(), 10), ALARM_READ_KEYS, 20);
    expect(a).toEqual(b);
  });
});
