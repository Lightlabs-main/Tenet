#!/usr/bin/env bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "--- platform-tools contents ---"
ls /root/.cache/solana/v1.56/platform-tools/ 2>&1
echo "--- rust sysroot bin ---"
ls /root/.cache/solana/v1.56/platform-tools/rust/bin 2>&1 | head -6
echo "--- versions ---"
echo "anchor : $(anchor --version 2>&1 | head -1)"
echo "solana : $(solana --version 2>&1 | head -1)"
echo "rustc  : $(rustc --version 2>&1 | head -1)"
echo "cargo-build-sbf : $(cargo-build-sbf --version 2>&1 | head -3 | tr '\n' ' ')"
