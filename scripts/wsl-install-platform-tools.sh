#!/usr/bin/env bash
# Install Solana platform-tools (the SBF Rust sysroot) deterministically.
#
# Anchor's own downloader left a TRUNCATED tarball: 151,945,216 of 520,271,243
# bytes (29%), with no sysroot extracted, after the WSL VM was OOM-killed.
# This script downloads with resume, VERIFIES the byte count against the GitHub
# release asset size, and only then extracts. It never extracts a short file.
set -uo pipefail

VERSION="${1:-v1.56}"
EXPECTED_BYTES="${2:-520271243}"
DEST="/root/.cache/solana/${VERSION}/platform-tools"
URL="https://github.com/anza-xyz/platform-tools/releases/download/${VERSION}/platform-tools-linux-x86_64.tar.bz2"
TARBALL="/root/platform-tools-${VERSION}.tar.bz2"

echo "=== platform-tools ${VERSION} ==="
echo "expected: ${EXPECTED_BYTES} bytes"

# Clear Anchor's truncated temp file so it cannot be mistaken for a good download.
rm -f "${DEST}/tmp-platform-tools-linux-x86_64.tar.bz2"
mkdir -p "${DEST}"

for attempt in 1 2 3; do
  echo "--- download attempt ${attempt} ---"
  curl -L --fail --retry 5 --retry-delay 3 --continue-at - \
       --connect-timeout 20 -o "${TARBALL}" "${URL}"
  actual=$(stat -c %s "${TARBALL}" 2>/dev/null || echo 0)
  echo "have ${actual} / ${EXPECTED_BYTES} bytes"
  [ "${actual}" = "${EXPECTED_BYTES}" ] && break
  echo "incomplete; retrying"
done

actual=$(stat -c %s "${TARBALL}" 2>/dev/null || echo 0)
if [ "${actual}" != "${EXPECTED_BYTES}" ]; then
  echo "[FAIL] size mismatch: ${actual} != ${EXPECTED_BYTES}. NOT extracting."
  exit 1
fi
echo "[ok] size verified"

echo "--- extracting ---"
tar -xjf "${TARBALL}" -C "${DEST}" || { echo "[FAIL] extract"; exit 1; }

echo "--- result ---"
ls -la "${DEST}" | head -15
SYSROOT="${DEST}/rust"
if [ -d "${SYSROOT}" ]; then
  echo "[ok] Rust sysroot present at ${SYSROOT}"
  rm -f "${TARBALL}"
else
  echo "[FAIL] no rust sysroot under ${DEST}"
  exit 1
fi
echo "=== done $(date -u +%FT%TZ) ==="
