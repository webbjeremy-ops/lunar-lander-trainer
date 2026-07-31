// SPDX-License-Identifier: GPL-3.0-or-later
// M4.2 Lesson 14 — PIPA and landing radar (M3.3E synthetic lab).
import type { LessonDefinition } from "../types";

export const LESSON_14_PIPA_AND_LANDING_RADAR: LessonDefinition = {
  id: "lesson-14-pipa-and-landing-radar",
  title: "PIPA and landing radar",
  summary:
    "How acceleration and altitude physically reach the AGC — pulse by pulse — and the difference between hardware delivery and rope consumption.",
  steps: [
    {
      id: "pipa",
      kind: "reading",
      title: "PIPA: acceleration arrives as pulses",
      body:
        "The Pulsed Integrating Pendulous Accelerometers do not report acceleration; they report velocity increments. Each pulse corresponds to 1 cm/s of sensed velocity change along one IMU axis, delivered to the AGC as PINC (positive) or MINC (negative) counter increments on the accelerometer counter registers. Software integrates a count, not a signal. The simulator drives these through the real emulator's hardware counter-increment path, using the same increment primitive the physical hardware used.",
      sources: [{ id: "block-ii-agc-r-393" }, { id: "m3-3e-hardware-lab" }],
      classification: "source-derived",
    },
    {
      id: "landing-radar",
      kind: "reading",
      title: "Landing radar answers a request",
      body:
        "The landing radar is not a stream. The rope raises a request through Channel 13, the radar answers, and the answer arrives as a RADARUPT interrupt with the reading in the RNRAD register. Altitude is quantised: one bit is roughly 1.079 ft on the high-altitude scale. Our lab implements this as a two-phase transaction — observe the request, prepare the reading, attempt the hardware write, and only then commit — so a rejected write can never be silently retried into a duplicated reading.",
      sources: [{ id: "yaDSKY2-ddc65e7b" }, { id: "m3-3e-hardware-lab" }],
      classification: "source-derived",
    },
    {
      id: "delivery-vs-consumption",
      kind: "reading",
      title: "Delivery is not consumption",
      body:
        "This distinction matters more than anything else on this page. We can prove that pulses and radar readings are delivered into authentic AGC hardware registers. Whether the rope consumes them depends on the flight program state: Luminary's READACCS path only reads the accelerometer counters when the average-G routine is running, which requires a full powered-descent bootstrap that this project has deliberately not attempted. So: hardware delivery — proven, against real WASM. Rope consumption during descent — not claimed.",
      sources: [{ id: "luminary099" }, { id: "m3-3e-hardware-lab" }],
      classification: "source-derived",
    },
    {
      id: "synthetic-fixture",
      kind: "reading",
      title: "This is a synthetic laboratory fixture",
      body:
        "The Hardware Interface Lab is clearly labelled synthetic. Its accelerations come from the game's own scenario engine, not from a flight tape, and its attitude reference is a fixed test bootstrap rather than a flown REFSMMAT. It exists to demonstrate the interface, not to reproduce Apollo 11 telemetry. Critically, it is one-directional: the lab writes into the AGC and never reads AGC output back into the physics. Turning the lab on or off produces bit-identical flight results — that invariant is enforced by test.",
      sources: [{ id: "m3-3e-hardware-lab" }],
      classification: "educational-visualization",
    },
  ],
};
