#!/usr/bin/env bash
# Generate the program keypair and sync its id into declare_id! / Anchor.toml.
#
# The hand-written placeholder "Tenet111...1111" is NOT valid base58 for a
# 32-byte pubkey — it fails const-evaluation inside declare_id! with
# "Largest term greater than 2^32". A vanity prefix only works if the whole
# string still decodes to 32 bytes, so the id must be generated, not invented.
#
# The keypair stays in target/deploy/, which .gitignore excludes. It is the
# program's upgrade identity — never commit it, never print it (R-14).
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

cd /mnt/c/stocklana || exit 1
mkdir -p target/deploy

if [ ! -f target/deploy/tenet-keypair.json ]; then
  echo "--- generating program keypair ---"
  solana-keygen new --no-bip39-passphrase --silent -o target/deploy/tenet-keypair.json
fi

PROGRAM_ID=$(solana-keygen pubkey target/deploy/tenet-keypair.json)
echo "program id: ${PROGRAM_ID}"

# declare_id!
sed -i "s|declare_id!(\"[^\"]*\")|declare_id!(\"${PROGRAM_ID}\")|" programs/tenet/src/lib.rs
grep -n 'declare_id' programs/tenet/src/lib.rs

# Anchor.toml
sed -i "s|^tenet = \".*\"|tenet = \"${PROGRAM_ID}\"|" Anchor.toml
sed -i '/^\[registry\]$/,+1d' Anchor.toml   # unused field, Anchor warns about it
grep -n 'tenet =' Anchor.toml

echo "--- anchor keys list ---"
anchor keys list 2>&1 | head -5
