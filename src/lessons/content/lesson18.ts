// SPDX-License-Identifier: GPL-3.0-or-later
// M5.0 Lesson 18 — Save the periapsis.
import type { LessonDefinition } from "../types";

export const LESSON_18_SAVE_THE_PERIAPSIS: LessonDefinition = {
  id: "lesson-18-save-the-periapsis",
  title: "Periapsis is the number that kills you",
  summary:
    "Why a low periapsis is the one orbital parameter with a deadline, and how a prograde burn at apoapsis fixes it for the least propellant.",
  steps: [
    {
      id: "the-deadline",
      kind: "reading",
      title: "Every other number can wait",
      body:
        "Apoapsis too high, period slightly wrong, phase angle drifting — those cost propellant and patience. A periapsis below the surface costs the vehicle, and it does so on a schedule you did not choose. The display shows IMPACT TRAJECTORY the instant the computed low point of your orbit falls below the terrain, which can be true long before anything looks wrong out of the window.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "burn-at-apoapsis",
      kind: "reading",
      title: "Burn at apoapsis to move periapsis",
      body:
        "A prograde burn raises the point on the opposite side of the orbit. So to lift periapsis you burn prograde at apoapsis — as far from the danger as you can get. This is not a convention; it is the cheapest place to do it. At apoapsis you are moving slowest, so a given delta-v changes your specific energy the least per metre per second spent, and all of it goes into the end of the orbit you actually want to move.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "velocity-vectors",
    },
    {
      id: "impulsive-vs-finite",
      kind: "reading",
      title: "The preview lies a little, on purpose",
      body:
        "The planner shows an IMPULSIVE MANEUVER PREVIEW: the orbit you would get if the whole delta-v arrived in an instant. Your engine cannot do that. A real burn takes tens of seconds, during which you move along the orbit and the thrust direction rotates with you, so the flown result is always slightly off the preview — usually a little short. That gap is not a bug in the planner and it is not a mistake by you; it is the reason flight crews planned a burn and then trimmed it afterwards.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "educational-visualization",
    },
    {
      id: "fly-it",
      kind: "reading",
      title: "Fly the rescue",
      body:
        "You start in an orbit whose periapsis is below the surface. Coast to apoapsis, set a prograde node, check the preview, and ignite. Pass when periapsis is safely above the surface and you still have propellant left.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "gameplay-tuned",
      challenge: {
        missionId: "save-the-periapsis",
        assistance: "instructor",
        controlMode: "maneuver-planner",
        passingScore: 60,
        route: "/play",
      },
    },
  ],
};
