//! # Tenet
//!
//! Collectively owned portfolios of tokenized stocks, governed by an on-chain
//! investment constitution.
//!
//! ## Phase
//!
//! Phase 1 — core accounting. This crate currently defines the account model,
//! checked arithmetic and error surface. Instructions land in Phase 2 (POOL) and
//! Phase 3 (EXIT), in that order and deliberately: if members cannot retrieve
//! their proportional assets, no further capital deployment gets built.
//!
//! ## Invariants this crate exists to uphold
//!
//! - **INV-001** `Σ member.shares + circle.reserved_shares == circle.total_shares`
//! - **INV-002** pending epoch USDC is a separate token account, never spendable
//!   as Circle capital
//! - **INV-004** no member receives more than their floored pro-rata entitlement
//! - **INV-005** rounding never advantages whoever triggered the operation
//! - **INV-019** a ScaledUiAmount multiplier change leaves every share balance
//!   and entitlement bit-identical
//!
//! ## Two rules that shape everything
//!
//! **Raw base units are canonical.** Ownership, redemption and supply accounting
//! use the integer `amount` of a token account and the integer `supply` of a
//! mint. The Token-2022 ScaledUiAmount multiplier appears only at the display
//! boundary. This is not stylistic: verified mainnet multipliers include
//! `1.4861347` and `1.0032690125398187`, and there is no exact integer
//! arithmetic through those numbers.
//!
//! **Tenet imposes no permission gate on exit.** Establishing a proportional
//! in-kind entitlement requires no price, oracle, vote or approval. Tenet cannot
//! promise that every external token is always transferable — issuers retain
//! pause, freeze and permanent-delegate authority outside Tenet's control — and
//! does not claim to.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
#[cfg(test)]
mod math_vectors;
pub mod pda;
#[cfg(test)]
mod pda_vectors;
pub mod state;

pub use constants::*;
pub use errors::TenetError;
pub use instructions::*;
pub use state::*;

// Generated program id. The keypair is kept at .keys/ (gitignored; copied into
// target/deploy/ for builds, since target/ is deleted to reclaim disk) and is
// the program's upgrade identity — see R-14 on burning or disclosing it before
// any production claim.
declare_id!("7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh");

#[program]
pub mod tenet {
    use super::*;

    // ---- config (A-18) ------------------------------------------------------

    pub fn initialize_config(ctx: Context<InitializeConfig>, registry_authority: Pubkey) -> Result<()> {
        instructions::config::initialize_handler(ctx, registry_authority)
    }

    // ---- registry -----------------------------------------------------------

    pub fn upsert_registry_entry(ctx: Context<UpsertRegistryEntry>, params: RegistryParams) -> Result<()> {
        instructions::registry::upsert_handler(ctx, params)
    }

    pub fn refresh_asset_metadata(ctx: Context<RefreshAssetMetadata>) -> Result<()> {
        instructions::registry::refresh_handler(ctx)
    }

    // ---- mandate ------------------------------------------------------------

    pub fn create_mandate(ctx: Context<CreateMandate>, params: MandateParams) -> Result<()> {
        instructions::mandate::create_handler(ctx, params)
    }

    pub fn fork_mandate(ctx: Context<ForkMandate>) -> Result<()> {
        instructions::mandate::fork_handler(ctx)
    }

    pub fn fork_mandate_asset(ctx: Context<ForkMandateAsset>) -> Result<()> {
        instructions::mandate::fork_asset_handler(ctx)
    }

    pub fn add_mandate_asset(ctx: Context<AddMandateAsset>, target_weight_bps: u16) -> Result<()> {
        instructions::mandate::add_asset_handler(ctx, target_weight_bps)
    }

    pub fn finalize_mandate<'info>(
        ctx: Context<'info, FinalizeMandate<'info>>,
    ) -> Result<()> {
        instructions::mandate::finalize_handler(ctx)
    }

    // ---- amendment governance ---------------------------------------------

    pub fn propose_amendment(
        ctx: Context<ProposeAmendment>,
        proposal_id: u64,
        params: MandateParams,
    ) -> Result<()> {
        instructions::amendment::propose_handler(ctx, proposal_id, params)
    }

    pub fn vote_amendment(ctx: Context<VoteAmendment>, support: bool) -> Result<()> {
        instructions::amendment::vote_handler(ctx, support)
    }

    pub fn execute_amendment(ctx: Context<ExecuteAmendment>) -> Result<()> {
        instructions::amendment::execute_handler(ctx)
    }

    // ---- circle -------------------------------------------------------------

    pub fn create_circle(ctx: Context<CreateCircle>) -> Result<()> {
        instructions::circle::create_circle_handler(ctx)
    }

    pub fn add_circle_asset(ctx: Context<AddCircleAsset>) -> Result<()> {
        instructions::circle::add_circle_asset_handler(ctx)
    }

    // ---- epoch (moves value) ------------------------------------------------

    pub fn open_epoch(ctx: Context<OpenEpoch>, index: u64) -> Result<()> {
        instructions::epoch::open_epoch_handler(ctx, index)
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::epoch::contribute_handler(ctx, amount)
    }

    pub fn cancel_contribution(ctx: Context<CancelContribution>) -> Result<()> {
        instructions::epoch::cancel_handler(ctx)
    }

    pub fn close_contributions(ctx: Context<CloseContributions>) -> Result<()> {
        instructions::epoch::close_contributions_handler(ctx)
    }

    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>) -> Result<()> {
        instructions::epoch::finalize_epoch_handler(ctx)
    }

    pub fn open_nav_snapshot(ctx: Context<OpenNavSnapshot>) -> Result<()> {
        instructions::valuation::open_nav_snapshot_handler(ctx)
    }

    pub fn record_asset_nav(ctx: Context<RecordAssetNav>) -> Result<()> {
        instructions::valuation::record_asset_nav_handler(ctx)
    }

    pub fn cancel_epoch(ctx: Context<CancelEpoch>) -> Result<()> {
        instructions::valuation::cancel_epoch_handler(ctx)
    }

    pub fn settle_contribution(ctx: Context<SettleContribution>) -> Result<()> {
        instructions::epoch::settle_handler(ctx)
    }

    pub fn close_epoch(ctx: Context<CloseEpoch>) -> Result<()> {
        instructions::epoch::close_epoch_handler(ctx)
    }

    // ---- execution (fail-closed raw-delta boundary) -----------------------

    pub fn begin_execution(
        ctx: Context<BeginExecution>,
        nonce: u64,
        max_in: u64,
        min_out: u64,
        expires_at: i64,
    ) -> Result<()> {
        instructions::execution::begin_handler(ctx, nonce, max_in, min_out, expires_at)
    }

    pub fn end_execution(ctx: Context<EndExecution>) -> Result<()> {
        instructions::execution::end_handler(ctx)
    }

    // ---- explicitly valueless Devnet test market -------------------------

    pub fn initialize_devnet_test_market(ctx: Context<InitializeDevnetTestMarket>) -> Result<()> {
        instructions::test_market::initialize_test_market_handler(ctx)
    }

    pub fn create_devnet_test_circle(ctx: Context<CreateDevnetTestCircle>, mandate_seed: Pubkey) -> Result<()> {
        instructions::test_market::create_test_circle_handler(ctx, mandate_seed)
    }

    pub fn buy_devnet_test_equity(ctx: Context<BuyDevnetTestEquity>, amount_usdc_raw: u64) -> Result<()> {
        instructions::test_market::buy_test_equity_handler(ctx, amount_usdc_raw)
    }

    // ---- redemption (moves value) -------------------------------------------

    pub fn initiate_redemption(ctx: Context<InitiateRedemption>, shares: u64) -> Result<()> {
        instructions::redemption::initiate_handler(ctx, shares)
    }

    pub fn reserve_redemption_asset(ctx: Context<ReserveRedemptionAsset>) -> Result<()> {
        instructions::redemption::reserve_asset_handler(ctx)
    }

    pub fn reserve_redemption_usdc(ctx: Context<ReserveRedemptionUsdc>) -> Result<()> {
        instructions::redemption::reserve_usdc_handler(ctx)
    }

    pub fn claim_redemption_asset(ctx: Context<ClaimRedemptionAsset>) -> Result<()> {
        instructions::redemption::claim_asset_handler(ctx)
    }

    pub fn claim_redemption_usdc(ctx: Context<ClaimRedemptionUsdc>) -> Result<()> {
        instructions::redemption::claim_usdc_handler(ctx)
    }
}
