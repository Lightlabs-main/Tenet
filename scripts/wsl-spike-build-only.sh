#!/usr/bin/env bash
# Re-run ONLY the anchor build for the existing spike, capturing full output to a
# log file. The previous runs piped through `tail`, which buffered everything and
# lost the diagnostics when the build died.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_BUILD_JOBS=2

LOG=/root/anchor-build.log
cd /root/tenet-spike/spike || { echo "no spike dir"; exit 1; }

rm -f target/deploy/spike.so
: > "$LOG"
echo "start $(date -u +%FT%TZ)" >> "$LOG"
anchor build >> "$LOG" 2>&1
echo "EXIT=$?" >> "$LOG"
echo "end $(date -u +%FT%TZ)" >> "$LOG"

echo "--- log size: $(wc -l < "$LOG") lines ---"
tail -60 "$LOG"
echo "--- artifact ---"
ls -la target/deploy/*.so 2>/dev/null || echo "no .so"
