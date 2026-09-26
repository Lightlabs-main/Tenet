#!/usr/bin/env bash
# Tenet Devnet upkeep, run by cron on the operator host.
#   status   read-only health check (pnpm devnet:status), daily
#   refresh  republish every test price unchanged, resetting publish_time, so
#            feeds never pass the program 30-day freshness limit, weekly
#   pyth     relay live Pyth prices into the Pyth-following instruments
#            (TTSLA, TVOO) when fresh, every 2 minutes
# The operator keypair file is read by the script itself; nothing is printed.
export PATH="$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ROOT="${TENET_ROOT:-/opt/tenet-build-45188cc}"
cd "$ROOT/packages/sdk" || exit 1
case "$1" in
  status)  out=$(node --import tsx scripts/devnet/status.ts 2>&1) ;;
  refresh) out=$(node --import tsx scripts/devnet/price.ts --refresh 2>&1) ;;
  pyth)    out=$(node --import tsx scripts/devnet/pyth-relay.ts 2>&1) ;;
  *) echo "usage: $0 status|refresh|pyth" >&2; exit 2 ;;
esac
rc=$?
printf '%s\n' "$out" | sed "s/^/$(date -u +%FT%TZ) $1 /" >> /var/log/tenet-devnet.log
exit $rc
