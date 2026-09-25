#!/usr/bin/env bash
# VPS build: warnings gate, then anchor build of both programs.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd /opt/tenet-build-45188cc || exit 1
echo "=== build $(date -u +%FT%TZ)"
W=$(cargo check -p tenet -p tenet-devnet --tests --message-format short 2>&1 | grep -E "^[^ ]+: (warning|error)")
if [ -n "$W" ]; then echo "REFUSING TO BUILD: warnings/errors"; echo "$W"; exit 1; fi
echo "warnings gate: clean"
START=$(date +%s)
anchor build 2>&1 | tail -15
RC=${PIPESTATUS[0]}
echo "anchor build exit: $RC ($(( $(date +%s) - START ))s)"
ls -la target/deploy/*.so target/idl/*.json 2>/dev/null
exit $RC
