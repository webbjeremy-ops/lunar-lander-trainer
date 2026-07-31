// SPDX-License-Identifier: GPL-3.0-or-later
// Lesson 7 (M4.2) — The Apollo 11 powered descent, in order.
//
// Reading-only lesson built from the curated workbook content module.
// Every value shown is reconstructed telemetry, never a physics initial
// condition, and no AGC state is touched by this lesson.

import type { LessonDefinition, LessonStep } from "../types";
import {
  APOLLO11_ALARM_TEACHING,
  APOLLO11_DESCENT_PHASE_ANCHORS,
  APOLLO11_TEACHING_PROGRESSION,
  APOLLO11_WORKBOOK_SOURCE_ID,
  RECONSTRUCTION_DISCLAIMER,
  APOLLO11_DESCENT_TIMELINE,
} from "@/content/apollo11PoweredDescentReference";

const WORKBOOK = [{ id: APOLLO11_WORKBOOK_SOURCE_ID }];

const anchorLine = (): string =>
  APOLLO11_DESCENT_PHASE_ANCHORS.map((a) => {
    const bits = [
      a.altitudeFt !== undefined ? `${a.altitudeFt.toLocaleString()} ft` : null,
      a.totalVelocityFtPerSec !== undefined
        ? `${a.totalVelocityFtPerSec} ft/s total`
        : null,
      a.horizontalVelocityFtPerSec !== undefined
        ? `${a.horizontalVelocityFtPerSec} ft/s horizontal`
        : null,
      a.descentRateFtPerSec !== undefined
        ? `${a.descentRateFtPerSec} ft/s descent`
        : null,
    ].filter(Boolean);
    return `GET ${a.get} — ${a.label}: ${bits.join(", ")}.`;
  }).join(" ");

const progressionLine = (): string =>
  APOLLO11_TEACHING_PROGRESSION.map((p, i) => `${i + 1}. ${p.label} — ${p.detail}`).join(" ");

const alarmLine = (): string =>
  APOLLO11_ALARM_TEACHING.map((a) => `${a.title}: ${a.body}`).join(" ");

const eventsLine = (): string =>
  APOLLO11_DESCENT_TIMELINE.map(
    (e) => `GET ${e.get} — ${e.label} [${e.kind}]: ${e.teaching}`,
  ).join(" ");

const steps: LessonStep[] = [
  {
    id: "what-this-is",
    kind: "reading",
    title: "A reconstruction, not a flight tape",
    body: `The numbers in this lesson come from a secondary reconstruction workbook that merges NASA sources, transcript, and Computer Words telemetry. ${RECONSTRUCTION_DISCLAIMER}. The simulator's physics is never forced through these points — they are teaching markers and comparison targets only.`,
    sources: WORKBOOK,
    classification: "approximation",
  },
  {
    id: "phase-anchors",
    kind: "reading",
    title: "Five anchors of the descent",
    body: anchorLine(),
    sources: WORKBOOK,
    classification: "approximation",
  },
  {
    id: "progression",
    kind: "reading",
    title: "The historical progression",
    body: progressionLine(),
    sources: WORKBOOK,
    classification: "historically-grounded",
  },
  {
    id: "timeline",
    kind: "reading",
    title: "Event by event",
    body: eventsLine(),
    sources: WORKBOOK,
    classification: "approximation",
  },
  {
    id: "alarms",
    kind: "reading",
    title: "1201 and 1202",
    body: alarmLine(),
    sources: WORKBOOK,
    classification: "historically-grounded",
  },
  {
    id: "procedure-bridge",
    kind: "reading",
    title: "What the game asks you to type",
    body:
      "The playable mission uses V37E 63E, V16 N62 E, then PRO. That is a HISTORICALLY GROUNDED PROCEDURE BRIDGE — a teachable subset, not a claim that this was the exact Apollo 11 cockpit sequence. P64 is entered by guidance progression and P66 through the ATT HOLD / ROD takeover, exactly as they were in 1969; you are never asked to type V37E 64E or V37E 66E during the Apollo 11-inspired mission. Quick-training modes that let you jump directly to a program label it as a training shortcut. Authentic emulator output and educational overlays stay visually distinct throughout.",
    sources: [{ id: "luminary099" }, { id: APOLLO11_WORKBOOK_SOURCE_ID }],
    classification: "historically-grounded",
  },
  {
    id: "not-imported",
    kind: "reading",
    title: "What we deliberately did not import",
    body:
      "The workbook's summarized Verb/Noun dictionary — including its descriptions of N60, N61, N62, N63 and N64 — is not used anywhere in this simulator; those meanings must be verified against the pinned Luminary099 rope or primary program documentation first. Its statements about rope cadence are likewise not imported: the pinned rope's own behaviour is authoritative. Workbook DESCRIPTION text is treated as secondary commentary and never promoted to a technical claim.",
    sources: WORKBOOK,
    classification: "historically-grounded",
  },
];

export const LESSON_07_POWERED_DESCENT_TIMELINE: LessonDefinition = {
  id: "lesson-07-powered-descent-timeline",
  title: "Apollo 11 powered descent, in order",
  summary:
    "The braking, approach and landing phases as reconstructed from Computer Words telemetry and transcript — anchors, alarms, and the progression the mission teaches.",
  steps,
};
