#!/usr/bin/env bash
# Tenet - WSL provisioning part 2: Anchor (BLOCKER-01).
#
# Install source verified in docs/verification.md V-015:
#   - github.com/otter-sec/anchor is the canonical Anchor repo. Both
#     coral-xyz/anchor and solana-foundation/anchor 301-redirect to it.
#   - The crates.io crate named `avm` is an UNRELATED abandoned Node version
#     manager from 2016. NEVER `cargo install avm`. Always install from git.
#
# Version 1.2.0 per decision D-04 (V-016): pyth-solana-receiver-sdk 2.0.0
# requires anchor-lang ^1.0.2.
set -uo pipefail

LOG=/root/tenet-provision.log
exec > >(tee -a "$LOG") 2>&1
echo "=== anchor provision start $(date -u +%FT%TZ) ==="

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

ANCHOR_VERSION=1.2.0

echo "--- installing avm from git (NOT crates.io) ---"
cargo install --git https://github.com/otter-sec/anchor avm --force --locked \
  || cargo install --git https://github.com/otter-sec/anchor avm --force

command -v avm || { echo "[FAIL] avm not on PATH"; exit 1; }

echo "--- avm install ${ANCHOR_VERSION} ---"
avm install "${ANCHOR_VERSION}"
avm use "${ANCHOR_VERSION}"

echo "--- summary ---"
echo "avm    : $(avm --version 2>&1 | head -1)"
echo "anchor : $(anchor --version 2>&1 | head -1)"
echo "rustc  : $(rustc --version 2>&1)"
echo "solana : $(solana --version 2>&1)"
echo "=== anchor provision done $(date -u +%FT%TZ) ==="
