// SPDX-License-Identifier: GPL-3.0-or-later
// M5.0 Lesson 20 — Phasing and intercept setup.
import type { LessonDefinition } from "../types";

export const LESSON_20_PHASING_AND_INTERCEPT: LessonDefinition = {
  id: "lesson-20-phasing-and-intercept",
  title: "Catching the Command Module",
  summary:
    "Phase angle, why a lower orbit catches up, and what a good intercept setup looks like before terminal rendezvous begins.",
  steps: [
    {
      id: "phase-angle",
      kind: "reading",
      title: "You cannot steer toward it",
      body:
        "The one instinct to unlearn: pointing at the Command Module and thrusting does not bring you to it. Rendezvous is not pursuit. What separates you is a phase angle — the angle at the centre of the Moon between the two vehicles — and the only way to change a phase angle is to change how fast you go around, which means changing your orbital period, which means changing the size of your orbit.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "lower-is-faster",
      kind: "reading",
      title: "Lower is faster, in the only sense that matters",
      body:
        "A smaller orbit has a shorter period, so a vehicle in it completes more revolutions in the same time and gains angle on anything above it. If the target is ahead of you, drop below it and wait; if it is behind you, climb above it and let it come. The burn that seems to slow you down — retrograde, lowering the far side of your orbit — is the one that makes you catch up. Apollo's LM used exactly this, going from an insertion orbit near 9 by 45 nautical miles to a phasing orbit near 49 by 45.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
    },
    {
      id: "planner",
      kind: "reading",
      title: "What the phasing planner is doing",
      body:
        "The planner searches a bounded grid of delta-v magnitudes and whole revolution counts, propagates each candidate, and reports the one whose predicted range at the meeting point is smallest — along with a confidence label. It is a deterministic search over an educational two-body model, not the Apollo rendezvous targeting programs, and it is labelled that way wherever it appears. Treat its answer as a starting point that you then trim.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "educational-visualization",
    },
    {
      id: "where-this-stops",
      kind: "reading",
      title: "Where this exercise stops",
      body:
        "A good setup means small range at closest approach and a low closing rate — you arrive near the Command Module slowly, with propellant left and a safe periapsis behind you. That is where this campaign ends: INTERCEPT SETUP COMPLETE. Braking, station-keeping and docking are a different discipline with different instruments, and this simulation does not pretend to model them yet.",
      sources: [{ id: "apollo-11-mission-report" }],
      classification: "gameplay-tuned",
      challenge: {
        missionId: "phasing-burn-trainer",
        assistance: "instructor",
        controlMode: "maneuver-planner",
        passingScore: 60,
        route: "/play",
      },
    },
  ],
};
