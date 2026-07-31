#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# M3.3D Gate 1 — reproducible acquisition of the primary-source page images for
# the 1969 MIT Instrumentation Laboratory "Apollo 11 Landing Digital Simulation"
# run (Internet Archive item apollo11landingd00miti_0, LMY99 AGC 001,
# MARSROT 20414415, /EYLES /DUPLICATE LANDING).
#
# The page images are NOT stored in this repository. Only the derived
# transcription (src/simulation/apollo11Deck/deck1969.transcribed.json) and the
# page manifest with SHA-256 hashes (deck1969.pageManifest.json) are retained.
# Run this script to re-acquire the exact bytes the transcription was made from
# and verify the hashes.
#
# Usage:  bash scripts/acquire-apollo11-deck-pages.sh [outdir]
# Default outdir: /tmp/apollo11-deck-pages

set -euo pipefail

ITEM="apollo11landingd00miti_0"
OUT="${1:-/tmp/apollo11-deck-pages}"
MANIFEST="$(dirname "$0")/../src/simulation/apollo11Deck/deck1969.pageManifest.json"

mkdir -p "$OUT"

# Leaves 11..26 (0-based leaf index as used by the djvu/hOCR page order) cover
# the complete bounded initialization section: run identification and SPECIAL
# REQUESTS, the AGC erasable/BLK2 input listing, the printed REFSMMAT, the
# astronaut card program, and the external simulator input cards, ending at the
# section break immediately before the first emitted SNAPSHOT 367700.
for leaf in $(seq 11 26); do
  n=$(printf "%04d" $((leaf + 1)))
  url="https://archive.org/download/${ITEM}/${ITEM}_jp2.zip/${ITEM}_jp2%2F${ITEM}_${n}.jp2"
  dest="$OUT/${ITEM}_${n}.jp2"
  if [ ! -f "$dest" ]; then
    echo "fetch leaf ${leaf} -> ${dest}"
    curl -sfL --max-time 180 -o "$dest" "$url"
  fi
done

echo
echo "SHA-256 of acquired pages:"
(cd "$OUT" && sha256sum ${ITEM}_*.jp2)

echo
echo "Expected hashes (from ${MANIFEST}):"
python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for p in m["pages"]:
    print(p["sourceImageSha256"], p["sourceImageFilename"], "leaf", p["scanLeaf"], "|", p["section"])
PY

echo
echo "Note: the OCR text layer (${ITEM}_djvu.xml) may be used ONLY to locate"
echo "candidate pages and fields. No numeric value may be adopted from OCR."
