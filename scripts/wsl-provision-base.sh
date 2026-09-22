#!/usr/bin/env bash
# Tenet - WSL base provisioning (BLOCKER-01, part 1 of 2).
# Installs system deps, Rust, Agave/Solana CLI, Node + pnpm.
# Anchor is deliberately NOT installed here - its install source is verified separately.
# Idempotent: safe to re-run.
set -uo pipefail

LOG=/root/tenet-provision.log
exec > >(tee -a "$LOG") 2>&1
echo "=== base provision start $(date -u +%FT%TZ) ==="

step() { echo; echo "--- $* ---"; }
ok()   { echo "[ok]   $*"; }
fail() { echo "[FAIL] $*"; }

step "apt system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends \
       build-essential pkg-config libssl-dev libudev-dev \
       protobuf-compiler llvm libclang-dev clang cmake \
       git curl ca-certificates xz-utils bzip2 \
  && ok "apt deps" || fail "apt deps"

step "rustup + rust toolchains"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
export PATH="$HOME/.cargo/bin:$PATH"
grep -q 'cargo/env' /root/.bashrc 2>/dev/null || echo 'source $HOME/.cargo/env' >> /root/.bashrc
# stable for general work; 1.85.0 kept available for the D-04 spike fallback
rustup toolchain install stable --profile minimal -c rustfmt -c clippy
rustup toolchain install 1.85.0 --profile minimal -c rustfmt -c clippy
rustup default stable
command -v rustc && rustc --version && ok "rust" || fail "rust"

step "Agave / Solana CLI"
if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release' /root/.bashrc 2>/dev/null \
  || echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /root/.bashrc
command -v solana && solana --version && ok "solana" || fail "solana"

step "Node via nvm + pnpm via corepack"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
nvm install 22          # LTS; Windows side runs 26 (D-01) - WSL pins its own
nvm alias default 22
corepack enable || true
corepack prepare pnpm@latest --activate || npm i -g pnpm
node --version && ok "node" || fail "node"
pnpm --version && ok "pnpm" || fail "pnpm"

step "summary"
echo "rustc  : $(rustc --version 2>&1)"
echo "cargo  : $(cargo --version 2>&1)"
echo "solana : $(solana --version 2>&1)"
echo "node   : $(node --version 2>&1)"
echo "pnpm   : $(pnpm --version 2>&1)"
echo "=== base provision done $(date -u +%FT%TZ) ==="
