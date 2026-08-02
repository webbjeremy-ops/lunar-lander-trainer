// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.30 / M4.45 — Xbox controller mapping for the LM cockpit.
//
// This module is PURE: it turns a raw gamepad snapshot into a cockpit input
// record and tracks button edges. It never touches the flight kernel, the AGC
// or React. The physical mapping the crew asked for:
//
//   Left stick (vertical)    thrust — pushed forward the throttle winds up,
//                            pulled back it winds down (rate control, exactly
//                            like holding the arrow keys)
//   Right stick (horizontal) pitch — rate command to the attitude controller
//   Right trigger            roll toward windows-up (the R key)
//   Left trigger             TAKE MANUAL CONTROL (crew handover)
//   A                        acknowledge the on-screen call — "Got it" /
//                            "Copy that" (never an alarm)
//   X                        ENG ARM — the PDI descent-arm switch
//   Y                        DPS engine on/off
//   B                        ABORT STAGE
//   Right bumper (RB)        cancel the program alarm
//   Left bumper (LB)         easy program acceptance — key the pending DSKY
//                            step for the crew (M4.31)
//   D-pad up / down          rate-of-descent trim

//
// Standard-mapping indices are used throughout; every Xbox pad reports the
// standard mapping in Chromium and Firefox.

/** Standard-mapping axis indices. */
export const AXIS = {
  leftStickX: 0,
  leftStickY: 1,
  rightStickX: 2,
  rightStickY: 3,
} as const;

/** Standard-mapping button indices used by the cockpit. */
export const BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
} as const;

/** Sticks rest slightly off-centre; ignore anything inside this. */
export const STICK_DEADZONE = 0.15;
/** Triggers rest at 0 but chatter; treat this as "pulled". */
export const TRIGGER_THRESHOLD = 0.35;

/** Minimal structural view of a Gamepad, so the mapping stays testable. */
export interface GamepadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly connected?: boolean;
  readonly mapping?: string;
  readonly index?: number;
}

export interface XboxCockpitInput {
  /** Throttle RATE command, [-1, 1]. Positive winds the throttle up. */
  readonly thrustRate: number;
  /** Pitch stick, [-1, 1]. Positive pitches the nose right/forward. */
  readonly pitch: number;
  /** Right trigger pull, [0, 1]. */
  readonly rollPull: number;
  /** True while the right trigger is past the roll threshold. */
  readonly rollCommanded: boolean;
  /** Rate-of-descent trim steps requested this frame (D-pad up/down). */
  readonly rodTrim: number;
  readonly cancelAlarmPressed: boolean;
  /** M4.31 — LB: key the pending DSKY step for the crew. */
  readonly acceptProgramPressed: boolean;
  /** M4.45 — A: acknowledge the on-screen call ("Got it" / "Copy that"). */
  readonly acknowledgePressed: boolean;
  /** M4.45 — X: the PDI ENG ARM switch. */
  readonly armEnginePressed: boolean;
  /** M4.45 — left trigger: take manual control of the vehicle. */
  readonly takeoverPressed: boolean;
  /** Y: DPS engine on/off. */
  readonly enginePressed: boolean;
  readonly abortPressed: boolean;
}

export const NEUTRAL_INPUT: XboxCockpitInput = {
  thrustRate: 0,
  pitch: 0,
  rollPull: 0,
  rollCommanded: false,
  rodTrim: 0,
  cancelAlarmPressed: false,
  acceptProgramPressed: false,
  acknowledgePressed: false,
  armEnginePressed: false,
  takeoverPressed: false,
  enginePressed: false,
  abortPressed: false,
};


/** Applies a deadzone and rescales the remainder to the full [-1, 1] range. */
export function applyDeadzone(value: number, deadzone = STICK_DEADZONE): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(1, scaled);
}

function axis(pad: GamepadSnapshot, index: number): number {
  return pad.axes[index] ?? 0;
}

function buttonValue(pad: GamepadSnapshot, index: number): number {
  const b = pad.buttons[index];
  if (b === undefined) return 0;
  return b.pressed && b.value === 0 ? 1 : b.value;
}

function buttonPressed(pad: GamepadSnapshot, index: number): boolean {
  return pad.buttons[index]?.pressed ?? buttonValue(pad, index) > 0.5;
}

/**
 * Edge tracker: the loop runs at 50 Hz, so a held button would otherwise fire
 * its action fifty times a second. Only the press EDGE counts.
 */
export interface GamepadEdgeState {
  readonly held: ReadonlySet<number>;
}

export function createGamepadEdgeState(): GamepadEdgeState {
  return { held: new Set<number>() };
}

/**
 * Maps one gamepad snapshot onto cockpit inputs. Button actions are reported
 * only on the frame the button goes down; `next` is the edge state to keep for
 * the following frame.
 */
export function mapXboxInput(
  pad: GamepadSnapshot | null,
  edges: GamepadEdgeState,
): { readonly input: XboxCockpitInput; readonly next: GamepadEdgeState } {
  if (pad === null) {
    return { input: NEUTRAL_INPUT, next: createGamepadEdgeState() };
  }
  const held = new Set<number>();
  const wasHeld = (index: number) => edges.held.has(index);
  const edge = (index: number): boolean => {
    const down = buttonPressed(pad, index);
    if (down) held.add(index);
    return down && !wasHeld(index);
  };

  const cancelAlarmPressed = edge(BUTTON.rightBumper);
  const enginePressed = edge(BUTTON.a);
  const abortPressed = edge(BUTTON.b);
  const acceptProgramPressed = edge(BUTTON.leftBumper);
  const trimUp = edge(BUTTON.dpadUp);
  const dpadTrimDown = edge(BUTTON.dpadDown);
  const leftTriggerDown = buttonValue(pad, BUTTON.leftTrigger) > TRIGGER_THRESHOLD;
  if (leftTriggerDown) held.add(BUTTON.leftTrigger);
  const trimDown = (leftTriggerDown && !wasHeld(BUTTON.leftTrigger)) || dpadTrimDown;

  const rollPull = Math.max(0, Math.min(1, buttonValue(pad, BUTTON.rightTrigger)));

  return {
    input: {
      // Stick Y is negative when pushed forward.
      thrustRate: applyDeadzone(-axis(pad, AXIS.leftStickY)),
      pitch: applyDeadzone(axis(pad, AXIS.rightStickX)),
      rollPull,
      rollCommanded: rollPull > TRIGGER_THRESHOLD,
      rodTrim: (trimUp ? 1 : 0) - (trimDown ? 1 : 0),
      cancelAlarmPressed,
      acceptProgramPressed,
      enginePressed,
      abortPressed,
    },
    next: { held },
  };
}

/** First connected pad, standard mapping preferred. */
export function firstConnectedPad(
  pads: readonly (GamepadSnapshot | null)[],
): GamepadSnapshot | null {
  let fallback: GamepadSnapshot | null = null;
  for (const pad of pads) {
    if (!pad) continue;
    if (pad.connected === false) continue;
    if (pad.mapping === "standard") return pad;
    fallback ??= pad;
  }
  return fallback;
}

export function readLivePad(): GamepadSnapshot | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  return firstConnectedPad(navigator.getGamepads() as (GamepadSnapshot | null)[]);
}
