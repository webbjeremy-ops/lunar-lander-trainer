// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { createGamepadEdgeState, type GamepadSnapshot } from "../xboxGamepad";
import { XR_AXIS, XR_BUTTON, mapQuestInput, questPadsFrom } from "../questGamepad";

function xrPad(
  hand: "left" | "right",
  o: { axes?: Partial<Record<number, number>>; buttons?: Partial<Record<number, number>> } = {},
): GamepadSnapshot {
  const axes = [0, 0, 0, 0].map((v, i) => o.axes?.[i] ?? v);
  const buttons = Array.from({ length: 6 }, (_, i) => {
    const value = o.buttons?.[i] ?? 0;
    return { pressed: value > 0.5, value };
  });
  return { axes, buttons, connected: true, mapping: "xr-standard", index: hand === "left" ? 0 : 1, ...{ hand, id: `oculus-touch-${hand}` } } as GamepadSnapshot;
}

describe("mapQuestInput", () => {
  it("splits pads by hand and reads the throttle from the left stick", () => {
    const pads = questPadsFrom([xrPad("right"), xrPad("left", { axes: { [XR_AXIS.stickY]: -1 } })]);
    const { input } = mapQuestInput(pads, createGamepadEdgeState());
    expect(input.thrustRate).toBeCloseTo(1, 6);
  });

  it("edge-detects the left trigger takeover and the right grip alarm cancel", () => {
    const pads = questPadsFrom([
      xrPad("left", { buttons: { [XR_BUTTON.trigger]: 1 } }),
      xrPad("right", { buttons: { [XR_BUTTON.grip]: 1 } }),
    ]);
    const first = mapQuestInput(pads, createGamepadEdgeState());
    expect(first.input.takeoverPressed).toBe(true);
    expect(first.input.cancelAlarmPressed).toBe(true);
    const second = mapQuestInput(pads, first.next);
    expect(second.input.takeoverPressed).toBe(false);
    expect(second.input.cancelAlarmPressed).toBe(false);
  });

  it("trims rate of descent on a sideways flick of the left stick", () => {
    const pads = questPadsFrom([xrPad("left", { axes: { [XR_AXIS.stickX]: 1 } })]);
    const first = mapQuestInput(pads, createGamepadEdgeState());
    expect(first.input.rodTrim).toBe(1);
    expect(mapQuestInput(pads, first.next).input.rodTrim).toBe(0);
  });

  it("is neutral with no headset controllers present", () => {
    const { input } = mapQuestInput(questPadsFrom([null]), createGamepadEdgeState());
    expect(input.thrustRate).toBe(0);
    expect(input.abortPressed).toBe(false);
  });
});
