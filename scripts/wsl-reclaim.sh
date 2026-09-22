#!/usr/bin/env bash
# Reclaim disk consumed by this project's throwaway build artifacts.
#
# Removes ONLY things this project created that are disposable or superseded.
# Keeps everything the pinned toolchain needs:
#   rustc 1.98.1 (default) · platform-tools v1.56 · agave 4.1.2 (Anchor's pin)
#
# NOTE: freeing space inside the guest does NOT shrink the .vhdx on Windows by
# itself. Compaction has to run from the Windows side afterwards.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

before=$(df -BM --output=used / | tail -1 | tr -dc '0-9')
echo "used before: ${before}M"

# 1. The D-04 spike. Its purpose was to prove the dependency combination
#    compiles (V-016b). It did. Nothing depends on it now.
echo "--- removing D-04 spike (1.7G) ---"
rm -rf /root/tenet-spike

# 2. Rust 1.85.0 was installed as the D-04 fallback for Anchor 0.31.x. That
#    fallback was withdrawn (V-016): the current Pyth SDK requires Anchor 1.x,
#    which builds on stable. The toolchain is dead weight.
echo "--- removing unused rust toolchain 1.85.0 ---"
rustup toolchain uninstall 1.85.0 2>&1 | tail -2

# 3. Agave 4.2.2 was installed from the stable channel before Anchor pinned
#    4.1.2. Anchor.toml pins 4.1.2, so 4.2.2 is never selected.
echo "--- removing superseded agave releases ---"
ACTIVE=$(readlink -f "$HOME/.local/share/solana/install/active_release" 2>/dev/null)
for d in "$HOME"/.local/share/solana/install/releases/*/; do
  if [ -n "$ACTIVE" ] && [[ "$ACTIVE" == "$d"* ]]; then
    echo "  keep   $(basename "$d")  (active)"
  else
    echo "  remove $(basename "$d")"
    rm -rf "$d"
  fi
done

# 4. Cargo's downloaded source cache. Rebuilt on demand from the lockfile.
echo "--- trimming cargo registry source cache ---"
rm -rf /root/.cargo/registry/src 2>/dev/null

# 5. Build logs.
rm -f /root/anchor-build*.log /root/tenet-build.log

after=$(df -BM --output=used / | tail -1 | tr -dc '0-9')
echo
echo "used after : ${after}M"
echo "reclaimed  : $(( before - after ))M"
df -h / | tail -1

echo
echo "verifying the toolchain still works:"
echo "  rustc  : $(rustc --version 2>&1 | head -1)"
echo "  solana : $(solana --version 2>&1 | head -1)"
echo "  anchor : $(anchor --version 2>&1 | head -1)"
ls /root/.cache/solana/v1.56/platform-tools/ 2>/dev/null | tr '\n' ' '
