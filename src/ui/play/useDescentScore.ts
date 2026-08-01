// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.21 — React binding for the procedural descent score.
//
// Owns one DescentScoreEngine, starts it on an explicit user gesture (browser
// autoplay policy), and feeds it the tension derived from the live flight.

import { useCallback, useEffect, useRef, useState } from "react";
import { descentTension, inTheZone, type ScoreStage } from "@/game/play";
import { DescentScoreEngine } from "./DescentScoreEngine";

export interface DescentScoreInput {
  readonly sinceIgnitionSec: number;
  readonly altitudeM: number;
  readonly propellantFraction: number;
  readonly houstonStage: ScoreStage;
  readonly crewAborted: boolean;
  readonly terminal: boolean;
  /** The simulation is actually advancing. */
  readonly running: boolean;
  /**
   * M4.32 — 0..1 multiplier applied to the master volume. Drops while an
   * air-to-ground recording is playing so the crew loop sits on top without
   * the score cutting out entirely.
   */
  readonly duck?: number;
}

export interface DescentScoreApi {
  readonly enabled: boolean;
  readonly tension: number;
  /** Final seconds before contact: muffled score, heartbeat up front. */
  readonly zone: boolean;
  readonly toggle: () => void;
}

export function useDescentScore(input: DescentScoreInput): DescentScoreApi {
  const engineRef = useRef<DescentScoreEngine | null>(null);
  // The score is on by default; browsers still require a gesture before audio
  // may sound, so the engine is armed and started on the first interaction.
  const [enabled, setEnabled] = useState(true);

  const tensionInput = {
    sinceIgnitionSec: input.sinceIgnitionSec,
    altitudeM: input.altitudeM,
    propellantFraction: input.propellantFraction,
    houstonStage: input.houstonStage,
    crewAborted: input.crewAborted,
    terminal: input.terminal,
  } as const;
  const tension = descentTension(tensionInput);
  const zone = inTheZone(tensionInput);

  const startEngine = useCallback(() => {
    const engine = engineRef.current ?? new DescentScoreEngine();
    engineRef.current = engine;
    engine.start();
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (next) {
        startEngine();
      } else {
        engineRef.current?.stop();
        engineRef.current = null;
      }
      return next;
    });
  }, [startEngine]);

  // Autoplay policy: wait for the first pointer/key event anywhere, then light
  // the engine. Listeners remove themselves after one successful start.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (engineRef.current?.isRunning) return;
    const onGesture = () => {
      startEngine();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    // Try immediately in case the context is already allowed to run.
    startEngine();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [enabled, startEngine]);


  // Feed tension continuously; duck the score while the sim is paused, and
  // again while a mission recording is on the comm loop.
  const duck = input.duck ?? 1;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !enabled) return;
    engine.setVolume((input.running ? 0.9 : 0.35) * duck);
    engine.setTension(tension);
    engine.setZone(zone && input.running);
  }, [enabled, tension, zone, input.running, duck]);

  useEffect(() => () => engineRef.current?.stop(), []);

  return { enabled, tension, zone, toggle };
}
