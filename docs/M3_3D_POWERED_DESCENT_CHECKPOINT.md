# M3.3D — Apollo 11 digital-simulation checkpoint recovery

**Status: HALTED at Gate 1 (mandatory unresolved-artifact stop).**
**No runtime, Worker, emulator, profile or manifest changes were made.**

This document records an exhaustive search for a machine-readable Apollo-era
saved checkpoint at `367700`, and a primary-source finding that **materially
corrects the research premise this milestone was issued under**.

---

## 1. Headline finding — the premise is refuted by the source

The milestone brief states that the 1969 run *resumes* from an opaque saved
state:

> `LAST SNAP 367700` … "It does not begin from a cold Luminary start."

The scanned printout says the opposite. `LAST SNAP` is a **running page-header
field reporting the most recent snapshot the run has itself written**, not an
input the run was restored from.

Evidence, read from the page text of
`archive.org/details/apollo11landingd00miti_0` (1969, MIT Instrumentation
Laboratory, `LMY99`):

| Page region | Header text |
| --- | --- |
| Run start, initialization decks, memory dumps (pages ~1–24) | `NEW SIMULATION  MARSROT 20414415 /EYLES /DUPLICATE LANDING  LAST SNAP NONE` |
| Body of run | `SNAPSHOT 367700  SECONDS RUNNING 367700.000600` |
| Immediately after | `… /DUPLICATE LANDING  LAST SNAP 367700` |
| Later | `SNAPSHOT 367750`, `SNAPSHOT 367850`, `SNAPSHOT 367900` → headers follow to `LAST SNAP 367750 / 367850 / 367900` |

So:

1. The run is labelled `NEW SIMULATION` and carries `LAST SNAP **NONE**`
   through its entire initialization section.
2. `367700` is the **first of a periodic series** of snapshots the simulator
   *emits* every 50 s of `SECONDS RUNNING`, immediately followed by `367750`,
   `367850`, `367900`.
3. `LAST SNAP <n>` therefore tracks the emitted series, and its value changes
   several times within the one printout.

The 1971 companion item (`archive.org/details/dianarev12level302eyle`, Don
Eyles, DIANA rev 12, rope identity `AP11ROPE` — *not* `LMY99`) independently
reproduces the same pattern: `NEW SIMULATION … LAST SNAP NONE`, then
`SNAPSHOT 367700  SECONDS RUNNING 367700.000600`, then `367801`, `367900`.
Two independent runs of different vintage emitting a first snapshot at the
same `367700` is consistent with a scheduled snapshot start, not with a shared
inherited state.

Corroborating: the 1969 run's `SPECIAL REQUESTS` card deck contains a request
card of the form `SNAP1  START +367700`, i.e. **`367700` is the scheduled
snapshot start time supplied as run configuration.**

### Consequence

**There is no prior saved checkpoint to recover.** The artifact the brief asks
for does not exist as a prerequisite of this run, because this run did not
consume one. Gate 1's "acceptable artifact" condition cannot be satisfied by
locating a lost file; the premise itself does not hold.

The initialization that *does* exist in the printout is a set of printed input
decks — `ERASABLE BLK2 INPUT DATA`, `LEM DATA CARDS`, `PRELAUNCH` environment
constants, IMU compensation terms (`ADIAX/ADIAY`, `ASDIA`, `ASDSA`, bias/scale
factor cards) and a printed `REFSMMAT`. These are **decoded printed values**,
which the brief explicitly rules inadmissible as checkpoint data, and which
survive only as heavily corrupted OCR (`2.7COOCOCOOOO`, `-1.72965789753`
mis-segmented across columns). They are validation targets, not a restorable
image.

---

## 2. Gate 1 — locations searched

Machine-readable artifact sought: raw `367700` snapshot, raw MARSROT tape data,
complete 2048-word pre-P63 erasable image, or CPU/interrupt/timer/Executive
state.

| Location | Method | Result |
| --- | --- | --- |
| `archive.org/details/apollo11landingd00miti_0` (1969) | full `/metadata/` file manifest, all 21 files enumerated with format, size, source flag | **No binary.** Only `original`: page-image tars/JP2, `scandata.xml`, `meta.xml`, MARC source. All else `derivative` (PDF, DjVu, hOCR, ABBYY, DAISY). No tape, dump or checkpoint file. |
| `archive.org/details/dianarev12level302eyle` (1971) | same, all 20 files enumerated | **No binary.** Identical derivative-only profile. |
| Both items' original-resolution originals not exposed by the PDF link (`*_orig_jp2.tar`, 816 MB / 487 MB) | manifest inspection | Page images only, by format declaration. |
| Archive derivative manifests / metadata | `_files.xml`, `_meta.xml`, `_metasource.xml` | No companion data-file references. |
| Full run text, both items | direct search of DjVu text + hOCR search text for `SNAP`, `MARSROT`, `367700`, `REFSMMAT`, `AVEGFLAG`, `PIPTIME`, `BLK2` | Located the header/snapshot evidence in §1. No pointer to an external machine-readable companion. |
| Printed MARSROT tape identifiers | visual/text extraction | 1969: `MARSROT 20414415`; 1971: `MARSROT 05301382`. Tape numbers only — no digitized tape located under either identifier. |
| Virtual AGC document library (`links2.html`), Luminary page, `ScansForConversion` | search | Scans and listings only; no simulation checkpoint artifacts. |
| `virtualagc/virtualagc` repository, `Luminary099/` tree | directory listing | Source, `.binsource` ropes (`Luminary099.binsource`, `AP11ROPE.binsource`), build files. No erasable images, no snapshots. |
| GitHub code search for `MARSROT` | API | Unauthenticated API rejected; no candidate surfaced via web search either. |
| Web search: Eyles collection, `doneyles.com`, NASSP scenario archives, historical import tooling | search | Narrative and documentation only. No checkpoint artifact. |

### Provenance of what *was* recovered (documents, not checkpoints)

| Item | File | Size | MD5 | SHA-1 |
| --- | --- | --- | --- | --- |
| 1969 `LMY99` | `apollo11landingd00miti_0.pdf` | 45,137,722 | `0a943bf467d790e9a78cb14dce4c7c06` | `e7eeec7a5c0f7ed706d7520201e374625a4407c5` |
| 1969 text | `apollo11landingd00miti_0_djvu.txt` | 2,514,990 | `1f35095c95df923f2cd4b76d3334a850` | `870b9e5491680abce78078d1915cf6b8fa88c769` |
| 1971 `AP11ROPE` | `dianarev12level302eyle.pdf` | 31,633,805 | `05e19191e8cee6cdcbfcf3740d50a6c6` | `43830b39404a1e3e02be5b3752b57b0198ad935b` |
| 1971 text | `dianarev12level302eyle_djvu.txt` | 2,233,802 | `44c5699fe0eb2d4d6d77c61276b2ef30` | `68390d501b9419b4c66c385030393d207ce188ae` |

Licence: the 1971 item is marked CC0 / Public Domain Mark 1.0. The 1969 item
carries no explicit licence statement in its metadata.

Both are **derived page scans and OCR**. Neither is raw or contains simulator
state, AGC erasable memory, CPU/register/timer/interrupt state, or Executive
and WAITLIST state. Checkpoint time as printed: `367700` (`SECONDS RUNNING`).
Software identity: 1969 = `LMY99`; 1971 = `AP11ROPE` (**not** Luminary099 —
fails the Gate 2 compatibility requirement outright).

---

## 3. Gates 2–12 — not entered

Per the mandatory stop condition, and reinforced by §1:

* No `Apollo11DigitalSimulationCheckpointV1` descriptor created.
* No HW-I/O v5 checkpoint-restore facility designed or built. **HW-I/O v4
  remains canonical and byte-unchanged** (`2e7c28ec…`).
* No symbolic powered-descent manifest created.
* No Worker modification. PIPA encoder and Channel 13 decoder remain pure and
  unwired.
* No profile activated. `landing-radar-observer-v1` stays inactive;
  `descent-monitor-v1` stays blocked.
* No DSKY sequence transcribed for replay, no `AVEGFLAG` / Executive /
  WAITLIST authorship of any kind.
* No closed-loop AGC control. No P27 uplink. No LR velocity beams.

The existing synthetic 22-word IMU/REFSMMAT bootstrap is untouched and remains
confined to isolated bootstrap tests under its own scenario identity.

---

## 4. Smallest requested archival item

To unblock, the minimum acquisition is **not** the `367700` snapshot — §1
shows that snapshot was an *output*. The minimum useful items, in priority
order:

1. **The MARSROT tape data itself** for tape `20414415` (1969, `/EYLES
   /DUPLICATE LANDING`, run `LRRADAR2 · ENVCNTRL`, 07/23/69 14:43) — i.e. the
   written snapshot series `367700 / 367750 / 367850 / 367900`, in raw form,
   with its record format documented.
2. Failing that, **the original punched-card input deck** for that run:
   `ERASABLE BLK2 INPUT DATA`, `LEM DATA CARDS`, `PRELAUNCH` and
   `SPECIAL REQUESTS`, in machine-readable form rather than as a page scan.
3. Failing that, **original-resolution page images of the initialization
   section only** (the ~24 pages preceding the first `SNAPSHOT 367700`) at a
   resolution sufficient for reliable digit-level transcription — which would
   still only yield validation targets, not an admissible checkpoint.

Note that item 1 would restore a state at `t = 367700`, which is *after* the
initialization the milestone actually needs, and would require the MIT
simulator's own restore semantics to be documented before it could be used.

---

## 5. Verification (unchanged, as required)

| Check | Result |
| --- | --- |
| Vitest | **495 / 495 passed**, 49 files, **0 skipped** |
| Typecheck (`tsgo --noEmit`) | clean |
| Canonical WASM | HW-I/O v4, `2e7c28ec75be794da991c49a5842ba3db6140f8936892f1c84f25883040a6abc`, unmodified |
| Physics firewall | unchanged |
| Golden touchdown | `368,279,425 µs`, still asserted |
| Closed-loop AGC control | prohibited and absent |

**M3.3C cannot be frozen.** M3.3D is blocked on external archival acquisition,
and its original premise requires the correction recorded in §1.
