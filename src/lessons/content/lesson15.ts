// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 15 — Orbit is continuous free fall.
import type { LessonDefinition } from "../types";

export const LESSON_15_ORBIT_IS_FREE_FALL: LessonDefinition = {
  id: "lesson-15-orbit-is-free-fall",
  title: "Orbit is continuous free fall",
  summary:
    "Speed, altitude and curvature: what an orbit actually is, and what periapsis and apoapsis tell you about your trajectory right now.",
  steps: [
    {
      id: "free-fall",
      kind: "reading",
      title: "Falling and missing",
      body:
        "An orbiting vehicle is not held up by anything — it is falling, continuously, and missing the surface because it is also moving sideways fast enough that the ground curves away underneath it just as quickly as it drops. Circular orbital speed just above the lunar surface is about 1,680 m/s. Below that, your fall outruns the curvature and you intersect the ground; above it, you climb away.",
      sources: [{ id: "m4-0-kernel" }, { id: "nasa-sp-4029" }],
      classification: "source-derived",
      diagramId: "trajectory-curvature",
    },
    {
      id: "speed-vs-altitude",
      kind: "reading",
      title: "Speed and altitude trade against each other",
      body:
        "Specific orbital energy is ε = v²/2 − μ/r: kinetic plus potential, conserved while the engine is off. Go higher and you must go slower; come lower and you speed up. This is why 'slowing down to descend' works — removing speed lowers the far side of your orbit until it passes below the surface. Powered descent is, formally, an orbit whose periapsis has been driven underground and then flown out under thrust.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "apsides",
      kind: "reading",
      title: "Periapsis and apoapsis",
      body:
        "Periapsis is the lowest point of your orbit, apoapsis the highest. The flight kernel computes both live from your current position and velocity, so the readout is a prediction of where you are heading, not a description of where you are. A negative periapsis altitude means your current trajectory intersects the Moon — for a descent that is exactly what you want, and for an ascent it is the thing you must fix before the engine quits.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "orbit-apsides",
    },
    {
      id: "reading-the-panel",
      kind: "reading",
      title: "Using it in the cockpit",
      body:
        "During a descent, watch periapsis fall below the surface early and stay there — that confirms the braking burn is doing its job. During Free Flight, try raising apoapsis with a prograde burn and watch periapsis stay pinned where you burned. The orbital readout in the instrument panel is an educational visualization derived from the same state vector the physics integrates; the Apollo LM had no such display.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "educational-visualization",
      diagramId: "orbit-apsides",
    },
  ],
};
