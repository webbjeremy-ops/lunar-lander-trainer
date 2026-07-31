# Apollo 11 powered-descent workbook — source audit

Source id: `apollo11-powered-descent-technical-reconstruction-workbook-v1`
Artifact: *Apollo 11 Powered Descent — A Technical Reconstruction* (ENG), XLSX workbook.
Classification: **secondary-reconstruction**.

## What the workbook is

A single-author compilation with 22 sheets (Introduction, Contents, Landing Site
Selection, Pre-Mission Training, LM, DPS, RCS, ACA TTCA ROD, DSKY, AGC 1, AGC 2,
Luminary 099, DOI, PDI, P63, P64, P66, 12011202 alarm, MissionLog, Reference,
Glossary, Links). It mixes:

* NASA primary sources (mission reports, handbooks),
* Luminary program material,
* air-to-ground voice transcript,
* Computer Words telemetry (the workbook's own note states values "have each been
  derived from the Computer Words Telemetry Log; the data may deviate from
  official NASA records"),
* secondary literature,
* author inference and commentary.

It is therefore **not** treated as a primary source anywhere in this repository.

## Provenance contract

Every item imported into `src/content/apollo11PoweredDescentReference.ts` carries:

```ts
{ workbookSheet: string; workbookRow: number;
  classification: "source-derived-reconstruction" | "secondary-explanation" | "author-inference" }
```

Row numbers are 1-based worksheet rows in the `MissionLog` sheet (header row 4),
verified by reading the workbook directly.

## Imported datasets

### Phase anchors (`MissionLog`)

| anchor | GET | row | values |
| --- | --- | --- | --- |
| PDI / P63 ignition | 102:33:05 | 18 | 49,971 ft; 5,559.7 ft/s total |
| throttle-down | 102:39:31 | 130 | 22,984 ft |
| P64 approach | 102:41:31 | 185 | 7,129 ft; 124.9 ft/s descent |
| P66 takeover | 102:43:22 | 248 | 410 ft; 60.3 ft/s horizontal; 10 ft/s descent |
| contact | 102:45:40 | 329 | 10 ft computed; 2.7 ft/s horizontal; 0.2 ft/s descent |

All are labelled **RECONSTRUCTED FROM COMPUTER-WORDS TELEMETRY — NOT AN EXACT
PHYSICS INITIAL CONDITION**. They are used for timeline markers, reference
checkpoints, narration, scoring context, debrief comparison, and M4.2 lessons.
The simulation is **not** forced to pass through them.

### Curated procedural events (`MissionLog`)

17 events spanning P63 ignition (row 18) through ENG STOP (row 332), including
throttle-up, face-up yaw, landing-radar data good, V16 N68 Delta-H monitoring,
1201/1202 alarms, V57 radar acceptance, throttle-down, P64 transition,
landing-site assessment, ATT HOLD, P66 takeover, radar dropouts, low-level
propellant light, and contact. Each event is separately classified as
`transcript-derived`, `telemetry-derived`, or `explanatory`.

### Alarm teaching cards (`12011202 alarm`)

Narrative only: what 1201/1202 mean, cycle stealing, Executive overload, restart
and load shedding, crew/Mission Control response. Classified
`secondary-explanation`.

## Deliberately NOT imported

* The workbook's summarized **Verb/Noun dictionary**, in particular its
  descriptions of **N60, N61, N62, N63, N64**. These require verification against
  the pinned Luminary099 rope (`911e5c0`) or primary program documentation before
  any use.
* Any **rope-cadence claim** such as "READACCS every two seconds" or "SERVICER
  every two seconds". The pinned rope's own behaviour and the frozen M3.3E
  hardware-interface semantics remain authoritative.
* The `DESCRIPTION` column of `MissionLog` as technical fact. It is treated as
  secondary commentary; no causal or technical claim from it is promoted without
  independent corroboration.
* Everything else in the workbook (chapters 1–16 body text, Reference, Glossary,
  Links) — not imported in this pass.

Usable `MissionLog` columns: `GET`, `Voice Transcript`, `V-TOTAL`, `V-HORIZ`,
`ROD`, `ALT`, `Delta-H`, `LPD`, `Tgo`, `EVENT`, `prog`, `noun`, `verb`, `r1`,
`r2`, `r3`.

## Procedure and progression policy (unchanged)

* The playable sequence remains **V37E 63E → V16 N62 E → PRO**, still labelled
  **HISTORICALLY GROUNDED PROCEDURE BRIDGE**. No new claim is made that this is
  the exact Apollo 11 cockpit sequence.
* Players are never asked to type `V37E 64E` or `V37E 66E` in the Apollo
  11-inspired mission. P63 is selected by the player; P64 is entered by phase and
  guidance progression; P66 is entered through the ATT HOLD / ROD takeover
  interaction. Quick-training modes may offer direct program selection and must
  label it a training shortcut.
* M4.2 lessons teach the richer progression: P63 selection and preparation →
  ignition authorization → post-ignition descent display → Delta-H monitoring →
  landing-radar acceptance → alarm recognition → automatic P64 transition →
  landing-site assessment → ATT HOLD / ROD takeover → P66-style control.
* Authentic emulator output and educational overlays remain visually distinct.

## Isolation guarantees

`src/content/apollo11PoweredDescentReference.ts` is a leaf data module. It is
imported only by lesson content (`src/lessons/content/lesson07.ts`) and the
debrief UI (`src/ui/play/DebriefPanel.tsx`). It is not imported by:

* the M4.0/M4.1 flight mechanics or the 1D physics kernel,
* the AGC worker, monitor controller, or any hardware-interface path,
* the procedure engine.

No AGC-to-physics coupling was added. M4.1 flight mechanics, M3.3E, and the 1D
golden touchdown (`368_279_425 µs`) are untouched.

## Deliverables

* `src/content/apollo11PoweredDescentReference.ts`
* `src/content/__tests__/apollo11PoweredDescentReference.test.ts`
* `src/lessons/content/lesson07.ts` (M4.2 lesson, reading-only)
* Source-registry entry in `src/lessons/SourceRegistry.ts`
* Debrief comparison block in `src/ui/play/DebriefPanel.tsx`
* This audit.
