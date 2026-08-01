// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.3 — Teaching notes for the lunar-ascent game.
//
// Plain data so the cockpit, the debrief and the docs all say the same thing.
// Every claim here is either physics or an explicitly labelled game rule.

export interface TeachingNote {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export const ASCENT_TEACHING_NOTES: readonly TeachingNote[] = [
  {
    id: "why-pitch-over",
    question: "Why does pitching over build an orbit rather than just altitude?",
    answer:
      "Orbit is sideways speed, not height. Thrusting straight up buys altitude " +
      "that gravity immediately starts taking back. Tipping the thrust axis over " +
      "spends most of the engine on horizontal speed, and once that speed is high " +
      "enough the surface curves away as fast as the vehicle falls.",
  },
  {
    id: "high-apoapsis-low-periapsis",
    question: "Why can a high apoapsis still end in impact?",
    answer:
      "An orbit is a closed curve. If the low point of that curve lies inside the " +
      "Moon, the vehicle reaches the far side of the ellipse and comes straight " +
      "back down half a revolution later, however high the top was.",
  },
  {
    id: "cutoff-timing",
    question: "How does cutoff timing change the orbit?",
    answer:
      "The point where the engine stops becomes a point on the final orbit. Cut " +
      "off while still climbing and that point sits below the eventual low point; " +
      "cut off with the radial rate near zero and the cutoff altitude becomes the " +
      "periapsis. Burning longer raises the opposite side of the orbit.",
  },
  {
    id: "mass-loss",
    question: "Why does acceleration keep rising during the burn?",
    answer:
      "The ascent engine is not throttleable: thrust is constant. Propellant mass " +
      "leaves the vehicle every second, so the same force acts on less mass and " +
      "the acceleration climbs steadily toward cutoff.",
  },
  {
    id: "delta-v",
    question: "How is delta-v different from fuel quantity?",
    answer:
      "Delta-v is the speed change kilograms of propellant can buy, and it depends " +
      "on how much mass is being pushed: delta-v = Isp x g0 x ln(m_start / m_end). " +
      "The same 100 kg is worth far less at liftoff than it is a minute before " +
      "cutoff.",
  },
  {
    id: "phasing",
    question: "What is phasing for?",
    answer:
      "After insertion the ascent stage is in a lower, faster orbit than the " +
      "command module. A phasing burn adjusts the orbit so the two vehicles arrive " +
      "at the same place at the same time. M4.3 stops at phasing: rendezvous and " +
      "docking are out of scope.",
  },
];
