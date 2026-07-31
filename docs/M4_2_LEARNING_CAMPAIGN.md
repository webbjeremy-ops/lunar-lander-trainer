# M4.2 — Apollo Lunar-Flight Learning Campaign

Status: implemented on top of frozen M4.1. No change to M4.1 flight mechanics,
the procedure engine, M3.3E hardware-interface lab, or the AGC bootstrap work.

## What M4.2 adds

- **Four learning tracks** (`src/learning/tracks.ts`), curating existing and new
  lessons without altering any lesson content:
  1. Flying on the Moon
  2. Rocket Physics
  3. Apollo Guidance Computer (all original authentic-DSKY lessons, untouched)
  4. Orbital Mechanics
- **Nine new lessons** (`src/lessons/content/lesson08…lesson16.ts`): lunar
  gravity and weight vs mass, thrust-to-weight, horizontal velocity, the rocket
  equation, high gate to low gate, a scored terminal-descent challenge, PIPA and
  landing radar (frozen M3.3E synthetic lab fixture), orbit as free fall, and
  preparing for lunar liftoff.
- **Six interactive SVG diagrams** (`src/ui/learn/diagrams/index.tsx`): thrust vs
  gravity, velocity vectors, trajectory curvature, mass vs available delta-v,
  periapsis/apoapsis, and landing energy. Pure React + range inputs; no new
  visualization dependency.
- **Versioned local progress** (`src/learning/progress.ts`): completed lessons,
  best challenge score/grade, difficulties completed, unlocked missions, last
  activity. Reset / export / import in the sidebar panel. No login, no backend.
- **Lesson ⇄ game handoff** (`src/learning/handoff.ts`): a lesson launches a
  configured `/play` scenario through a query string; `/play` publishes the
  flight result into `sessionStorage`; `/learn` drains it, shows the player's
  real flight data, records the score, and acknowledges the challenge step.

## Provenance policy

Every step carries one of the project classifications: `authentic-emulator`,
`source-derived`, `historically-grounded`, `educational-visualization`,
`gameplay-tuned`, `approximation`. Every factual claim cites the existing
`SOURCE_REGISTRY`; the campaign test asserts that no lesson cites an
unregistered source and that no step is unlabelled. Diagram numbers are drawn
from `LunarMissionConstants.ts` and are labelled as educational visualizations.

## Determinism and isolation

- Progress reduction (`reduceProgress`) and both handoff codecs are pure and
  total. Corrupt, foreign-schema, wrong-version, or wrong-typed payloads are
  rejected; the app falls back to empty progress rather than throwing.
- Exports use sorted keys so the same state always serializes identically.
- One persistent AGC Worker: `/learn` and `/play` both use the shared
  `AgcSession`. No second worker is created.
- **No AGC-to-physics coupling.** The AGC still never commands the vehicle and
  the vehicle never writes to the AGC. The 1D golden touchdown
  (`368,279,425 µs`) and all M3.3E acceptance tests remain green.

## Acceptance

- Vitest: 622/622 pass, including `src/learning/__tests__/campaign.test.ts`
  (progress reduce/parse/round-trip, corrupt-input rejection, handoff codecs,
  track coverage and unlock rules, lesson labelling and challenge validity).
- Typecheck clean; production build clean.
- Playwright `tests/learning-campaign.spec.ts` (3/3): tracks render and progress
  survives reload, corrupt stored progress fails safely, and one complete
  learn → fly → debrief flow returns the result to the originating lesson.
- Existing lessons and their specs are unchanged and still pass.

## Accessibility

Track lists are `<nav>` landmarks with accessible names; every lesson button is
keyboard reachable with `aria-current` on the active lesson; the progress panel
uses labelled controls and a `role="status"` message; diagrams are operated by
native range inputs, so they work with keyboard and touch. Layout stays in a
single column below the `md` breakpoint.
