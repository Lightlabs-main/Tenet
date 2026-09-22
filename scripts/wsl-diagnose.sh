#!/usr/bin/env bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "--- memory ---"
free -h | head -3
echo "--- swap configured? ---"
swapon --show 2>&1 | head -5
echo "--- OOM kills in dmesg ---"
dmesg 2>/dev/null | grep -i -E "out of memory|oom-kill|killed process" | tail -10
echo "(end dmesg)"
echo "--- spike build artifacts ---"
ls -la /root/tenet-spike/spike/target/ 2>&1 | head -10
ls -la /root/tenet-spike/spike/target/deploy/ 2>&1 | head -10
echo "--- anchor build, rerun in foreground with limited parallelism ---"
cd /root/tenet-spike/spike || exit 1
export CARGO_BUILD_JOBS=2
anchor build 2>&1 | tail -45
echo "[build exit] ${PIPESTATUS[0]}"
ls -la target/deploy/*.so 2>/dev/null && echo "[PASS] .so produced" || echo "[FAIL] no .so"
