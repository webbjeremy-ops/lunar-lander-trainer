// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 13 — Fly the terminal descent (lesson → game handoff).
import type { LessonDefinition } from "../types";

export const LESSON_13_FLY_THE_TERMINAL_DESCENT: LessonDefinition = {
  id: "lesson-13-fly-the-terminal-descent",
  title: "Fly the terminal descent",
  summary:
    "Take everything from Track 1 into the cockpit: a scored terminal-descent challenge, then a debrief against your own flight data.",
  steps: [
    {
      id: "brief",
      kind: "reading",
      title: "Your task",
      body:
        "You start near low gate with the vehicle already slow and low. Null the remaining lateral drift, walk the throttle down as the vehicle lightens, and touch down inside the gear limits: 3.05 m/s sink, 1.2 m/s lateral, and level. Keep an eye on the propellant bar — running the tanks dry above the surface ends the flight exactly as it would have in 1969.",
      sources: [{ id: "m4-0-kernel" }, { id: "apollo-11-mission-report" }],
      classification: "source-derived",
      diagramId: "landing-energy",
    },
    {
      id: "fly-it",
      kind: "reading",
      title: "Fly it",
      body:
        "Launch the scored Terminal Descent challenge. When the flight ends, the result returns here automatically: your score, grade, contact conditions and remaining propellant appear in the lesson debrief, and this step is marked complete. You can re-fly it as often as you like — only your best score is kept.",
      ackLabel: "Fly the terminal descent",
      sources: [{ id: "m4-0-kernel" }],
      classification: "gameplay-tuned",
      challenge: {
        missionId: "terminal-descent",
        assistance: "pilot",
        controlMode: "quick-manual",
        passingScore: 55,
      },
    },
    {
      id: "reflect",
      kind: "reading",
      title: "Read your own numbers",
      body:
        "Compare your contact sink rate and lateral drift with the gear limits, and your propellant remaining with Apollo 11's roughly 25 seconds of margin. A landing that is inside limits but with almost no propellant left is not a good landing — it is a lucky one. Fly it again and try to arrive at 30 m altitude with sink under 2 m/s and drift under 0.5 m/s; the rest is easy from there.",
      sources: [{ id: "apollo-11-mission-report" }],
      classification: "historically-grounded",
    },
  ],
};
