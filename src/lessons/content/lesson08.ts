// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 8 — Why the LM falls.
import type { LessonDefinition } from "../types";

export const LESSON_08_WHY_THE_LM_FALLS: LessonDefinition = {
  id: "lesson-08-why-the-lm-falls",
  title: "Why the LM falls",
  summary:
    "Lunar gravity, the absence of an atmosphere, and the difference between weight and mass — the three facts that shape every landing you will fly.",
  steps: [
    {
      id: "lunar-gravity",
      kind: "reading",
      title: "One sixth of a g — but still relentless",
      body:
        "Surface gravity on the Moon is about 1.62 m/s², roughly one sixth of Earth's 9.81 m/s². The flight kernel uses an inverse-square field from the lunar gravitational parameter μ = 4.9028 × 10¹² m³/s² and a mean radius of 1,737.4 km, so gravity weakens slightly with altitude instead of being a fixed constant. One sixth sounds gentle, but it never switches off: hold the engine at zero for 60 seconds and you have picked up about 97 m/s of sink rate.",
      sources: [{ id: "lunar2d-jpl-de-lunar-gm" }, { id: "nasa-sp-4029" }],
      classification: "source-derived",
      diagramId: "thrust-gravity-vectors",
    },
    {
      id: "no-atmosphere",
      kind: "reading",
      title: "No air means no free braking",
      body:
        "There is no aerodynamic drag, no parachute, no terminal velocity, and no wings. On Earth a falling object stops accelerating once drag balances weight; on the Moon it accelerates all the way to the surface. Every single metre per second you remove must be paid for with propellant burned through the descent engine. That is why the Apollo descent is a continuous, carefully budgeted burn rather than a glide.",
      sources: [{ id: "nasa-sp-4029" }],
      classification: "historically-grounded",
    },
    {
      id: "weight-vs-mass",
      kind: "reading",
      title: "Weight changes, mass does not",
      body:
        "Mass is how much vehicle there is; weight is how hard gravity pulls on it. A LM with 15,000 kg of mass weighs about 147 kN on Earth but only about 24 kN on the Moon — yet its mass, and therefore its resistance to being accelerated sideways, is identical in both places. This is the trap: the vehicle feels light vertically and heavy horizontally. Killing 20 m/s of sideways drift near the surface costs exactly as much impulse on the Moon as it would on Earth.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "velocity-vectors",
    },
    {
      id: "consequence",
      kind: "reading",
      title: "What this means for you in the cockpit",
      body:
        "Because gravity is constant and drag is absent, altitude alone is never the problem — the problem is the velocity you still carry when altitude runs out. Read your descent rate before your altimeter. In the game the instrument panel shows both; the sink-rate limit at contact is 3.05 m/s for a nominal landing, taken from the Apollo landing-gear stroke criteria.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "landing-energy",
    },
  ],
};
