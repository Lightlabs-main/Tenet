#!/usr/bin/env bash
# Read-only probe of the WSL toolchain. Safe to re-run.
for t in rustc cargo rustup node npm pnpm solana agave-install anchor avm git curl cc pkg-config; do
  printf '%-16s' "$t"
  if command -v "$t" >/dev/null 2>&1; then
    "$t" --version 2>&1 | head -1
  else
    echo "MISSING"
  fi
done
echo "--- apt libs ---"
for p in build-essential pkg-config libssl-dev libudev-dev protobuf-compiler llvm libclang-dev; do
  printf '%-22s' "$p"
  dpkg -s "$p" >/dev/null 2>&1 && echo installed || echo MISSING
done
