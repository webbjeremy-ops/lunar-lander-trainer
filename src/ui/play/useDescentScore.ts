// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.21 — React binding for the procedural descent score.
//
// Owns one DescentScoreEngine, starts it on an explicit user gesture (browser
// autoplay policy), and feeds it the tension derived from the live flight.

import { useCallback, useEffect, useRef, useState } from "react";
import { descentTension, type ScoreStage } from "@/game/play";
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
}

export interface DescentScoreApi {
  readonly enabled: boolean;
  readonly tension: number;
  readonly toggle: () => void;
}

export function useDescentScore(input: DescentScoreInput): DescentScoreApi {
  const engineRef = useRef<DescentScoreEngine | null>(null);
  const [enabled, setEnabled] = useState(false);

  const tension = descentTension({
    sinceIgnitionSec: input.sinceIgnitionSec,
    altitudeM: input.altitudeM,
    propellantFraction: input.propellantFraction,
    houstonStage: input.houstonStage,
    crewAborted: input.crewAborted,
    terminal: input.terminal,
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (next) {
        const engine = engineRef.current ?? new DescentScoreEngine();
        engineRef.current = engine;
        engine.start();
      } else {
        engineRef.current?.stop();
        engineRef.current = null;
      }
      return next;
    });
  }, []);

  // Feed tension continuously; duck the score while the sim is paused.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !enabled) return;
    engine.setVolume(input.running ? 0.7 : 0.25);
    engine.setTension(tension);
  }, [enabled, tension, input.running]);

  useEffect(() => () => engineRef.current?.stop(), []);

  return { enabled, tension, toggle };
}
