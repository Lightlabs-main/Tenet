#!/usr/bin/env bash
# Read-only disk report. Deletes nothing.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "--- guest filesystem ---"
df -h / | tail -1
echo
echo "--- largest directories under /root ---"
du -sh /root/* 2>/dev/null | sort -rh | head -12
echo
echo "--- breakdown ---"
for d in /root/tenet-spike /root/.cargo/registry /root/.cache/solana /root/.local/share/solana /root/.rustup /root/.nvm; do
  printf '%-34s ' "$d"
  du -sh "$d" 2>/dev/null | cut -f1 || echo "-"
done
echo
echo "--- repo target on /mnt/c ---"
du -sh /mnt/c/stocklana/target 2>/dev/null || echo "none"
