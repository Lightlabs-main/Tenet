#!/usr/bin/env bash
# Push this working tree to the VPS build checkout, including deletions.
#
#   bash scripts/sync-to-vps.sh            # sync
#   bash scripts/sync-to-vps.sh --dry-run  # show what would be removed
#
# Source of truth is THIS working tree. Sent: every tracked and untracked,
# non-ignored file (git ls-files -co --exclude-standard) — so node_modules,
# target/, dist/, .env and .keys/ never travel. On the VPS, any tracked or
# non-ignored untracked file that no longer exists here is removed, so deleted
# modules cannot linger and keep compiling.
set -euo pipefail
HOST="${TENET_VPS:-optiongenome}"
DEST="${TENET_VPS_DIR:-/opt/tenet-build-45188cc}"
cd "$(git rev-parse --show-toplevel)"

LIST=$(mktemp)
# Tracked + untracked, minus files deleted in the working tree (git still lists
# a deleted-but-tracked file under -c, and tar would fail on it).
comm -23 <(git ls-files -co --exclude-standard | sort -u) <(git ls-files -d | sort -u) \
  | tr '\n' '\0' > "$LIST"
count=$(tr -cd '\0' < "$LIST" | wc -c)

if [ "${1:-}" = "--dry-run" ]; then
  tr '\0' '\n' < "$LIST" | ssh -o BatchMode=yes "$HOST" \
    "cd '$DEST' && git ls-files -co --exclude-standard | sort > /tmp/remote.txt && sort > /tmp/local.txt && comm -23 /tmp/remote.txt /tmp/local.txt"
  exit 0
fi

tar -czf - --null -T "$LIST" | ssh -o BatchMode=yes "$HOST" "tar -xzf - -C '$DEST'"
tr '\0' '\n' < "$LIST" | ssh -o BatchMode=yes "$HOST" \
  "cd '$DEST' && sort > /tmp/local.txt && git ls-files -co --exclude-standard | sort > /tmp/remote.txt && comm -23 /tmp/remote.txt /tmp/local.txt | while IFS= read -r f; do [ -e \"\$f\" ] && rm -f -- \"\$f\" && echo \"removed on VPS: \$f\"; done; true"
rm -f "$LIST"
echo "synced $count files to $HOST:$DEST"
