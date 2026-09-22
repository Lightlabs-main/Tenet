#!/usr/bin/env bash
# V-016b, final step.
#
# The SBF program COMPILED AND LINKED successfully (112,400-byte spike.so).
# Only `anchor idl build` failed:
#
#   error[E0599]: no associated item named `DISCRIMINATOR` found for
#                 anchor_spl::token_interface::TokenAccount
#   error[E0599]: no function named `create_type` / `insert_types` ...
#
# Cause: `anchor init` generates
#     idl-build = ["anchor-lang/idl-build"]
# but any anchor-spl type used inside #[derive(Accounts)] also needs
#     anchor-spl/idl-build
# and Pyth's PriceUpdateV2 likewise needs its own idl-build feature if it has one.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_BUILD_JOBS=2

cd /root/tenet-spike/spike/programs/spike || { echo "no spike dir"; exit 1; }

echo "--- before ---"
grep -n 'idl-build' Cargo.toml

# Does the Pyth SDK expose an idl-build feature?
PYTH_IDL=""
if cargo metadata --no-deps --format-version 1 >/dev/null 2>&1; then
  if grep -q 'idl-build' "$HOME/.cargo/registry/src"/*/pyth-solana-receiver-sdk-*/Cargo.toml 2>/dev/null; then
    PYTH_IDL=', "pyth-solana-receiver-sdk/idl-build"'
    echo "[info] pyth-solana-receiver-sdk exposes idl-build"
  else
    echo "[info] pyth-solana-receiver-sdk has no idl-build feature"
  fi
fi

sed -i "s|^idl-build = \[\"anchor-lang/idl-build\"\]|idl-build = [\"anchor-lang/idl-build\", \"anchor-spl/idl-build\"${PYTH_IDL}]|" Cargo.toml

echo "--- after ---"
grep -n 'idl-build' Cargo.toml

cd /root/tenet-spike/spike || exit 1
LOG=/root/anchor-build2.log
: > "$LOG"
echo "start $(date -u +%FT%TZ)" >> "$LOG"
anchor build >> "$LOG" 2>&1
echo "EXIT=$?" >> "$LOG"

echo
echo "--- tail of build log ---"
tail -25 "$LOG"
echo
echo "--- artifacts ---"
ls -la target/deploy/*.so 2>/dev/null || echo "no .so"
ls -la target/idl/*.json 2>/dev/null || echo "no IDL"
if [ -f target/idl/spike.json ]; then
  echo "--- IDL account types ---"
  grep -o '"name": "[A-Za-z]*"' target/idl/spike.json | head -20
fi
