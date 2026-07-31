// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 11 — Fuel and the rocket equation.
import type { LessonDefinition } from "../types";

export const LESSON_11_ROCKET_EQUATION: LessonDefinition = {
  id: "lesson-11-fuel-and-the-rocket-equation",
  title: "Fuel and the rocket equation",
  summary:
    "Mass ratio, specific impulse and delta-v — and the reason a correction made late costs far more than the same correction made early.",
  steps: [
    {
      id: "mass-ratio",
      kind: "reading",
      title: "Mass ratio is the currency",
      body:
        "A rocket does not have a range; it has a delta-v budget. Tsiolkovsky's equation says Δv = Isp · g₀ · ln(m₀ / m₁), where m₀ is the mass before the burn and m₁ the mass after. Only the ratio matters. Doubling your propellant does not double your delta-v — it adds one more natural logarithm's worth, which is a lot less than intuition suggests.",
      sources: [{ id: "m4-0-kernel" }],
      classification: "source-derived",
      diagramId: "mass-delta-v",
    },
    {
      id: "specific-impulse",
      kind: "reading",
      title: "Specific impulse",
      body:
        "Specific impulse is how much impulse you get per unit of propellant weight — effectively engine efficiency in seconds. The Apollo descent engine had a vacuum specific impulse of about 311 s, and the ascent engine about the same. With g₀ = 9.80665 m/s², that gives an effective exhaust velocity of roughly 3,050 m/s. Mass flow at full thrust is thrust divided by that exhaust velocity: about 14.8 kg/s.",
      sources: [{ id: "lm-familiarization-manual" }, { id: "m4-0-kernel" }],
      classification: "source-derived",
    },
    {
      id: "delta-v",
      kind: "reading",
      title: "The descent delta-v budget",
      body:
        "Powered descent from low lunar orbit to the surface costs roughly 2,000 m/s of delta-v, plus whatever you waste. The waste has two names: gravity loss (thrust spent holding altitude instead of changing velocity) and steering loss (thrust pointed away from the direction you actually need). Apollo 11 landed with about 25 seconds of usable propellant remaining — that margin was the entire mission's error budget.",
      sources: [{ id: "apollo-11-mission-report" }, { id: "apollo11-powered-descent-technical-reconstruction-workbook-v1" }],
      classification: "historically-grounded",
    },
    {
      id: "late-corrections",
      kind: "reading",
      title: "Why late corrections are expensive",
      body:
        "Early in the descent a small attitude change reshapes the whole trajectory: you are trading direction, and time does the work. Late in the descent the same redesignation must be bought outright with thrust, while simultaneously paying 1.62 m/s per second just to stay airborne. A 300 m redesignation at high gate is nearly free; the same 300 m at 30 m altitude can cost more propellant than the entire terminal descent. Decide early, commit, and fly it out.",
      sources: [{ id: "m4-0-kernel" }, { id: "apollo11-powered-descent-technical-reconstruction-workbook-v1" }],
      classification: "source-derived",
      diagramId: "mass-delta-v",
    },
  ],
};
