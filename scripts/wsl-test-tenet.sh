#!/usr/bin/env bash
# Host-side unit tests for the Tenet program.
#
# D-07 resolved: CARGO_TARGET_DIR points into the WSL filesystem rather than
# /mnt/c. `cargo test` produced 1.4 GB of intermediate artifacts on C: while the
# actual deliverables (.so + IDL) are ~60 MB — and C: is the constrained drive
# on this machine (ENV-01). Building across the /mnt/c boundary is also slower.
#
# `anchor build` still writes target/deploy and target/idl inside the workspace,
# because those ARE the deliverables and they are small.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_TARGET_DIR=/root/tenet-target
export CARGO_BUILD_JOBS=2

cd /mnt/c/stocklana || exit 1
echo "target dir: $CARGO_TARGET_DIR (kept off C:, see ENV-01 / D-07)"
cargo test -p tenet --lib 2>&1 | tail -25
