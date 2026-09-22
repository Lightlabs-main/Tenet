//! Mandate amendment governance.
//!
//! A proposal snapshots the Circle's effective share total. Votes are separate
//! PDAs, and the Circle must remain share-stable until execution. That makes a
//! late contribution or exit safe: it cannot change the electorate beneath an
//! already-open proposal; instead, the proposal must be replaced.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TenetError;
use crate::instructions::mandate::{validate_params, MandateParams};
use crate::state::{
    AmendmentProposal, AmendmentVote, Circle, CircleState, Mandate, MandateState, Member,
};

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ProposeAmendment<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        seeds = [CIRCLE_SEED, mandate.key().as_ref()],
        bump = circle.bump,
        constraint = circle.mandate == mandate.key() @ TenetError::AccountSubstitution,
        constraint = circle.state == CircleState::Active @ TenetError::InvalidMandateState,
        constraint = circle.total_shares > 0 @ TenetError::AmendmentRequiresMember,
        constraint = circle.reserved_shares == 0 @ TenetError::AmendmentSnapshotChanged,
        constraint = circle.pending_reservations == 0 @ TenetError::AmendmentSnapshotChanged,
        constraint = !circle.execution_frozen @ TenetError::AmendmentSnapshotChanged,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [MEMBER_SEED, circle.key().as_ref(), proposer.key().as_ref()],
        bump = member.bump,
        constraint = member.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = member.owner == proposer.key() @ TenetError::AccountSubstitution,
        constraint = member.shares > 0 @ TenetError::AmendmentRequiresMember,
    )]
    pub member: Account<'info, Member>,

    #[account(
        init,
        payer = proposer,
        space = 8 + AmendmentProposal::INIT_SPACE,
        seeds = [AMENDMENT_SEED, mandate.key().as_ref(), &proposal_id.to_le_bytes()],
        bump,
    )]
    pub proposal: Account<'info, AmendmentProposal>,

    pub system_program: Program<'info, System>,
}

pub fn propose_handler(
    ctx: Context<ProposeAmendment>,
    proposal_id: u64,
    params: MandateParams,
) -> Result<()> {
    validate_params(&params)?;
    let now = Clock::get()?.unix_timestamp;
    let mandate = &ctx.accounts.mandate;
    // The currently active constitution controls the delay for this proposal.
    // The proposed delay only takes effect after the proposal is approved, so
    // a proposal cannot shorten its own challenge window.
    let execute_after = now
        .checked_add(mandate.amendment_delay_seconds)
        .ok_or(TenetError::MathOverflow)?;
    let proposal = &mut ctx.accounts.proposal;

    proposal.mandate = mandate.key();
    proposal.circle = ctx.accounts.circle.key();
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.proposal_id = proposal_id;
    proposal.created_at = now;
    proposal.execute_after = execute_after;
    proposal.total_shares_at_proposal = ctx.accounts.circle.total_shares;
    proposal.for_shares = 0;
    proposal.executed = false;
    proposal.name = params.name;
    proposal.description = params.description;
    proposal.max_weight_per_asset_bps = params.max_weight_per_asset_bps;
    proposal.max_pre_ipo_weight_bps = params.max_pre_ipo_weight_bps;
    proposal.max_issuer_weight_bps = params.max_issuer_weight_bps;
    proposal.max_underlying_weight_bps = params.max_underlying_weight_bps;
    proposal.max_supply_consumption_bps = params.max_supply_consumption_bps;
    proposal.max_price_impact_bps = params.max_price_impact_bps;
    proposal.min_contribution_usdc = params.min_contribution_usdc;
    proposal.max_pool_size_usdc = params.max_pool_size_usdc;
    proposal.epoch_duration = params.epoch_duration;
    proposal.membership_policy = params.membership_policy;
    proposal.amendment_threshold_bps = params.amendment_threshold_bps;
    proposal.amendment_delay_seconds = params.amendment_delay_seconds;
    proposal.bump = ctx.bumps.proposal;
    Ok(())
}

#[derive(Accounts)]
pub struct VoteAmendment<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        mut,
        seeds = [AMENDMENT_SEED, proposal.mandate.as_ref(), &proposal.proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = !proposal.executed @ TenetError::AmendmentAlreadyExecuted,
    )]
    pub proposal: Account<'info, AmendmentProposal>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        constraint = mandate.key() == proposal.mandate @ TenetError::AccountSubstitution,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        seeds = [CIRCLE_SEED, mandate.key().as_ref()],
        bump = circle.bump,
        constraint = circle.key() == proposal.circle @ TenetError::AccountSubstitution,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [MEMBER_SEED, circle.key().as_ref(), voter.key().as_ref()],
        bump = member.bump,
        constraint = member.owner == voter.key() @ TenetError::AccountSubstitution,
        constraint = member.shares > 0 @ TenetError::AmendmentRequiresMember,
    )]
    pub member: Account<'info, Member>,

    #[account(
        init,
        payer = voter,
        space = 8 + AmendmentVote::INIT_SPACE,
        seeds = [AMENDMENT_VOTE_SEED, proposal.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, AmendmentVote>,

    pub system_program: Program<'info, System>,
}

pub fn vote_handler(ctx: Context<VoteAmendment>, support: bool) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    // Any share change invalidates the snapshot. This includes late settlement
    // and exits, so a proposal can never count a moving electorate.
    require!(
        ctx.accounts.circle.total_shares == proposal.total_shares_at_proposal,
        TenetError::AmendmentSnapshotChanged
    );
    let next_for = if support {
        proposal
            .for_shares
            .checked_add(ctx.accounts.member.shares)
            .ok_or(TenetError::MathOverflow)?
    } else {
        proposal.for_shares
    };
    require!(
        next_for <= proposal.total_shares_at_proposal,
        TenetError::AmendmentSnapshotChanged
    );
    proposal.for_shares = next_for;

    let vote = &mut ctx.accounts.vote;
    vote.proposal = proposal.key();
    vote.voter = ctx.accounts.voter.key();
    vote.shares = ctx.accounts.member.shares;
    vote.support = support;
    vote.bump = ctx.bumps.vote;
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteAmendment<'info> {
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [AMENDMENT_SEED, proposal.mandate.as_ref(), &proposal.proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = !proposal.executed @ TenetError::AmendmentAlreadyExecuted,
    )]
    pub proposal: Account<'info, AmendmentProposal>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        constraint = mandate.key() == proposal.mandate @ TenetError::AccountSubstitution,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
    )]
    pub mandate: Account<'info, Mandate>,

    #[account(
        seeds = [CIRCLE_SEED, mandate.key().as_ref()],
        bump = circle.bump,
        constraint = circle.key() == proposal.circle @ TenetError::AccountSubstitution,
    )]
    pub circle: Account<'info, Circle>,
}

pub fn execute_handler(ctx: Context<ExecuteAmendment>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;
    require!(
        now >= proposal.execute_after,
        TenetError::AmendmentDelayNotElapsed
    );
    require!(
        ctx.accounts.circle.total_shares == proposal.total_shares_at_proposal
            && ctx.accounts.circle.reserved_shares == 0
            && ctx.accounts.circle.pending_reservations == 0
            && !ctx.accounts.circle.execution_frozen,
        TenetError::AmendmentSnapshotChanged
    );

    let mandate = &mut ctx.accounts.mandate;
    let lhs = (proposal.for_shares as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(TenetError::MathOverflow)?;
    let rhs = (proposal.total_shares_at_proposal as u128)
        .checked_mul(mandate.amendment_threshold_bps as u128)
        .ok_or(TenetError::MathOverflow)?;
    require!(lhs >= rhs, TenetError::AmendmentThresholdNotMet);

    mandate.name = proposal.name.clone();
    mandate.description = proposal.description.clone();
    mandate.max_weight_per_asset_bps = proposal.max_weight_per_asset_bps;
    mandate.max_pre_ipo_weight_bps = proposal.max_pre_ipo_weight_bps;
    mandate.max_issuer_weight_bps = proposal.max_issuer_weight_bps;
    mandate.max_underlying_weight_bps = proposal.max_underlying_weight_bps;
    mandate.max_supply_consumption_bps = proposal.max_supply_consumption_bps;
    mandate.max_price_impact_bps = proposal.max_price_impact_bps;
    mandate.min_contribution_usdc = proposal.min_contribution_usdc;
    mandate.max_pool_size_usdc = proposal.max_pool_size_usdc;
    mandate.epoch_duration = proposal.epoch_duration;
    mandate.membership_policy = proposal.membership_policy;
    mandate.amendment_threshold_bps = proposal.amendment_threshold_bps;
    mandate.amendment_delay_seconds = proposal.amendment_delay_seconds;
    mandate.version = mandate
        .version
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    proposal.executed = true;
    Ok(())
}
