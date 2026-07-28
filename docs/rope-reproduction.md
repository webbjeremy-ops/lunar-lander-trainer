# Reproducible rope build

This document describes how to rebuild `Luminary099.bin` from the pinned
source and toolchain, and how to record the result in the manifest.

## Pinned inputs

- Source: https://github.com/chrislgarry/Apollo-11 @ `911e5c0283c629c50cb97666f34065e8c07d71a5`
- Build tool: https://github.com/virtualagc/virtualagc @ `b6d27dc645fdc1ac75a3f825fea1d81e06729cc3`
- Program: `Luminary099`
- Tool: `yaYUL`

## Local build

```bash
bash scripts/build-luminary099.sh
```

The script:

1. Clones the two repositories at the pinned commits into an out-of-tree
   working directory (default: `/tmp/agc-rope-build`).
2. Builds `yaYUL` from the Virtual AGC tree.
3. Runs `yaYUL` on `Luminary099/MAIN.agc` to produce a rope binary.
4. Prints the SHA-256 and byte length of the produced binary.
5. Compares against `public/ropes/Luminary099.bin` and prints a status line:
   `REPRODUCIBLE`, `MISMATCH`, or `MISSING`.

The script never overwrites `public/ropes/Luminary099.bin`. It never rewrites
the manifest. Both are human review steps once a byte-identical build is
confirmed.

## Interpreting the report

- `REPRODUCIBLE` — the freshly built binary matches the committed binary
  byte-for-byte. Update `public/ropes/Luminary099.manifest.json`:
  - `reproduction.status`: `"reproduced-byte-identical"`
  - `reproduction.reproducedSha256`: the measured digest
  - `reproduction.reproducedByteLength`: the measured length
  - `reproduction.byteIdentical`: `true`
  - `reproduction.reportUrl`: link to the CI run (or a local report path)
- `MISMATCH` — the build produced a different binary. Do NOT change any
  provenance fields. Open an issue, investigate whether upstream source drift
  or toolchain drift is responsible, and record the finding in
  `reproduction.notes`.
- `MISSING` — the committed binary is not present; something is wrong with
  the checkout.

## Never invent values

Manifest fields that describe a reproduction that has not yet happened must
stay `null`. `artifactProvenance.buildCommand` and `artifactProvenance.generatedAt`
stay `null` until a byte-identical rebuild is confirmed.

## CI

`.github/workflows/reproduce-rope.yml` runs the same script and uploads the
built binary plus a comparison report as workflow artifacts. It is
informational — a first-run mismatch does not fail the workflow, so
provenance research remains a human review step.
