// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 16 — Prepare for lunar liftoff.
import type { LessonDefinition } from "../types";

export const LESSON_16_PREPARE_FOR_LIFTOFF: LessonDefinition = {
  id: "lesson-16-prepare-for-liftoff",
  title: "Prepare for lunar liftoff",
  summary:
    "Staging, the ascent delta-v budget, and the pitch-over concept that turns a vertical climb into an orbit.",
  steps: [
    {
      id: "staging",
      kind: "reading",
      title: "The descent stage becomes a launch pad",
      body:
        "The LM was two vehicles. At liftoff the ascent stage separated from the descent stage, which stayed on the surface and served as the launch platform. That is the single most valuable trick in the design: the ascent stage did not have to carry the descent tanks, the landing gear, or the big engine back up. Ascent stage mass at liftoff was around 4,900 kg against a descent-stage mass of roughly 10,000 kg left behind.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "mass-delta-v",
    },
    {
      id: "ascent-delta-v",
      kind: "reading",
      title: "Ascent delta-v",
      body:
        "Reaching a low lunar orbit from the surface costs roughly 1,850 m/s of delta-v, a little more than the descent because the climb also has to pay gravity losses on the way up. The ascent engine was a single fixed-thrust unit of about 15,569 N with a specific impulse near 311 s — no throttle, no restart margin to speak of, and no alternative. It either worked or the mission ended on the surface.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "apollo-11-mission-report" }],
      classification: "source-derived",
    },
    {
      id: "pitch-over",
      kind: "reading",
      title: "Pitch-over",
      body:
        "You do not fly straight up to orbit — going straight up only buys altitude, and altitude alone falls back. The ascent lifts nearly vertically for a few seconds to clear the surface, then pitches over so that thrust is increasingly horizontal, converting the burn into the orbital speed that keeps the vehicle falling around the Moon instead of into it. Pitch too early and you scrape terrain; pitch too late and you waste propellant fighting gravity.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "velocity-vectors",
    },
    {
      id: "check-orbit",
      kind: "reading",
      title: "What 'in orbit' actually means",
      body:
        "Engine cutoff is not the goal — a positive periapsis altitude is. The moment periapsis rises above the lunar surface you are in orbit and can coast. Everything after that is rendezvous, which the AGC also flew, and which is out of scope for this campaign. Ascent flying is available in Free Flight as a gameplay-tuned scenario, not as a reproduction of a specific Apollo ascent profile.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "gameplay-tuned",
      diagramId: "orbit-apsides",
    },
  ],
};
