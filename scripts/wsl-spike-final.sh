#!/usr/bin/env bash
# V-016b, final. Two fixes applied in sequence, both confirmed:
#   1. idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
#      -> cleared the DISCRIMINATOR / create_type / insert_types errors
#   2. remove the leftover `anchor init` template test, which still references
#      the scaffold instructions (Initialize / Increment) that we replaced with
#      `probe`. Not a dependency problem - just stale generated scaffolding.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export CARGO_BUILD_JOBS=2

cd /root/tenet-spike/spike || { echo "no spike dir"; exit 1; }

echo "--- removing template scaffolding tests ---"
ls programs/spike/tests/ 2>/dev/null
rm -f programs/spike/tests/test_initialize.rs
rmdir programs/spike/tests 2>/dev/null || true

LOG=/root/anchor-build3.log
: > "$LOG"
echo "start $(date -u +%FT%TZ)" >> "$LOG"
anchor build >> "$LOG" 2>&1
RC=$?
echo "EXIT=$RC" >> "$LOG"

echo
echo "--- last 20 log lines ---"
tail -20 "$LOG"
echo
echo "=============== RESULT ==============="
echo "anchor build exit: $RC"
ls -la target/deploy/*.so 2>/dev/null || echo "no .so"
ls -la target/idl/*.json 2>/dev/null || echo "no IDL"
if [ -f target/idl/spike.json ]; then
  echo
  echo "--- IDL proves the dependency combination works end to end ---"
  python3 -c "
import json
d=json.load(open('target/idl/spike.json'))
print('program :', d.get('metadata',{}).get('name'), d.get('metadata',{}).get('version'))
print('spec    :', d.get('metadata',{}).get('spec'))
print('instructions:', [i['name'] for i in d.get('instructions',[])])
print('accounts    :', [a['name'] for a in d.get('accounts',[])])
print('types       :', [t['name'] for t in d.get('types',[])][:12])
" 2>/dev/null || head -c 600 target/idl/spike.json
fi
