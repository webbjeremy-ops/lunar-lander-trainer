# M4.4 — Tranquility product release candidate

Productization pass over frozen M4.3. No physics, procedure-engine, AGC
bootstrap or historical-research changes were made in this milestone.

## Product structure

"Tranquility: Learn the Apollo Guidance Computer, fly a lunar landing, and
launch back into lunar orbit."

Primary navigation (`src/ui/shell/AppNav.tsx`): Home, Missions, Learn,
AGC Lab (`/sim`), Explore, Sources, About. Developer harnesses
(`/dev/mission-runtime`, `/dev/lm-physics`) moved to the footer.

- Home (`src/routes/index.tsx`): product promise, five pillars (Descent,
  Ascent, Learn, DSKY, Explore) and the accuracy legend.
- Missions (`src/routes/missions.tsx`): single hub for descent and ascent.
- About (`src/routes/about.tsx`): accuracy policy and the physics firewall.

## Accuracy legend

Authentic AGC · Source-derived · Historically grounded · Educational
approximation · Gameplay tuned (`src/ui/shell/AccuracyLegend.tsx`). Every
mission and lesson surface reuses these five tiers.

## Onboarding

`src/onboarding/onboarding.ts` (pure reducer) + `src/ui/shell/Onboarding.tsx`.
Four steps — intent, assistance, controls, launch — versioned in
localStorage (`agc-tranquility:onboarding:v1`), skippable, keyboard operable.
The chosen assistance level is written into product settings.

## Settings

`src/settings/settings.ts` — schema `agc-tranquility.settings` v2, safe
forward migration from v1, total coercion (corrupt/hostile payloads fall back
to defaults, never throw). Covers audio (master volume, SFX), accessibility
(reduced motion, high contrast), units (metric / Apollo), controls
(sensitivity, keyboard map, touch size) and default assistance.
`src/settings/units.ts` converts SI to Apollo-style ft / fps / nmi / lb for
presentation only — the kernels remain SI.
`/settings` also exports, imports and resets local progress.

## Reliability

- `src/ui/shell/Reliability.tsx`: `RouteErrorBoundary` / `RecoverableError`
  on both cockpits and the root error component; `AgcBootBanner` for worker
  boot failure with retry.
- Both flight loops pause on `visibilitychange` so a hidden tab never
  fast-forwards the simulation.
- `src/ui/shell/trajectoryHistory.ts`: bounded ring buffer with decimation
  keeps trajectory trails at a fixed memory and draw cost.

## Accessibility

Skip-to-content link, visible focus rings on every control, `reduced-motion`
and `high-contrast` classes mirrored onto `<html>` with matching rules in
`src/styles.css`, responsive layouts plus a portrait orientation hint on the
cockpits.

## Acceptance

- Typecheck: clean. Production build (Cloudflare Workers bundle): clean.
- Vitest: 670 / 670 pass (649 pre-existing + 21 new product tests in
  `src/settings/__tests__/product.test.ts`).
- Playwright: 45 specs against the real production bundle;
  `tests/product.spec.ts` (8 / 8) covers navigation, onboarding, settings
  persistence, Apollo units in the cockpit, reset status, skip link and
  hidden-tab pause.
- Physics firewall unchanged: the 1D golden touchdown remains
  `368_279_425 µs` and no AGC output is coupled to vehicle state.

## Known issue

`tests/learn.spec.ts › complete /learn acceptance — Lessons 1-4 with real AGC`
intermittently times out waiting for the lesson attempt barrier
(`__learnTest`) under the full-suite run. It is a long real-AGC test and is
unrelated to the product shell; the lesson engine's own Vitest coverage
passes.
