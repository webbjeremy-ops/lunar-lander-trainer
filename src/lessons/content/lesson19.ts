// SPDX-License-Identifier: GPL-3.0-or-later
// M5.0 Lesson 19 — Circularising an orbit.
import type { LessonDefinition } from "../types";

export const LESSON_19_CIRCULARIZING: LessonDefinition = {
  id: "lesson-19-circularizing",
  title: "Circularising an orbit",
  summary:
    "What a circular orbit is worth, why one burn at an apsis is enough, and how to judge the result.",
  steps: [
    {
      id: "why-circular",
      kind: "reading",
      title: "Why anyone bothers",
      body:
        "A circular orbit has the same altitude everywhere, so the terrain clearance you check once is the clearance you keep. It also has a constant speed and a predictable ground track, which is exactly what you want for a parking orbit while you wait for a rendezvous window. Apollo's lunar parking orbit was near-circular at roughly 60 nautical miles for precisely these reasons.",
      sources: [{ id: "apollo-11-mission-report" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "one-burn",
      kind: "reading",
      title: "One burn, at an apsis",
      body:
        "To circularise at apoapsis you need the speed that a circular orbit at that radius would have — the circular speed, the square root of mu over r. You already have the tangential speed of an ellipse at its high point, which is less. The difference is your delta-v, prograde, applied at apoapsis. Circularising at periapsis is the mirror image: you are going too fast for a circle there, so the burn is retrograde. Either works; pick the apsis at the altitude you want to keep.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
    },
    {
      id: "judging-it",
      kind: "reading",
      title: "Judging the result",
      body:
        "Do not judge a circularisation by eccentricity — the number is small and hard to feel. Judge it by the gap between apoapsis and periapsis, in kilometres, against the tolerance you were given. If the gap is still large in one direction, you burned at the wrong point in the orbit rather than by the wrong amount. If it is small but stubborn, trim it with a second, much shorter burn at the new apsis instead of trying to fix it all in one go.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "gameplay-tuned",
    },
  ],
};
