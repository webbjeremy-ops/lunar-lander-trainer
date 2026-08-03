// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.57 — Meta Quest 3 (Touch Plus) controller mapping.
//
// The Quest browser exposes both hand controllers through the Gamepad API with
// the "xr-standard" mapping, so the cockpit can be flown from the headset with
// no immersive session required. The mapping is deliberately a translation of
// the Xbox layout, so every downstream consumer keeps working:
//
//   Left thumbstick  ↑/↓   DPS throttle (guided) / fine trim (manual)
//   Left thumbstick  ←/→   rate-of-descent trim, one step per flick
//   Left trigger           TAKE MANUAL CONTROL
//   Left grip              accept the pending DSKY program (PRO)
//   X (left, button 4)     ENG ARM
//   Y (left, button 5)     DPS engine on / off
//   Right thumbstick ↑/↓   pitch (manual) / page scroll (guided)
//   Right thumbstick press window view on / off
//   Right trigger          roll to windows-up (guided) / throttle (manual)
//   Right grip             cancel program alarm / short throttle burst
//   A (right, button 4)    "Got it" / "Copy that"
//   B (right, button 5)    ABORT STAGE

import {
  NEUTRAL_INPUT,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
  applyDeadzone,
  type GamepadEdgeState,
  type GamepadSnapshot,
  type XboxCockpitInput,
} from "./xboxGamepad";

/** xr-standard button indices, identical on both Touch controllers. */
export const XR_BUTTON = {
  trigger: 0,
  grip: 1,
  thumbstickPress: 3,
  lower: 4, // X on the left hand, A on the right
  upper: 5, // Y on the left hand, B on the right
} as const;

/** xr-standard axis indices (0/1 are the unused touchpad axes). */
export const XR_AXIS = { stickX: 2, stickY: 3 } as const;

/** Edge keys are namespaced per hand so the two pads never collide. */
const RIGHT_HAND_OFFSET = 100;

/** Sideways flick threshold for the rate-of-descent trim. */
export const TRIM_FLICK = 0.6;

export interface QuestPads {
  readonly left: GamepadSnapshot | null;
  readonly right: GamepadSnapshot | null;
}

function isXr(pad: GamepadSnapshot | null): boolean {
  return !!pad && pad.connected !== false && (pad.mapping ?? "") === "xr-standard";
}

/** Splits the live pad list into the left and right Touch controllers. */
export function questPadsFrom(
  pads: readonly (GamepadSnapshot | null)[],
): QuestPads {
  const xr = pads.filter(isXr) as GamepadSnapshot[];
  let left: GamepadSnapshot | null = null;
  let right: GamepadSnapshot | null = null;
  for (const pad of xr) {
    const hand = (pad as { hand?: string }).hand;
    const id = ((pad as { id?: string }).id ?? "").toLowerCase();
    const isLeft = hand === "left" || id.includes("left");
    const isRight = hand === "right" || id.includes("right");
    if (isLeft && !left) left = pad;
    else if (isRight && !right) right = pad;
    else if (!left) left = pad;
    else right ??= pad;
  }
  return { left, right };
}

export function readLiveQuestPads(): QuestPads {
  if (typeof navigator === "undefined" || !navigator.getGamepads) {
    return { left: null, right: null };
  }
  return questPadsFrom(navigator.getGamepads() as (GamepadSnapshot | null)[]);
}

function axis(pad: GamepadSnapshot | null, index: number): number {
  return pad?.axes[index] ?? 0;
}

function value(pad: GamepadSnapshot | null, index: number): number {
  const b = pad?.buttons[index];
  if (!b) return 0;
  return b.pressed && b.value === 0 ? 1 : b.value;
}

function down(pad: GamepadSnapshot | null, index: number): boolean {
  return pad?.buttons[index]?.pressed ?? value(pad, index) > 0.5;
}

/**
 * Maps one frame of both Touch controllers onto the same cockpit input record
 * the Xbox mapper produces. Button actions fire on the press edge only.
 */
export function mapQuestInput(
  pads: QuestPads,
  edges: GamepadEdgeState,
): { readonly input: XboxCockpitInput; readonly next: GamepadEdgeState } {
  const { left, right } = pads;
  if (!left && !right) {
    return { input: NEUTRAL_INPUT, next: { held: new Set<number>() } };
  }

  const held = new Set<number>();
  const edge = (pad: GamepadSnapshot | null, index: number, offset: number): boolean => {
    const key = index + offset;
    const pressed = down(pad, index);
    if (pressed) held.add(key);
    return pressed && !edges.held.has(key);
  };
  const analogEdge = (key: number, pressed: boolean): boolean => {
    if (pressed) held.add(key);
    return pressed && !edges.held.has(key);
  };

  const armEnginePressed = edge(left, XR_BUTTON.lower, 0);
  const enginePressed = edge(left, XR_BUTTON.upper, 0);
  const acceptProgramPressed = analogEdge(
    XR_BUTTON.grip,
    value(left, XR_BUTTON.grip) > TRIGGER_THRESHOLD,
  );
  const takeoverPressed = analogEdge(
    XR_BUTTON.trigger,
    value(left, XR_BUTTON.trigger) > TRIGGER_THRESHOLD,
  );

  const acknowledgePressed = edge(right, XR_BUTTON.lower, RIGHT_HAND_OFFSET);
  const abortPressed = edge(right, XR_BUTTON.upper, RIGHT_HAND_OFFSET);
  const toggleViewPressed = edge(right, XR_BUTTON.thumbstickPress, RIGHT_HAND_OFFSET);
  const cancelAlarmPressed = analogEdge(
    XR_BUTTON.grip + RIGHT_HAND_OFFSET,
    value(right, XR_BUTTON.grip) > TRIGGER_THRESHOLD,
  );

  // Rate-of-descent trim: a sideways flick of the left stick, one step per
  // flick (held to the side does not repeat).
  const leftX = applyDeadzone(axis(left, XR_AXIS.stickX));
  const trimUp = analogEdge(200, leftX > TRIM_FLICK);
  const trimDown = analogEdge(201, leftX < -TRIM_FLICK);

  const rollPull = Math.max(0, Math.min(1, value(right, XR_BUTTON.trigger)));
  const rightY = applyDeadzone(axis(right, XR_AXIS.stickY), STICK_DEADZONE);

  return {
    input: {
      thrustRate: applyDeadzone(-axis(left, XR_AXIS.stickY)),
      pitch: -rightY,
      rollPull,
      rollCommanded: rollPull > TRIGGER_THRESHOLD,
      rodTrim: (trimUp ? 1 : 0) - (trimDown ? 1 : 0),
      cancelAlarmPressed,
      acceptProgramPressed,
      acknowledgePressed,
      armEnginePressed,
      takeoverPressed,
      enginePressed,
      abortPressed,
      toggleViewPressed,
      scrollRate: rightY,
    },
    next: { held },
  };
}
