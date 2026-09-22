#!/usr/bin/env bash
# D-04 build spike (V-016b): do anchor-lang 1.2.0, anchor-spl 1.2.0 and
# pyth-solana-receiver-sdk 2.0.0 actually COMPILE together into an SBF .so?
#
# Crate metadata says the versions are compatible (V-016). Metadata proves
# intent, not that it builds. This proves it builds.
#
# Run 1 result: dependency resolution SUCCEEDED; `anchor build` failed on
# toolchain skew (V-024). Both fixes are applied below.
#
# Builds in the WSL filesystem, not /mnt/c (D-07).
set -uo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

SPIKE=/root/tenet-spike
ANCHOR_V=1.2.0
SOLANA_V=4.1.2

echo "=== D-04 spike $(date -u +%FT%TZ) ==="
echo "anchor : $(anchor --version 2>&1 | head -1)"
echo "solana : $(solana --version 2>&1 | head -1)"
echo "rustc  : $(rustc --version 2>&1 | head -1)"

# --- fix 1: agave-install config.yml was malformed ("missing field json_rpc_url"),
#            so `agave-install list` failed and Anchor fell back to guessing.
echo
echo "--- repairing solana config ---"
mkdir -p /root/.config/solana
solana config set --url https://api.mainnet-beta.solana.com >/dev/null 2>&1
solana config get 2>&1 | head -4
agave-install list 2>&1 | head -5

rm -rf "$SPIKE"
mkdir -p "$SPIKE"
cd "$SPIKE" || exit 1
anchor init spike --no-git >/dev/null 2>&1 || { echo "[FAIL] anchor init"; exit 1; }

cd "$SPIKE/spike/programs/spike" || exit 1
cargo add anchor-spl --features token_2022 2>&1 | tail -2
cargo add pyth-solana-receiver-sdk 2>&1 | tail -2

echo
echo "--- resolved versions ---"
cargo tree -p spike --depth 1 2>/dev/null | head -8
echo "solana-program in lock -> $(grep -A1 'name = "solana-program"' "$SPIKE/spike/Cargo.lock" | grep version | head -1)"

# Exercise exactly what Tenet depends on:
#   1. token_interface  (Token-2022 AND classic in one program)
#   2. PriceUpdateV2 as an Anchor account
#   3. get_price_no_older_than  (VerificationLevel::Full by default - V-023)
cat > src/lib.rs <<'RS'
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod spike {
    use super::*;

    pub fn probe(ctx: Context<Probe>, max_age: u64, feed_hex: String) -> Result<()> {
        let raw: u64 = ctx.accounts.vault.amount;
        let supply: u64 = ctx.accounts.mint.supply;
        msg!("raw={} supply={}", raw, supply);

        let feed_id = get_feed_id_from_hex(&feed_hex)?;
        // VerificationLevel::Full is the default here. Never use the
        // custom-verification-level variant (V-023).
        let p = ctx
            .accounts
            .price_update
            .get_price_no_older_than(&Clock::get()?, max_age, &feed_id)?;
        msg!("price={} expo={} conf={}", p.price, p.exponent, p.conf);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Probe<'info> {
    pub mint: InterfaceAccount<'info, Mint>,
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub price_update: Account<'info, PriceUpdateV2>,
}
RS

cd "$SPIKE/spike" || exit 1

# --- fix 2: Anchor infers the Agave version from solana-program in Cargo.lock.
#            That resolves to 5.0.0, but Agave has NO 5.0.0 release (latest is
#            4.3.0 / 4.4.0-alpha) - crate and CLI versioning have diverged.
#            Pin explicitly so the build is deterministic, not inferred.
echo
echo "--- pinning toolchain in Anchor.toml ---"
if grep -q '^\[toolchain\]' Anchor.toml; then
  sed -i "/^\[toolchain\]/a anchor_version = \"${ANCHOR_V}\"\nsolana_version = \"${SOLANA_V}\"" Anchor.toml
else
  printf '[toolchain]\nanchor_version = "%s"\nsolana_version = "%s"\n\n' "${ANCHOR_V}" "${SOLANA_V}" \
    | cat - Anchor.toml > Anchor.toml.new && mv Anchor.toml.new Anchor.toml
fi
sed -n '1,8p' Anchor.toml

echo
echo "--- anchor build ---"
anchor build 2>&1 | tail -35
echo "[build exit] ${PIPESTATUS[0]}"

echo
echo "--- result ---"
if ls target/deploy/*.so >/dev/null 2>&1; then
  ls -la target/deploy/*.so
  echo "[PASS] SBF shared object produced - D-04 combination BUILDS"
else
  echo "[FAIL] no .so produced"
fi
echo "=== D-04 spike done $(date -u +%FT%TZ) ==="
