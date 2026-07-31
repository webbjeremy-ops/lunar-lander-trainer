// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 9 — Thrust-to-weight ratio.
import type { LessonDefinition } from "../types";

export const LESSON_09_THRUST_TO_WEIGHT: LessonDefinition = {
  id: "lesson-09-thrust-to-weight",
  title: "Thrust-to-weight ratio",
  summary:
    "The hover throttle, what happens above and below it, and why the same throttle setting means something different every minute of the burn.",
  steps: [
    {
      id: "hover-condition",
      kind: "reading",
      title: "The hover condition",
      body:
        "Hover happens when thrust exactly equals weight: T = m·g. With a 15,000 kg vehicle and g = 1.62 m/s², that is 24.3 kN. The Apollo descent propulsion system produced 45,040 N at full throttle, so a heavy LM hovers at roughly 54 % throttle. Thrust-to-weight ratio (TWR) is simply T / (m·g): TWR = 1 is hover, TWR > 1 climbs or decelerates a descent, TWR < 1 means you are still going down faster every second.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "thrust-gravity-vectors",
    },
    {
      id: "above-below",
      kind: "reading",
      title: "Above and below the hover throttle",
      body:
        "Net vertical acceleration is a = T/m − g. At 70 % throttle on that same vehicle you get about +0.48 m/s² upward — a sink rate of 10 m/s is nulled in roughly 21 seconds. At 40 % you get about −0.42 m/s²: you are still descending and getting faster. The throttle is not an altitude control; it is an acceleration control, and altitude is its second integral. Anticipate by two integrations, not one.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "landing-energy",
    },
    {
      id: "throttle-band",
      kind: "reading",
      title: "The real engine could not throttle everywhere",
      body:
        "The Apollo descent engine was deep-throttleable, but not continuously across its whole range: it was operated at fixed full thrust or within a throttleable band of roughly 10 % to 65 % of rated thrust, with the region between about 65 % and 100 % avoided to protect the injector from erosion. The flight kernel models this band. That is why full-thrust braking and fine hover control feel like two distinct regimes.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
    },
    {
      id: "changing-mass",
      kind: "reading",
      title: "Mass falls away underneath you",
      body:
        "A descent burn throws away several thousand kilograms of propellant. As m drops, the same throttle setting produces more acceleration: a hover setting found at high gate will make you climb by low gate. Expect to walk the throttle down continuously through the approach. This is also why the last minute of a descent feels twitchy — the vehicle is at its lightest and most responsive exactly when precision matters most.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "mass-delta-v",
    },
  ],
};
