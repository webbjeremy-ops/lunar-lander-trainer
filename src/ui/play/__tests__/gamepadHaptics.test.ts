// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  engineRumble,
  ENGINE_BED_PERIOD_MS,
  GamepadHaptics,
  HAPTIC_EVENTS,
} from "../gamepadHaptics";

describe("engineRumble", () => {
  it("is silent with the engine off or at zero throttle", () => {
    expect(engineRumble(1, false)).toBeNull();
    expect(engineRumble(0, true)).toBeNull();
  });

  it("rises monotonically with throttle and stays within [0,1]", () => {
    let previous = 0;
    for (const t of [0.1, 0.25, 0.5, 0.75, 1]) {
      const effect = engineRumble(t, true)!;
      expect(effect.strongMagnitude).toBeGreaterThan(previous);
      expect(effect.strongMagnitude).toBeLessThanOrEqual(1);
      expect(effect.weakMagnitude).toBeLessThanOrEqual(1);
      previous = effect.strongMagnitude;
    }
  });

  it("keeps a non-zero floor while the DPS is lit at 10 percent", () => {
    expect(engineRumble(0.1, true)!.strongMagnitude).toBeGreaterThan(0);
  });

  it("outlasts the bed refresh period so the rumble does not gap", () => {
    expect(engineRumble(0.5, true)!.durationMs).toBeGreaterThan(ENGINE_BED_PERIOD_MS);
  });
});

interface Played {
  readonly duration: number;
  readonly strongMagnitude: number;
}

function installFakePad(): Played[] {
  const played: Played[] = [];
  const pad = {
    connected: true,
    vibrationActuator: {
      playEffect: (_type: string, params: Record<string, number>) => {
        played.push({
          duration: params["duration"] ?? 0,
          strongMagnitude: params["strongMagnitude"] ?? 0,
        });
        return Promise.resolve("complete");
      },
      reset: () => Promise.resolve("complete"),
    },
  };
  (globalThis as unknown as { navigator: unknown }).navigator = {
    getGamepads: () => [pad],
  };
  return played;
}

describe("GamepadHaptics", () => {
  it("throttles engine bed effects to the refresh period", () => {
    const played = installFakePad();
    const haptics = new GamepadHaptics();
    haptics.engineBurst(60_000, 0);
    haptics.tick(0.5, true, 0);
    haptics.tick(0.5, true, 10);
    haptics.tick(0.5, true, 50);
    expect(played).toHaveLength(1);
    haptics.tick(0.5, true, ENGINE_BED_PERIOD_MS + 1);
    expect(played).toHaveLength(2);
  });

  it("suppresses the engine bed while an event pulse is playing", () => {
    const played = installFakePad();
    const haptics = new GamepadHaptics();
    haptics.engineBurst(60_000, 0);
    haptics.pulse("touchdown", 0);
    expect(played).toHaveLength(1);
    expect(played[0]!.duration).toBe(HAPTIC_EVENTS.touchdown.durationMs);
    haptics.tick(1, true, 100);
    expect(played).toHaveLength(1);
    haptics.tick(1, true, HAPTIC_EVENTS.touchdown.durationMs + 1);
    expect(played).toHaveLength(2);
  });

  it("plays nothing once disabled", () => {
    const played = installFakePad();
    const haptics = new GamepadHaptics();
    haptics.setEnabled(false);
    haptics.tick(1, true, 0);
    haptics.pulse("alarm", 0);
    expect(played).toHaveLength(0);
    expect(haptics.isEnabled()).toBe(false);
  });

  it("survives a pad with no vibration actuator", () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {
      getGamepads: () => [{ connected: true }],
    };
    const haptics = new GamepadHaptics();
    expect(() => {
      haptics.pulse("crash", 0);
      haptics.tick(1, true, 0);
      haptics.stop();
    }).not.toThrow();
  });
});

describe("engine bed burst window", () => {
  it("stays silent outside a burst even with the DPS at full throttle", () => {
    const played = installFakePad();
    const haptics = new GamepadHaptics();
    haptics.tick(1, true, 0);
    haptics.tick(1, true, ENGINE_BED_PERIOD_MS + 1);
    expect(played).toHaveLength(0);
  });

  it("stops the bed once the burst window expires", () => {
    const played = installFakePad();
    const haptics = new GamepadHaptics();
    haptics.engineBurst(1000, 0);
    haptics.tick(1, true, 0);
    expect(played).toHaveLength(1);
    haptics.tick(1, true, 1001);
    expect(played).toHaveLength(1);
  });
});
