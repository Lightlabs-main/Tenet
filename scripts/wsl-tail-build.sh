#!/usr/bin/env bash
LOG=/root/anchor-build.log
echo "--- log lines: $(wc -l < "$LOG" 2>/dev/null || echo 0) ---"
tail -40 "$LOG" 2>/dev/null
echo "--- artifact ---"
ls -la /root/tenet-spike/spike/target/deploy/*.so 2>/dev/null || echo "no .so yet"
echo "--- build processes ---"
pgrep -a -f "cargo|anchor|rustc" 2>/dev/null | head -5 || echo "(none running)"
