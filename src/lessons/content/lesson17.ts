// SPDX-License-Identifier: GPL-3.0-or-later
// M5.0 Lesson 17 — Reading an orbit.
import type { LessonDefinition } from "../types";

export const LESSON_17_READING_AN_ORBIT: LessonDefinition = {
  id: "lesson-17-reading-an-orbit",
  title: "Reading an orbit",
  summary:
    "Six numbers describe where you are and where you are going: radius, speed, radial and tangential velocity, periapsis and apoapsis.",
  steps: [
    {
      id: "two-speeds",
      kind: "reading",
      title: "One speed is really two",
      body:
        "An orbital instrument panel splits your velocity into two parts because they do completely different jobs. Tangential speed — motion across the local horizon — is what keeps you in orbit; it is the number that decides how far around the Moon you fall before you come back down. Radial speed — motion straight up or straight down — only trades altitude for time. A vehicle with a large radial speed is not necessarily in trouble, and a vehicle with zero radial speed is not necessarily safe. Read them separately, always.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "velocity-vectors",
    },
    {
      id: "apsides",
      kind: "reading",
      title: "Periapsis and apoapsis",
      body:
        "An unpowered orbit around the Moon is an ellipse, and an ellipse has exactly two interesting points: the low point (periapsis) and the high point (apoapsis). Nothing you do between them changes them — coasting is free and completely predictable. Both altitudes are computed from your current position and velocity alone, which is why the display can tell you the shape of an orbit you will not reach for another hour. Apollo 11's insertion orbit after ascent was about 9 by 45 nautical miles; the later phasing orbit was about 49 by 45.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "flight-path-angle",
      kind: "reading",
      title: "Flight-path angle tells you which way the ellipse is going",
      body:
        "Flight-path angle is the angle between your velocity and the local horizon. It is positive while you climb from periapsis toward apoapsis and negative on the way back down; it passes through exactly zero at both apsides. That zero is why manoeuvres are planned at an apsis — it is the only place where a purely prograde or retrograde burn changes just one end of the orbit and leaves the other alone.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
    },
    {
      id: "period",
      kind: "reading",
      title: "Period depends only on the size of the orbit",
      body:
        "The time to go once around depends on the semi-major axis and nothing else — not on eccentricity, not on where you are in the orbit, not on your mass. Two vehicles in orbits of the same size take exactly the same time to come back around even if one path is a circle and the other a long thin ellipse. That single fact is the whole basis of rendezvous phasing: to catch something ahead of you, you change your period, wait, and let geometry do the work.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
    },
  ],
};
