// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 10 — Horizontal velocity is the real landing problem.
import type { LessonDefinition } from "../types";

export const LESSON_10_HORIZONTAL_VELOCITY: LessonDefinition = {
  id: "lesson-10-horizontal-velocity",
  title: "Horizontal velocity is the real landing problem",
  summary:
    "You do not arrive at the Moon from above — you arrive from the side at orbital speed. Braking that speed, not losing altitude, is what the descent is for.",
  steps: [
    {
      id: "orbital-motion",
      kind: "reading",
      title: "You start sideways, not up",
      body:
        "Powered descent initiation happens from a low orbit with a horizontal speed of roughly 1,690 m/s and a descent rate near zero. Vertically you are barely moving; horizontally you are moving faster than a rifle bullet. The Moon's surface is not below you so much as ahead of you. Every landing is therefore a problem of cancelling horizontal velocity while managing the altitude that gravity keeps taking away.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "apollo11-powered-descent-technical-reconstruction-workbook-v1" }],
      classification: "historically-grounded",
      diagramId: "velocity-vectors",
    },
    {
      id: "braking",
      kind: "reading",
      title: "The braking phase does the heavy lifting",
      body:
        "During P63 the engine is held near full thrust with the vehicle pitched far back, so the thrust vector points mostly against the direction of travel. Most of the descent's delta-v is spent here, removing horizontal speed while altitude bleeds off slowly. Only when horizontal velocity is nearly gone does the vehicle pitch upright and the flight become a mostly vertical problem.",
      sources: [{ id: "apollo11-powered-descent-technical-reconstruction-workbook-v1" }, { id: "luminary099" }],
      classification: "historically-grounded",
      diagramId: "trajectory-curvature",
    },
    {
      id: "premature-vertical",
      kind: "reading",
      title: "Why going vertical too early wastes propellant",
      body:
        "If you pitch upright while still carrying hundreds of m/s of horizontal speed, the engine now spends most of its thrust holding you up against gravity instead of braking. Every second spent hovering costs about 1.62 m/s of delta-v purely to not fall — that is gravity loss, and it buys nothing. The efficient profile keeps thrust pointed against the velocity vector for as long as the terrain and the approach geometry allow, then transitions once.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "trajectory-curvature",
    },
    {
      id: "practical",
      kind: "reading",
      title: "The cockpit rule",
      body:
        "Watch the ratio of horizontal speed to altitude. If horizontal speed in m/s is much larger than altitude in metres, you are going to overshoot the landing zone; if it is much smaller, you are wasting propellant hovering short of it. The instrument panel shows both plus the downrange error, and the advisory guidance cue in Instructor mode is a gameplay-tuned aid, not an Apollo display.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "gameplay-tuned",
    },
  ],
};
