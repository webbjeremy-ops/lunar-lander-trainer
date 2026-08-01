# Tranquility

Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into
lunar orbit — in the browser, desktop-first.

Tranquility runs the **real** Apollo Guidance Computer: the Virtual AGC
(yaAGC) core compiled to WebAssembly, executing the original **Luminary 099**
rope, driven through an authentic DSKY.

## What's inside

- **Descent** (`/play`) — playable Apollo 11 powered descent with the real
  DSKY procedure (V37E 63E → V16 N62 E → PRO) and P66 manual takeover.
- **Ascent** (`/play/ascent`) — liftoff, staging, pitch program, cutoff and
  orbital insertion against Apollo 11 targets.
- **Learn** (`/learn`) — a four-track campaign: Flying on the Moon, Rocket
  Physics, the AGC, and Orbital Mechanics, with local progress.
- **AGC Lab** (`/sim`) — the unmediated emulator and DSKY.
- **Explore** (`/explore`) — read-only inspection, event-log export/import and
  deterministic replay.
- **Sources** (`/sources`) — every claim's provenance.

## Accuracy policy

Five labels are used everywhere: **Authentic AGC**, **Source-derived**,
**Historically grounded**, **Educational approximation**, **Gameplay tuned**.

**Physics firewall:** the AGC is emulated authentically but never controls the
browser vehicle. Flight dynamics come from the deterministic planar kernel in
`src/simulation/lunar2d/`; AGC output is diagnostic only.

## Development

```sh
bun install
bun run dev          # dev server
bunx vitest run      # unit + kernel tests
bun run build        # production Workers bundle
npx playwright test  # browser acceptance (requires a prior build)
```

## Licensing

Original source: GPL-3.0-or-later. Vendored webAGC: GPL-2.0-or-later.
See `LICENSE`, `docs/licensing.md` and `THIRD_PARTY_NOTICES.md`.
Not endorsed by or affiliated with NASA.

## Milestone documentation

`docs/` holds the per-milestone freeze records, ending with
`docs/M4_4_PRODUCT_RELEASE.md`.
