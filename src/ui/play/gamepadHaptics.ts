// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.30 — Controller haptics for the LM cockpit.
//
// Two kinds of feedback:
//   * a CONTINUOUS engine bed whose magnitude tracks the DPS throttle, so the
//     crew feels the burn build at ignition and ease off at throttle recovery;
//   * discrete PULSES for the events that are felt in the cabin — ignition,
//     the program alarm, probe contact, touchdown, a hard landing, abort.
//
// The magnitude maths is pure and unit-tested; only `GamepadHaptics` touches
// the browser's vibration actuator, which is a no-op on pads that lack one.

export type HapticEvent =
  | "ignition"
  | "alarm"
  | "contact"
  | "touchdown"
  | "hard-landing"
  | "crash"
  | "abort"
  | "throttle-recovery";

export interface RumbleEffect {
  readonly durationMs: number;
  readonly weakMagnitude: number;
  readonly strongMagnitude: number;
}

/** Discrete event feedback, tuned so each event feels distinct. */
export const HAPTIC_EVENTS: Record<HapticEvent, RumbleEffect> = {
  // Ignition: a hard shove, then the engine bed takes over.
  ignition: { durationMs: 700, weakMagnitude: 0.6, strongMagnitude: 1 },
  // Master alarm: sharp and high-frequency, unmistakably a warning.
  alarm: { durationMs: 320, weakMagnitude: 1, strongMagnitude: 0.25 },
  // Probe contact: the light and the bump the crew actually felt.
  contact: { durationMs: 220, weakMagnitude: 0.45, strongMagnitude: 0.7 },
  touchdown: { durationMs: 550, weakMagnitude: 0.5, strongMagnitude: 0.85 },
  "hard-landing": { durationMs: 900, weakMagnitude: 0.9, strongMagnitude: 1 },
  crash: { durationMs: 1200, weakMagnitude: 1, strongMagnitude: 1 },
  abort: { durationMs: 800, weakMagnitude: 0.8, strongMagnitude: 1 },
  // Throttle recovery out of the fixed throttle point: a short notch.
  "throttle-recovery": { durationMs: 200, weakMagnitude: 0.35, strongMagnitude: 0.2 },
};

/** Engine bed refresh period, ms. Effects are re-armed slightly early. */
export const ENGINE_BED_PERIOD_MS = 180;

/**
 * M4.45 — "motion" texture. With the DPS cold (coast, pre-TIG countdown, P66
 * float) the pad would otherwise be dead. A soft irregular tremor keeps the
 * vehicle feeling alive without masking the event pulses.
 */
export const MOTION_MIN_GAP_MS = 2200;
export const MOTION_MAX_GAP_MS = 5200;
export const MOTION_EFFECT: RumbleEffect = {
  durationMs: 260,
  weakMagnitude: 0.18,
  strongMagnitude: 0.1,
};

/**
 * Engine rumble for a commanded throttle. Silent with the engine off; a floor
 * of idle vibration once it is lit so the pad is never dead during a burn.
 */
export function engineRumble(throttle: number, engineOn: boolean): RumbleEffect | null {
  if (!engineOn || throttle <= 0.001) return null;
  const t = Math.max(0, Math.min(1, throttle));
  return {
    durationMs: ENGINE_BED_PERIOD_MS + 60,
    weakMagnitude: 0.16 + 0.34 * t,
    strongMagnitude: 0.22 + 0.6 * t,
  };
}


interface VibrationActuatorLike {
  playEffect(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
  /** Older Firefox / WebKit surface. */
  pulse?(value: number, durationMs: number): Promise<unknown>;
}

interface PadWithHaptics {
  readonly vibrationActuator?: VibrationActuatorLike | null;
  readonly hapticActuators?: readonly VibrationActuatorLike[];
}

function actuatorOf(pad: unknown): VibrationActuatorLike | null {
  const p = pad as PadWithHaptics | null;
  const a = p?.vibrationActuator;
  if (a && (typeof a.playEffect === "function" || typeof a.pulse === "function")) return a;
  const legacy = p?.hapticActuators?.[0];
  if (legacy && (typeof legacy.playEffect === "function" || typeof legacy.pulse === "function")) {
    return legacy;
  }
  return null;
}


/**
 * Drives the pad. `tick` is called from the flight loop with the live throttle;
 * `pulse` is called from event edges. Event pulses take priority: the engine
 * bed is suppressed until the pulse has played out, so a landing thump is not
 * washed out by the burn.
 */
export class GamepadHaptics {
  private enabled = true;
  private nextBedAtMs = 0;
  private pulseUntilMs = 0;
  private nextMotionAtMs = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private play(effect: RumbleEffect): void {
    if (!this.enabled) return;
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    // Chrome hands out fresh Gamepad objects each poll; re-read every time so
    // the actuator we talk to is never a stale one from a previous frame.
    for (const pad of navigator.getGamepads()) {
      const actuator = actuatorOf(pad);
      if (!actuator) continue;
      if (typeof actuator.playEffect === "function") {
        void Promise.resolve()
          .then(() =>
            actuator.playEffect("dual-rumble", {
              startDelay: 0,
              duration: effect.durationMs,
              weakMagnitude: effect.weakMagnitude,
              strongMagnitude: effect.strongMagnitude,
            }),
          )
          .catch(() => {
            if (typeof actuator.pulse === "function") {
              void actuator.pulse(effect.strongMagnitude, effect.durationMs).catch(() => undefined);
            }
          });
      } else if (typeof actuator.pulse === "function") {
        void actuator.pulse(effect.strongMagnitude, effect.durationMs).catch(() => undefined);
      }
    }
  }

  /** Discrete event feedback. */
  pulse(event: HapticEvent, nowMs: number = Date.now()): void {
    const effect = HAPTIC_EVENTS[event];
    this.play(effect);
    this.pulseUntilMs = nowMs + effect.durationMs;
    this.nextBedAtMs = this.pulseUntilMs;
    this.nextMotionAtMs = this.pulseUntilMs + MOTION_MIN_GAP_MS;
  }

  /** Continuous engine bed; safe to call every frame. */
  tick(throttle: number, engineOn: boolean, nowMs: number = Date.now()): void {
    if (!this.enabled) return;
    if (nowMs < this.pulseUntilMs) return;
    const effect = engineRumble(throttle, engineOn);
    if (effect === null) {
      if (this.nextBedAtMs !== 0) {
        this.stop();
        this.nextBedAtMs = 0;
      }
      this.tickMotion(nowMs);
      return;
    }
    if (nowMs < this.nextBedAtMs) return;
    this.nextBedAtMs = nowMs + ENGINE_BED_PERIOD_MS;
    this.nextMotionAtMs = nowMs + MOTION_MIN_GAP_MS;
    this.play(effect);
  }

  /**
   * Occasional coast tremor. Only runs with the DPS cold, so it never fights
   * the engine bed; the gap wanders so it does not read as a metronome.
   */
  private tickMotion(nowMs: number): void {
    if (this.nextMotionAtMs === 0) {
      this.nextMotionAtMs = nowMs + MOTION_MIN_GAP_MS;
      return;
    }
    if (nowMs < this.nextMotionAtMs) return;
    const span = MOTION_MAX_GAP_MS - MOTION_MIN_GAP_MS;
    this.nextMotionAtMs = nowMs + MOTION_MIN_GAP_MS + Math.random() * span;
    this.play(MOTION_EFFECT);
  }

  stop(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      const actuator = actuatorOf(pad);
      if (actuator?.reset) void actuator.reset().catch(() => undefined);
    }
  }
}

