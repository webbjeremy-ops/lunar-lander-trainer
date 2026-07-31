// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 12 — High gate to low gate.
import type { LessonDefinition } from "../types";
import { APOLLO11_DESCENT_PHASE_ANCHORS, APOLLO11_WORKBOOK_SOURCE_ID } from "@/content/apollo11PoweredDescentReference";

const anchors = APOLLO11_DESCENT_PHASE_ANCHORS.map((a) => {
  const alt = a.altitudeFt !== undefined ? `${a.altitudeFt.toLocaleString()} ft` : "—";
  return `${a.label} (GET ${a.get}, ${alt})`;
}).join("; ");

export const LESSON_12_HIGH_GATE_TO_LOW_GATE: LessonDefinition = {
  id: "lesson-12-high-gate-to-low-gate",
  title: "High gate to low gate",
  summary:
    "The three phases of a powered descent — braking, approach and terminal descent — and the Apollo 11 landmarks that separate them.",
  steps: [
    {
      id: "braking-phase",
      kind: "reading",
      title: "Braking phase (P63)",
      body:
        "The braking phase begins at powered descent initiation and runs to high gate. Its only job is efficiency: hold the engine near maximum thrust, keep it pointed against the velocity vector, and remove the bulk of the orbital horizontal speed. The crew cannot see the landing site during most of this phase — the vehicle is pitched back with the windows facing away from the surface.",
      sources: [{ id: "luminary099" }, { id: APOLLO11_WORKBOOK_SOURCE_ID }],
      classification: "historically-grounded",
      diagramId: "trajectory-curvature",
    },
    {
      id: "high-gate",
      kind: "reading",
      title: "High gate and the approach phase (P64)",
      body:
        "High gate is the handover point, at roughly 7,000 ft altitude and about 5 nautical miles out. The vehicle pitches more upright, the landing site comes into the window, and P64 flies a visibility-constrained approach that lets the commander evaluate the terrain and redesignate the aim point. Efficiency is deliberately traded for situational awareness here.",
      sources: [{ id: "luminary099" }, { id: APOLLO11_WORKBOOK_SOURCE_ID }],
      classification: "historically-grounded",
    },
    {
      id: "low-gate",
      kind: "reading",
      title: "Low gate and terminal descent (P66)",
      body:
        "Low gate is around 500 ft, where the approach becomes a landing. On Apollo 11 Armstrong took semi-manual control through the rate-of-descent mode: attitude flown by hand, sink rate trimmed in 1 ft/s increments by the ROD switch while the computer held that rate. From here the task is nulling lateral drift and setting the vehicle down inside the gear limits before the propellant runs out.",
      sources: [{ id: "luminary099" }, { id: APOLLO11_WORKBOOK_SOURCE_ID }],
      classification: "historically-grounded",
      diagramId: "landing-energy",
    },
    {
      id: "apollo11-landmarks",
      kind: "reading",
      title: "The Apollo 11 landmarks",
      body: `Reconstructed anchors for the actual flight: ${anchors}. These come from a secondary reconstruction of Computer Words telemetry and the air-to-ground transcript. They are teaching markers and debrief comparison targets — the simulator's physics is never forced through them.`,
      sources: [{ id: APOLLO11_WORKBOOK_SOURCE_ID }],
      classification: "educational-visualization",
    },
  ],
};
