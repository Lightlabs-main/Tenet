#!/usr/bin/env bash
# Devnet operations for Tenet. DEVNET ONLY — enforced below.
#
#   bash scripts/wsl-devnet.sh wallet     create/show the devnet wallet + balance
#   bash scripts/wsl-devnet.sh airdrop    request devnet SOL (rate-limited faucet)
#   bash scripts/wsl-devnet.sh deploy     deploy target/deploy/tenet.so
#   bash scripts/wsl-devnet.sh show       program account info
#   bash scripts/wsl-devnet.sh close-buffer <ADDR>   reclaim SOL from a failed deploy buffer
#
# The CLI's global default on this machine is mainnet-beta. Nothing here relies
# on it: every command passes --url and --keypair explicitly, and the wallet is
# a dedicated devnet-only keypair, never ~/.config/solana/id.json.
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

URL="https://api.devnet.solana.com"
WALLET="$HOME/.config/solana/tenet-devnet.json"
PROGRAM_KEYPAIR="/mnt/c/stocklana/.keys/tenet-keypair.json"
SO="/mnt/c/stocklana/target/deploy/tenet.so"
EXPECTED_PROGRAM_ID="FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v"

case "$URL" in
  *devnet*) ;;
  *) echo "REFUSING: $URL is not devnet"; exit 1 ;;
esac

S() { solana --url "$URL" --keypair "$WALLET" "$@"; }

case "${1:-}" in
  wallet)
    if [ ! -f "$WALLET" ]; then
      echo "creating devnet-only wallet at $WALLET"
      solana-keygen new --no-bip39-passphrase --silent --outfile "$WALLET" >/dev/null
    fi
    echo "wallet : $(solana-keygen pubkey "$WALLET")"
    echo "balance: $(S balance 2>&1)"
    ;;
  airdrop)
    for i in 1 2 3; do
      echo "request $i: $(S airdrop 2 2>&1 | tail -1)"
      sleep 3
    done
    echo "balance: $(S balance 2>&1)"
    ;;
  deploy)
    [ -f "$SO" ] || { echo "no $SO — build first"; exit 1; }
    got=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
    [ "$got" = "$EXPECTED_PROGRAM_ID" ] || { echo "REFUSING: program keypair is $got, expected $EXPECTED_PROGRAM_ID"; exit 1; }
    # Our own buffer keypair, kept on disk: if the upload fails part-way, the
    # SAME command resumes into the same buffer. (Letting the CLI generate one
    # means its one-time recovery phrase is the only way to resume.)
    BUFFER="$HOME/.config/solana/tenet-devnet-buffer.json"
    [ -f "$BUFFER" ] || solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER" >/dev/null
    echo "deploying $(stat -c %s "$SO") bytes as $got to devnet"
    echo "  upgrade authority $(solana-keygen pubkey "$WALLET"), buffer $(solana-keygen pubkey "$BUFFER")"
    # Public devnet RPC drops writes under load: retry more, and pay a small
    # priority fee so buffer writes land.
    if S program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" --upgrade-authority "$WALLET"         --buffer "$BUFFER" --max-sign-attempts 100 --with-compute-unit-price 50000 2>&1 | tee /tmp/tenet-deploy.log | tail -3; then
      :
    fi
    if grep -q "^Program Id: $EXPECTED_PROGRAM_ID" /tmp/tenet-deploy.log; then
      rm -f "$BUFFER"   # consumed by the deploy
      echo "DEPLOYED"
    else
      echo "NOT deployed — rerun 'deploy' to resume into buffer $(solana-keygen pubkey "$BUFFER")"
      exit 1
    fi
    ;;
  mints)
    # DEVNET TEST MINTS — NOT Circle USDC, NOT real equity. Created once;
    # addresses saved to .keys/devnet.env (gitignored).
    ENV=/mnt/c/stocklana/.keys/devnet.env
    if [ -f "$ENV" ]; then echo "already created:"; cat "$ENV"; exit 0; fi
    T="spl-token --url $URL --fee-payer $WALLET"
    OWNER=$(solana-keygen pubkey "$WALLET")
    TUSDC=$($T create-token --decimals 6 --mint-authority "$WALLET" --output json 2>/dev/null | grep -o '"address": *"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -n "$TUSDC" ] || { echo "failed to create test USDC"; exit 1; }
    TEQ=$($T create-token --program-2022 --decimals 9 --mint-authority "$WALLET" --output json 2>/dev/null | grep -o '"address": *"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -n "$TEQ" ] || { echo "failed to create test equity"; exit 1; }
    $T create-account "$TUSDC" --owner "$OWNER" >/dev/null
    # Explicit recipient: without one, spl-token looks up the CLI's DEFAULT
    # wallet, which deliberately does not exist on this machine.
    USDC_ATA=$(spl-token --url "$URL" address --token "$TUSDC" --owner "$OWNER" --verbose | awk '/Associated token address/{print $NF}')
    $T mint "$TUSDC" 100 "$USDC_ATA" --mint-authority "$WALLET" >/dev/null
    $T create-account "$TEQ" --owner "$OWNER" --program-2022 >/dev/null
    printf 'TEST_USDC=%s\nTEST_EQUITY=%s\nWALLET=%s\n' "$TUSDC" "$TEQ" "$OWNER" > "$ENV"
    cat "$ENV"
    echo "wallet test-USDC balance: $($T balance "$TUSDC" --owner "$OWNER")"
    ;;
  fund)
    # Mint devnet TEST USDC (worthless) to someone's wallet for a browser run.
    [ -n "${2:-}" ] || { echo "usage: fund <WALLET_ADDRESS> [amount]"; exit 1; }
    source /mnt/c/stocklana/.keys/devnet.env
    TO_OWNER="$2"; AMT="${3:-50}"
    T="spl-token --url $URL --fee-payer $WALLET"
    ATA=$(spl-token --url "$URL" address --token "$TEST_USDC" --owner "$TO_OWNER" --verbose | awk '/Associated token address/{print $NF}')
    # Create their token account if needed (paid by the devnet wallet), then mint.
    $T create-account "$TEST_USDC" --owner "$TO_OWNER" >/dev/null 2>&1 || true
    $T mint "$TEST_USDC" "$AMT" "$ATA" --mint-authority "$WALLET" 2>&1 | tail -1
    echo "$TO_OWNER now holds $(spl-token --url "$URL" balance --address "$ATA") test USDC (devnet, worthless)"
    ;;
  close-buffer)
    [ -n "${2:-}" ] || { echo "usage: close-buffer <BUFFER_ADDRESS>"; exit 1; }
    S program close "$2" --recipient "$(solana-keygen pubkey "$WALLET")" --bypass-warning 2>&1 | tail -2
    echo "balance: $(S balance 2>&1)"
    ;;
  show)
    S program show "$EXPECTED_PROGRAM_ID" 2>&1
    echo "balance: $(S balance 2>&1)"
    ;;
  *)
    echo "usage: wsl-devnet.sh wallet|airdrop|deploy|show|close-buffer <addr>"; exit 1 ;;
esac
