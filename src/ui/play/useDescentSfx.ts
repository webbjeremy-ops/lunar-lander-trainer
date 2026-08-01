// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.26 — React binding for the cockpit sound effects.
//
// Shares the score's on/off state so one control governs all cockpit audio.
// Engine level tracks the live throttle; one-shots fire on state edges.

import { useEffect, useRef } from "react";
import { DescentSfxEngine } from "./DescentSfxEngine";

export interface DescentSfxInput {
  /** Player toggle — mirrors the descent score. */
  readonly enabled: boolean;
  /** 0..1 DPS throttle. */
  readonly throttle: number;
  readonly engineOn: boolean;
  /** A program alarm (1201/1202) is lit and unresolved. */
  readonly alarmActive: boolean;
  /** Footpad probes have touched. */
  readonly contact: boolean;
  readonly running: boolean;
}

export function useDescentSfx(input: DescentSfxInput): void {
  const engineRef = useRef<DescentSfxEngine | null>(null);
  const prevEngineOn = useRef(false);
  const prevThrottle = useRef(0);
  const prevContact = useRef(false);

  // Arm on the first gesture, exactly like the score.
  useEffect(() => {
    if (!input.enabled || typeof window === "undefined") {
      engineRef.current?.stop();
      engineRef.current = null;
      return;
    }
    const startEngine = () => {
      const engine = engineRef.current ?? new DescentSfxEngine();
      engineRef.current = engine;
      engine.start();
    };
    const onGesture = () => {
      startEngine();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    startEngine();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [input.enabled]);

  useEffect(() => () => engineRef.current?.stop(), []);

  // Engine bed + ignition / throttle-up one-shots.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !input.enabled) return;
    engine.setVolume(input.running ? 0.85 : 0.3);
    engine.setEngine(input.throttle, input.engineOn);

    if (input.engineOn && !prevEngineOn.current) {
      engine.boost(1); // DPS ignition
    } else if (
      input.engineOn &&
      input.throttle - prevThrottle.current > 0.25 // throttle-up to FTP
    ) {
      engine.boost(0.6);
    }
    prevEngineOn.current = input.engineOn;
    prevThrottle.current = input.throttle;
  }, [input.enabled, input.throttle, input.engineOn, input.running]);

  // Master alarm.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setAlarm(input.enabled && input.alarmActive);
    return () => engine.setAlarm(false);
  }, [input.enabled, input.alarmActive]);

  // Lunar contact chime, once.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !input.enabled) return;
    if (input.contact && !prevContact.current) engine.contactChime();
    prevContact.current = input.contact;
  }, [input.enabled, input.contact]);
}
