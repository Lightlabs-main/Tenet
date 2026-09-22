#!/usr/bin/env bash
# On-chain behaviour tests (LiteSVM) against target/deploy/tenet.so.
# Build the program first with scripts/wsl-build-tenet.sh.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_TARGET_DIR=/root/tenet-target
export CARGO_BUILD_JOBS=2
cd /mnt/c/stocklana || exit 1
[ -f target/deploy/tenet.so ] || { echo "no target/deploy/tenet.so - build first"; exit 1; }
cargo test -p tenet-program-tests "$@" 2>&1 | grep -vE "^\s+(Compiling|Downloaded|Downloading)" | grep -E "^test |test result|panicked|^error"
