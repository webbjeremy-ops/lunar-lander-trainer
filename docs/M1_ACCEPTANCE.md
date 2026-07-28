# Milestone 1 — Release Acceptance

Status: **PASS (conditional)** — all blocking checks green. Two non-blocking
gaps documented below and deferred to M2 UI work.

Audit performed against the **production build** served via
`wrangler dev -c dist/server/wrangler.json --port 4173` (the same
Cloudflare-Workers bundle a deploy would ship), unless a check is explicitly
labelled otherwise.

---

## 1. Automated verification

| Check | Command | Result |
| --- | --- | --- |
| Unit + integration tests | `bunx vitest run` | **23 / 23 passed** across 6 suites (MissionClock, checksum, determinism, AgcIoState, AgcChannelRegistry, AgcCoreAdapter) |
| Production build | `bun run build` | Succeeds; emits `dist/client/` (SPA + assets) and `dist/server/` (Workerd bundle, 22 modules, ~940 KiB) |
| Typecheck | included in build | Clean |

Deterministic-checksum test asserts that observable AGC state (mission time,
timing remainder, step count, erasable memory, channel map, lamps, mission
system state, PRNG state, event-log cursor) hashes identically across two
independent constructions and diverges when *any* observable field mutates.

## 2. Real-browser verification (production bundle @ :4173)

Automated via Playwright script (`/tmp/browser/m1/smoke.py`). Full log
retained for the audit trail.

### 2.1 Boot

- `/sim` served **HTTP 200**, hydrated, worker reached `ready`.
- Post-boot state after ~4 s: `MET = 4.46 s`, `steps = 380,546`, `scale = 1×`,
  `state = running`. Consistent with AGC running Luminary099 self-test.
- Channel 011 = `020000` and 0163 = `000020` observed pre-lamp-test (real
  emulator output, not synthetic).
- Zero `pageerror`, zero `console.error`, zero `requestfailed`.

### 2.2 Lamp test (`V 3 5 E`)

After keyboard entry `V-3-5-Enter`:

- Channel 0163 advanced through lamp-test phases; sample captured at
  `0163 = 000065`.
- Lamps folded from real channel bits:
  `UPLINK_ACTY = 1`, `AGC_WARN = 1`, `KEY_REL = 1`, `OPER_ERR = 1`,
  `RESTART = 1`. `TEMP`, `STBY`, `COMP_ACTY`, `EL_OFF` correctly remained 0
  during that phase (the lamp test walks lamps in groups; not all lit at the
  same instant, which is the historically-correct behavior).

### 2.3 MET display (`V 1 6 N 6 5 E`)

- Two reads 1.5 s apart yielded MET delta of **1,520,000 µs** at `scale = 1×`
  — matches wall clock to within one 20 ms scheduler tick.

### 2.4 Execution controls

- **PAUSE:** `state → paused`. Over a 5 s wait, `MET` frozen at
  `10,540,000 µs` and `steps` frozen at `899,317`. No drift.
- **STEP TICK:** exactly one 20 ms tick executed while paused:
  `MET 10,540,000 → 10,560,000 µs` (+20,000 µs); `steps 899,317 → 901,023`
  (+1,706 AGC sub-steps ≈ 20 ms at 11,720 ns per step).
- **RUN + RESET:** confirmed available and functional during the earlier
  boot phase (RUN is the default post-load state; RESET is unit-tested via
  the adapter suite and wired end-to-end through the protocol).

### 2.5 Snapshot rate

The `SnapshotCoalescer` is unit-tested to cap publishes at ≤ 25 Hz
(`minIntervalMs = 40`). Live DOM-poll counting is unreliable at that
granularity, so the coalescer contract is asserted at the unit-test layer.

## 3. Route and hosting verification

Direct `curl` against the built Workerd bundle:

| Path | Status | Notes |
| --- | --- | --- |
| `/` | 200 | Landing page |
| `/sim` | 200 | DSKY route (SSR shell + hydration) |
| `/about` | 200 | Independence disclaimer + licensing summary |
| `/sources` | 200 | Provenance page |
| `/agc/yaAGC.wasm` | 200, 132,617 bytes | Same-origin, matches vendored copy |
| `/ropes/Luminary099.bin` | 200, 73,728 bytes | Same-origin |
| `/ropes/Luminary099.manifest.json` | 200 | Contains `artifactProvenance.sha256` |

Runtime network capture during the full `/sim` session: **zero** requests to
`github.com` or `githubusercontent.com`. All assets served from the app's
own origin.

`404 → root` fallback: TanStack Start routes correctly under the Workerd
build; no `_redirects`/`netlify.toml`/`vercel.json` needed and none are
present.

## 4. Licensing and open-source verification

- Root `LICENSE`: **GPL-3.0-or-later** with the required warranty disclaimer
  and pointer to the full text.
- `LICENSES/GPL-2.0-or-later.txt`: preserved for the vendored webAGC/yaAGC
  subsystem, with upstream repo references and the yaAGC linking-exception
  note.
- `THIRD_PARTY_NOTICES.md`: independence disclaimer + component-level
  attribution.
- Every source file under `src/agc/**`, `src/sim/agc/**`, and
  `src/third-party/webagc/**` carries an SPDX header. Original code =
  `GPL-3.0-or-later`; webAGC-derived / upstream-adjacent files =
  `GPL-2.0-or-later` (see `docs/licensing.md` for the file-by-file
  classification table).
- `src/third-party/webagc/UPSTREAM.md` documents the pinned commit
  (`michaelfranzl/webAGC @ 0575ea7`).
- `public/ropes/Luminary099.manifest.json` pins the rope source to
  `chrislgarry/Apollo-11 @ 911e5c0` and records the artifact's
  SHA-256 (`1f5326e0…8f40e`, 73,728 bytes). Rebuild flow lives in
  `scripts/build-luminary099.sh` and is exercised by
  `.github/workflows/reproduce-rope.yml`.
- The `/about` route surfaces the independence disclaimer, the GPL-3.0 /
  GPL-2.0 split, and links to the GitHub source and the `/sources` page.

## 5. Determinism verification

- `stateChecksum()` (FNV-1a over canonical bytes) is stable across
  reconstructions of identical `ObservableAgcState` snapshots and changes
  under mutation of any observable field (10 mutation cases asserted).
- Channel map serialization is order-independent (sorted by channel
  number).
- JSON key order in the mission-system substate does not affect the
  checksum (keys sorted before hashing).
- Canonical byte layout is stable across runs (byte-for-byte equal).
- `MissionClock` is a pure function of `(wall-clock delta, time scale,
  pause state, previous remainder)`; unit-tested against fixed inputs.
- `EventLog` is seeded with a constant (`0xC0DE_A11E`) and uses a
  deterministic `seededRandom` PRNG for replay stability.

## 6. Known non-blocking gaps (deferred to M2)

1. **Time-scale UI controls.** The `setTimeScale` command is implemented,
   typed in the protocol, and used by `MissionClock`, but no slider/button
   is exposed in the current DSKY UI. Manual QA of `10×` playback is
   therefore not yet click-through reachable from `/sim`. Contract is unit-
   tested; the UI control is a straightforward M2 addition.
2. **Full seven-segment register decode.** M1 exposes raw channel words
   (010–015, 032, 0163) and the folded lamp bits. Row-multiplexed digit
   decoding into DSKY register glyphs is scheduled for M2 per the plan
   ("Authentic DSKY output ONLY — no manufactured display").

Neither gap violates an M1 acceptance criterion; both are called out here
so they are not lost.

## 7. How to reproduce this audit

```bash
bun install
bun run build
bunx wrangler dev -c dist/server/wrangler.json --port 4173 --ip 127.0.0.1 &
bunx vitest run
python3 /tmp/browser/m1/smoke.py   # Playwright smoke against :4173
```

The rope-reproduction workflow (`.github/workflows/reproduce-rope.yml`)
runs `scripts/build-luminary099.sh` on a clean Ubuntu runner and uploads
the built `Luminary099.bin` plus a diff report as an artifact. Manifest
`reproduction` block will be updated in place once a byte-identical
rebuild is confirmed; per the manifest's own instructions, values are
**never** fabricated.

---

**Conclusion:** Milestone 1 acceptance criteria are met on the production
build. Ready to proceed to Milestone 2 (mission director + guidance scope
per the locked M1 decisions).
