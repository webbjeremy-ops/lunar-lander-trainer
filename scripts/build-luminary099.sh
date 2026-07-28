#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Reproducible-build script for Luminary099. Clones the pinned Apollo source
# and pinned Virtual AGC toolchain, builds yaYUL, assembles Luminary099, and
# compares the resulting binary against public/ropes/Luminary099.bin.
#
# Never overwrites the committed binary; never rewrites the manifest. Both are
# human review steps once a byte-identical build is confirmed. See
# docs/rope-reproduction.md.

set -euo pipefail

APOLLO_REPO="https://github.com/chrislgarry/Apollo-11.git"
APOLLO_COMMIT="911e5c0283c629c50cb97666f34065e8c07d71a5"

VAGC_REPO="https://github.com/virtualagc/virtualagc.git"
VAGC_COMMIT="b6d27dc645fdc1ac75a3f825fea1d81e06729cc3"

WORK_DIR="${WORK_DIR:-/tmp/agc-rope-build}"
COMMITTED_BIN="public/ropes/Luminary099.bin"

log() { printf '[build-luminary099] %s\n' "$*"; }

if [[ ! -f "$COMMITTED_BIN" ]]; then
  log "MISSING: $COMMITTED_BIN not present in this checkout"
  exit 2
fi

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if [[ ! -d Apollo-11 ]]; then
  log "cloning chrislgarry/Apollo-11 @ $APOLLO_COMMIT"
  git clone --filter=blob:none "$APOLLO_REPO" Apollo-11
fi
git -C Apollo-11 fetch --depth 1 origin "$APOLLO_COMMIT" || true
git -C Apollo-11 checkout "$APOLLO_COMMIT"

if [[ ! -d virtualagc ]]; then
  log "cloning virtualagc/virtualagc @ $VAGC_COMMIT"
  git clone --filter=blob:none "$VAGC_REPO" virtualagc
fi
git -C virtualagc fetch --depth 1 origin "$VAGC_COMMIT" || true
git -C virtualagc checkout "$VAGC_COMMIT"

log "building yaYUL"
make -C virtualagc/yaYUL >/dev/null

YAYUL="$WORK_DIR/virtualagc/yaYUL/yaYUL"
BUILD_DIR="$WORK_DIR/Apollo-11/Luminary099"
OUT_BIN="$WORK_DIR/Luminary099.bin"

log "assembling Luminary099/MAIN.agc"
(
  cd "$BUILD_DIR"
  "$YAYUL" MAIN.agc >/dev/null
  cp MAIN.bin "$OUT_BIN"
)

BUILT_SHA=$(sha256sum "$OUT_BIN" | awk '{print $1}')
BUILT_LEN=$(wc -c <"$OUT_BIN")
COMMITTED_SHA=$(sha256sum "$COMMITTED_BIN" | awk '{print $1}')
COMMITTED_LEN=$(wc -c <"$COMMITTED_BIN")

cd - >/dev/null

log "built    sha256 = $BUILT_SHA ($BUILT_LEN bytes)"
log "commited sha256 = $COMMITTED_SHA ($COMMITTED_LEN bytes)"

if [[ "$BUILT_SHA" == "$COMMITTED_SHA" && "$BUILT_LEN" == "$COMMITTED_LEN" ]]; then
  log "REPRODUCIBLE: byte-identical"
  exit 0
fi

log "MISMATCH: committed rope does not reproduce from pinned inputs"
exit 3
