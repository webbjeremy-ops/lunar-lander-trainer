// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  AXIS,
  BUTTON,
  createGamepadEdgeState,
  mapXboxInput,
  NEUTRAL_INPUT,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
  type GamepadSnapshot,
} from "../xboxGamepad";

function pad(
  overrides: {
    axes?: Partial<Record<number, number>>;
    buttons?: Partial<Record<number, number>>;
  } = {},
): GamepadSnapshot {
  const axes = [0, 0, 0, 0].map((v, i) => overrides.axes?.[i] ?? v);
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = overrides.buttons?.[i] ?? 0;
    return { pressed: value > 0.5, value };
  });
  return { axes, buttons, connected: true, mapping: "standard", index: 0 };
}

describe("mapXboxInput", () => {
  it("returns neutral input with no pad attached", () => {
    const { input } = mapXboxInput(null, createGamepadEdgeState());
    expect(input).toEqual(NEUTRAL_INPUT);
  });

  it("winds the throttle up when the left stick is pushed forward", () => {
    // The Gamepad API reports forward as NEGATIVE on the Y axis.
    const { input } = mapXboxInput(
      pad({ axes: { [AXIS.leftStickY]: -1 } }),
      createGamepadEdgeState(),
    );
    expect(input.thrustRate).toBeCloseTo(1, 6);
  });

  it("winds the throttle down when the left stick is pulled back", () => {
    const { input } = mapXboxInput(
      pad({ axes: { [AXIS.leftStickY]: 1 } }),
      createGamepadEdgeState(),
    );
    expect(input.thrustRate).toBeCloseTo(-1, 6);
  });

  it("ignores stick rest chatter inside the deadzone", () => {
    const { input } = mapXboxInput(
      pad({
        axes: {
          [AXIS.leftStickY]: STICK_DEADZONE * 0.5,
          [AXIS.rightStickX]: -STICK_DEADZONE * 0.5,
        },
      }),
      createGamepadEdgeState(),
    );
    expect(input.thrustRate).toBe(0);
    expect(input.pitch).toBe(0);
  });

  it("pitches from the right stick", () => {
    const { input } = mapXboxInput(
      pad({ axes: { [AXIS.rightStickX]: 1 } }),
      createGamepadEdgeState(),
    );
    expect(input.pitch).toBeCloseTo(1, 6);
  });

  it("commands roll from the right trigger past the threshold only", () => {
    const light = mapXboxInput(
      pad({ buttons: { [BUTTON.rightTrigger]: TRIGGER_THRESHOLD / 2 } }),
      createGamepadEdgeState(),
    ).input;
    expect(light.rollCommanded).toBe(false);

    const full = mapXboxInput(
      pad({ buttons: { [BUTTON.rightTrigger]: 1 } }),
      createGamepadEdgeState(),
    ).input;
    expect(full.rollCommanded).toBe(true);
    expect(full.rollPull).toBeCloseTo(1, 6);
  });

  it("reports the alarm cancel only on the press edge, not while held", () => {
    const held = pad({ buttons: { [BUTTON.rightBumper]: 1 } });
    const first = mapXboxInput(held, createGamepadEdgeState());
    expect(first.input.cancelAlarmPressed).toBe(true);

    const second = mapXboxInput(held, first.next);
    expect(second.input.cancelAlarmPressed).toBe(false);

    // Release, then press again — the edge fires once more.
    const released = mapXboxInput(pad(), second.next);
    const third = mapXboxInput(held, released.next);
    expect(third.input.cancelAlarmPressed).toBe(true);
  });

  it("edge-detects the engine and abort buttons independently", () => {
    const both = pad({ buttons: { [BUTTON.a]: 1, [BUTTON.b]: 1 } });
    const first = mapXboxInput(both, createGamepadEdgeState());
    expect(first.input.enginePressed).toBe(true);
    expect(first.input.abortPressed).toBe(true);
    const second = mapXboxInput(both, first.next);
    expect(second.input.enginePressed).toBe(false);
    expect(second.input.abortPressed).toBe(false);
  });

  it("accepts the pending DSKY program on the LB press edge only", () => {
    const held = pad({ buttons: { [BUTTON.leftBumper]: 1 } });
    const first = mapXboxInput(held, createGamepadEdgeState());
    expect(first.input.acceptProgramPressed).toBe(true);
    expect(first.input.rodTrim).toBe(0); // LB no longer trims
    const second = mapXboxInput(held, first.next);
    expect(second.input.acceptProgramPressed).toBe(false);
  });

  it("trims rate of descent on the D-pad and down on the left trigger", () => {
    const up = mapXboxInput(
      pad({ buttons: { [BUTTON.dpadUp]: 1 } }),
      createGamepadEdgeState(),
    ).input;
    expect(up.rodTrim).toBe(1);

    const dpadDown = mapXboxInput(
      pad({ buttons: { [BUTTON.dpadDown]: 1 } }),
      createGamepadEdgeState(),
    ).input;
    expect(dpadDown.rodTrim).toBe(-1);

    const down = mapXboxInput(
      pad({ buttons: { [BUTTON.leftTrigger]: 1 } }),
      createGamepadEdgeState(),
    ).input;
    expect(down.rodTrim).toBe(-1);
  });

  it("clears all edges when the pad is unplugged mid-flight", () => {
    const first = mapXboxInput(
      pad({ buttons: { [BUTTON.rightBumper]: 1 } }),
      createGamepadEdgeState(),
    );
    const unplugged = mapXboxInput(null, first.next);
    expect(unplugged.next.held.size).toBe(0);
  });
});
