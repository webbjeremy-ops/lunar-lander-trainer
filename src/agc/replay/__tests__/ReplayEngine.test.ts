// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ReplayRecorder, replayLog, type ReplaySink } from "../ReplayEngine";
import type { AgcCommand } from "../../protocol";

function makeSink() {
  const events: string[] = [];
  const sink: ReplaySink = {
    reset: () => { events.push("reset"); },
    injectCommand: (cmd, id) => { events.push(`cmd#${id}:${cmd.type}`); },
    stepOneTick: () => { events.push("tick"); },
  };
  return { sink, events };
}

describe("ReplayRecorder + replayLog", () => {
  it("preserves within-tick command order", async () => {
    const r = new ReplayRecorder();
    const a: AgcCommand = { type: "dskyKeyDown", keyCode: 1 };
    const b: AgcCommand = { type: "dskyKeyDown", keyCode: 2 };
    r.record(a, 3);
    r.record(b, 3);
    const log = r.export({ ropeId: "Luminary099", ropeSha256: "x", emulatorCommit: "y" });
    const { sink, events } = makeSink();
    await replayLog(sink, log);
    const cmdOrder = events.filter((e) => e.startsWith("cmd#"));
    expect(cmdOrder).toEqual(["cmd#1:dskyKeyDown", "cmd#2:dskyKeyDown"]);
  });

  it("injects command at its recorded tickIndex boundary", async () => {
    const r = new ReplayRecorder();
    r.record({ type: "dskyKeyDown", keyCode: 42 }, 2);
    const log = r.export({ ropeId: "L", ropeSha256: "s", emulatorCommit: "c" });
    const { sink, events } = makeSink();
    await replayLog(sink, log);
    // Expect: reset, [tick, tick,] cmd#1, (no further ticks because finalTick=2)
    expect(events).toEqual(["reset", "tick", "tick", "cmd#1:dskyKeyDown"]);
  });

  it("splits segments at reset boundaries", async () => {
    const r = new ReplayRecorder();
    r.record({ type: "dskyKeyDown", keyCode: 1 }, 0);
    r.record({ type: "reset" }, 1);
    r.record({ type: "dskyKeyDown", keyCode: 2 }, 0);
    const log = r.export({ ropeId: "L", ropeSha256: "s", emulatorCommit: "c" });
    expect(log.segments.length).toBe(2);
    const { sink, events } = makeSink();
    await replayLog(sink, log);
    // segment 0: reset, cmd#1, tick, cmd#2(reset). segment 1: reset, cmd#3
    expect(events.filter((e) => e.startsWith("cmd#"))).toEqual([
      "cmd#1:dskyKeyDown",
      "cmd#2:reset",
      "cmd#3:dskyKeyDown",
    ]);
  });

  it("preserves pause/step/resume/setTimeScale commands", async () => {
    const r = new ReplayRecorder();
    r.record({ type: "pause" }, 5);
    r.record({ type: "setTimeScale", timeScale: 4 }, 5);
    r.record({ type: "stepSimulation", ticks: 1 }, 5);
    r.record({ type: "resume" }, 6);
    const log = r.export({ ropeId: "L", ropeSha256: "s", emulatorCommit: "c" });
    const { sink, events } = makeSink();
    await replayLog(sink, log);
    const types = events.filter((e) => e.startsWith("cmd#")).map((e) => e.split(":")[1]);
    expect(types).toEqual(["pause", "setTimeScale", "stepSimulation", "resume"]);
  });
});
