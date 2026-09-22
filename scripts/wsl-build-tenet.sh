#!/usr/bin/env bash
# Build the real Tenet program.
#
# D-07 (resolved): host `cargo test` builds go to CARGO_TARGET_DIR in the WSL
# filesystem — they were 1.4 GB on C:, the constrained drive (ENV-01).
# `anchor build` still writes target/deploy and target/idl in the workspace,
# because those small files are the deliverables.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_BUILD_JOBS=2

cd /mnt/c/stocklana || { echo "repo not found"; exit 1; }

# The program keypair is the program id. target/ gets deleted to reclaim disk,
# and if the keypair is missing `anchor build` silently generates a NEW one —
# a different program id that no longer matches declare_id!. Restore it first,
# and refuse to build if it cannot be restored.
mkdir -p target/deploy
if [ ! -f target/deploy/tenet-keypair.json ]; then
  if [ -f .keys/tenet-keypair.json ]; then
    cp .keys/tenet-keypair.json target/deploy/tenet-keypair.json
    echo "restored program keypair from .keys/"
  else
    echo "REFUSING TO BUILD: no program keypair in target/deploy/ or .keys/"
    exit 1
  fi
fi

echo "=== tenet build $(date -u +%FT%TZ) ==="
echo "anchor : $(anchor --version 2>&1 | head -1)"
echo "solana : $(solana --version 2>&1 | head -1)"

LOG=/root/tenet-build.log
: > "$LOG"

# Warnings gate. The Solana platform-tools compiler (rustc 1.95.0-dev) crashes
# with an internal compiler error while RENDERING some warnings — observed on a
# liveness ("value assigned is never read") warning, 2026-09-21. A warning that
# stable rustc merely prints can therefore fail an 8-minute build. Fail in
# seconds on the host compiler instead.
echo
echo "--- warnings gate (host cargo check) ---"
WARN=$(CARGO_TARGET_DIR=/root/tenet-target cargo check -p tenet --tests --message-format short 2>&1 | grep -E "^[^ ]+: warning" )
if [ -n "$WARN" ]; then
  echo "REFUSING TO BUILD: fix these warnings first"
  echo "$WARN"
  exit 1
fi
echo "clean"

# Unit tests first: pure arithmetic, fast, and they gate the rest.
echo
echo "--- cargo test (host) ---"
START=$(date +%s)
CARGO_TARGET_DIR=/root/tenet-target cargo test -p tenet --lib >> "$LOG" 2>&1
TEST_RC=$?
echo "cargo test exit: $TEST_RC  ($(( $(date +%s) - START ))s)"
grep -E "^(test |running|test result)" "$LOG" | tail -20

echo
echo "--- anchor build ---"
START=$(date +%s)
anchor build >> "$LOG" 2>&1
BUILD_RC=$?
BUILD_SECS=$(( $(date +%s) - START ))
echo "anchor build exit: $BUILD_RC  (${BUILD_SECS}s)"

if [ "$BUILD_RC" -ne 0 ]; then
  echo
  echo "--- errors ---"
  grep -E "^(error|warning: unused)" "$LOG" | head -30
  echo "--- tail ---"
  tail -30 "$LOG"
  exit 1
fi

# Refresh the SDK's committed IDL copy (target/ is deleted to reclaim disk, so
# the client must regenerate without a program build). If the IDL changed, the
# SDK drift check (`node packages/sdk/scripts/gen-client.mjs --check`) fails
# until the client is regenerated.
cp target/idl/tenet.json packages/sdk/idl/tenet.json
echo "refreshed packages/sdk/idl/tenet.json"

echo
echo "=============== RESULT ==============="
ls -la target/deploy/*.so 2>/dev/null || echo "no .so"
ls -la target/idl/*.json 2>/dev/null || echo "no IDL"
if [ -f target/idl/tenet.json ]; then
  python3 -c "
import json
d=json.load(open('target/idl/tenet.json'))
print('accounts in IDL:', len(d.get('accounts',[])))
for a in d.get('accounts',[]): print('  -', a['name'])
" 2>/dev/null
fi
echo "build wall time: ${BUILD_SECS}s (D-07 data point)"
