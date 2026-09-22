//! Epoch lifecycle — the first instructions that MOVE VALUE.
//!
//!   open_epoch → contribute* / cancel_contribution* → close_contributions
//!     → finalize_epoch → settle_contribution* → close_epoch
//!
//! Custody rules that hold throughout:
//! - Pending USDC lives in a per-epoch ESCROW, a different token account from
//!   the Circle's active vault. It is never spendable as Circle capital and
//!   confers no claim until settled (INV-002, INV-003).
//! - Only the `VaultAuthority` PDA signs transfers out of escrow or vaults.
//! - Contributing never mints shares. Shares are priced at finalization from
//!   values frozen on the Epoch, so settlement order cannot matter.
//!
//! Epoch 0 remains exact and oracle-free (A-19): with no shares outstanding,
//! shares equal micro-USDC contributed. Rolling epochs use the bounded Pyth NAV
//! snapshot path and can be cancelled safely if that path expires.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::TenetError;
use crate::math;
use crate::state::{
    Circle, CircleState, ContributionReceipt, Epoch, EpochState, Mandate, Member, MembershipPolicy,
    NavSnapshot,
};

/// Transfer out of a Circle-owned token account, signed by the VaultAuthority.
/// The single place the program signs as the VaultAuthority; used by epochs and
/// redemptions alike.
pub(crate) fn transfer_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    to: AccountInfo<'info>,
    vault_authority: AccountInfo<'info>,
    circle: &Pubkey,
    vault_authority_bump: u8,
    amount: u64,
) -> Result<()> {
    let bump = [vault_authority_bump];
    let seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, circle.as_ref(), &bump];
    let signer = &[seeds];
    let accounts = TransferChecked { from, mint: mint.to_account_info(), to, authority: vault_authority };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program.key(), accounts, signer),
        amount,
        mint.decimals,
    )
}

// ================================================================ open_epoch

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// `index == circle.current_epoch`, and `current_epoch` advances only in
    /// `close_epoch`. Together with the epoch PDA being unique per index, this
    /// means epochs open strictly in order, one at a time: epoch N+1 cannot open
    /// before N completes, and N cannot be opened twice.
    #[account(
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = index == circle.current_epoch @ TenetError::EpochIndexMismatch,
    )]
    pub circle: Account<'info, Circle>,

    #[account(address = circle.mandate @ TenetError::AccountSubstitution)]
    pub mandate: Account<'info, Mandate>,

    #[account(
        init,
        payer = payer,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub epoch: Account<'info, Epoch>,

    /// The Circle's active USDC vault fixes which mint is USDC for this Circle
    /// (it was checked against Config at creation).
    #[account(seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(address = active_usdc_vault.mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA with no data, verified by seeds and stored bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(constraint = token_program.key() == *usdc_mint.to_account_info().owner @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,

    /// Anchor performs this `init` (a CPI into `token_program`) while loading
    /// accounts, before the `TokenProgramMismatch` constraint above is checked.
    /// A wrong token program is therefore refused by the token program itself
    /// and the transaction reverts — see the module note in circle.rs.
    #[account(
        init,
        payer = payer,
        seeds = [EPOCH_ESCROW_SEED, circle.key().as_ref(), &index.to_le_bytes()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub epoch_escrow: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn open_epoch_handler(ctx: Context<OpenEpoch>, index: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let e = &mut ctx.accounts.epoch;
    e.circle = ctx.accounts.circle.key();
    e.index = index;
    e.opened_at = now;
    e.closes_at = now
        .checked_add(ctx.accounts.mandate.epoch_duration)
        .ok_or(TenetError::MathOverflow)?;
    e.state = EpochState::Open;
    e.pending_usdc_raw = 0;
    e.total_shares_before = 0;
    e.nav_before = 0;
    e.reserved_shares = 0;
    e.settled_shares = 0;
    e.receipt_count = 0;
    e.settled_count = 0;
    e.finalized_at = None;
    e.bump = ctx.bumps.epoch;
    Ok(())
}

// ================================================================ contribute

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = matches!(circle.state, CircleState::Funding | CircleState::Active)
            @ TenetError::InvalidMandateState,
    )]
    pub circle: Account<'info, Circle>,

    #[account(address = circle.mandate @ TenetError::AccountSubstitution)]
    pub mandate: Account<'info, Mandate>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        constraint = epoch.state == EpochState::Open @ TenetError::EpochNotOpen,
    )]
    pub epoch: Account<'info, Epoch>,

    /// One per contributor per epoch; repeat contributions add to it.
    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + ContributionReceipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, epoch.key().as_ref(), contributor.key().as_ref()],
        bump,
    )]
    pub receipt: Account<'info, ContributionReceipt>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_usdc: InterfaceAccount<'info, TokenAccount>,

    /// The ESCROW for this epoch — derived, never the active vault. A caller
    /// cannot route a contribution into active capital.
    #[account(
        mut,
        seeds = [EPOCH_ESCROW_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump,
    )]
    pub epoch_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Read for the pool-size cap.
    #[account(seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(address = epoch_escrow.mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(constraint = token_program.key() == *usdc_mint.to_account_info().owner @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

pub fn contribute_handler(ctx: Context<Contribute>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mandate = &ctx.accounts.mandate;
    let epoch = &mut ctx.accounts.epoch;

    require!(now < epoch.closes_at, TenetError::ContributionWindowClosed);
    // There is no invite mechanism yet, so an invite-only Circle admits no one.
    // Refusing is honest; silently treating it as open would not be.
    require!(
        mandate.membership_policy == MembershipPolicy::Open,
        TenetError::MembershipPolicyRejected
    );
    require!(amount >= mandate.min_contribution_usdc, TenetError::BelowMinimumContribution);

    // Pool cap: active capital + everything pending + this contribution.
    let after = ctx.accounts.active_usdc_vault.amount
        .checked_add(epoch.pending_usdc_raw)
        .and_then(|v| v.checked_add(amount))
        .ok_or(TenetError::MathOverflow)?;
    require!(after <= mandate.max_pool_size_usdc, TenetError::ExceedsMaxPoolSize);

    // Move the money first; the token program enforces the balance.
    let accounts = TransferChecked {
        from: ctx.accounts.contributor_usdc.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
        to: ctx.accounts.epoch_escrow.to_account_info(),
        authority: ctx.accounts.contributor.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), accounts),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let r = &mut ctx.accounts.receipt;
    if r.owner == Pubkey::default() {
        r.circle = ctx.accounts.circle.key();
        r.epoch = epoch.key();
        r.owner = ctx.accounts.contributor.key();
        r.shares_entitled = 0;
        r.settled = false;
        r.bump = ctx.bumps.receipt;
        epoch.receipt_count = epoch.receipt_count.checked_add(1).ok_or(TenetError::MathOverflow)?;
    }
    r.amount_usdc_raw = math::checked_add_u64(r.amount_usdc_raw, amount)?;
    epoch.pending_usdc_raw = math::checked_add_u64(epoch.pending_usdc_raw, amount)?;
    Ok(())
}

// ================================================================ cancel

/// No admin approval exists in this path (spec §10): a contributor recovers
/// pending USDC unilaterally while the epoch is Open, or after it is Cancelled.
#[derive(Accounts)]
pub struct CancelContribution<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        constraint = matches!(epoch.state, EpochState::Open | EpochState::Cancelled)
            @ TenetError::EpochNotOpen,
    )]
    pub epoch: Account<'info, Epoch>,

    #[account(
        mut,
        close = contributor,
        seeds = [RECEIPT_SEED, epoch.key().as_ref(), contributor.key().as_ref()],
        bump = receipt.bump,
        constraint = receipt.owner == contributor.key() @ TenetError::NotMemberOwner,
        constraint = !receipt.settled @ TenetError::AlreadySettled,
    )]
    pub receipt: Account<'info, ContributionReceipt>,

    #[account(
        mut,
        seeds = [EPOCH_ESCROW_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump,
    )]
    pub epoch_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Refund goes to an account the contributor controls, in USDC.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_usdc: InterfaceAccount<'info, TokenAccount>,

    #[account(address = epoch_escrow.mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA with no data; signs the refund.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(constraint = token_program.key() == *usdc_mint.to_account_info().owner @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn cancel_handler(ctx: Context<CancelContribution>) -> Result<()> {
    let amount = ctx.accounts.receipt.amount_usdc_raw;
    transfer_signed(
        &ctx.accounts.token_program,
        ctx.accounts.epoch_escrow.to_account_info(),
        &ctx.accounts.usdc_mint,
        ctx.accounts.contributor_usdc.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.circle.key(),
        ctx.accounts.circle.vault_authority_bump,
        amount,
    )?;
    let e = &mut ctx.accounts.epoch;
    e.pending_usdc_raw = math::checked_sub_u64(e.pending_usdc_raw, amount)?;
    e.receipt_count = e.receipt_count.checked_sub(1).ok_or(TenetError::MathUnderflow)?;
    // The receipt is closed by `close = contributor`, returning its rent.
    Ok(())
}

// ================================================================ close contributions

/// Permissionless once the window has passed.
#[derive(Accounts)]
pub struct CloseContributions<'info> {
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = epoch.state == EpochState::Open @ TenetError::EpochNotOpen,
    )]
    pub epoch: Account<'info, Epoch>,
}

pub fn close_contributions_handler(ctx: Context<CloseContributions>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let e = &mut ctx.accounts.epoch;
    require!(now >= e.closes_at, TenetError::ContributionWindowStillOpen);
    e.state = EpochState::Closed;
    Ok(())
}

// ================================================================ finalize

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        constraint = epoch.state == EpochState::Closed @ TenetError::EpochNotClosed,
    )]
    pub epoch: Account<'info, Epoch>,

    #[account(
        mut,
        seeds = [EPOCH_ESCROW_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump,
    )]
    pub epoch_escrow: InterfaceAccount<'info, TokenAccount>,

    /// Required only for rolling epochs. Epoch 0 intentionally remains
    /// oracle-free, so clients omit this account when `circle.total_shares ==
    /// 0`; the handler rejects a rolling finalization without it.
    #[account(mut, close = payer)]
    pub nav_snapshot: Option<Account<'info, NavSnapshot>>,

    #[account(mut, seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(address = epoch_escrow.mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA with no data; signs the sweep.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(constraint = token_program.key() == *usdc_mint.to_account_info().owner @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn finalize_epoch_handler(ctx: Context<FinalizeEpoch>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;

    // A-22 inflow guard (REVIEW.md H-02). An exit initiated before this sweep
    // snapshotted its share denominator BEFORE the new USDC arrived; letting it
    // reserve afterwards would hand it a slice of the newcomers' money. The
    // concrete case: a sole member redeems every share (total_shares -> 0, so
    // an epoch may open), newcomers contribute, and this sweep lands in the
    // vault the exit has not yet reserved against.
    require!(circle.pending_reservations == 0, TenetError::RedemptionPending);

    let epoch = &mut ctx.accounts.epoch;
    let pending = epoch.pending_usdc_raw;

    // The escrow must hold at least what the receipts promise. It can hold
    // MORE (anyone can send tokens to any account); the surplus is swept with
    // the rest and accrues to the new shareholders, never to one actor.
    require!(ctx.accounts.epoch_escrow.amount >= pending, TenetError::EscrowShortfall);

    let (shares_before, nav_before, reserved) = if circle.total_shares == 0 {
        // Epoch 0: shares = micro-USDC, exact, NAV unused (accounting.md §3).
        (0, 0, math::shares_for_contribution(pending, 0, 0)?)
    } else {
        let snapshot = ctx
            .accounts
            .nav_snapshot
            .as_ref()
            .ok_or_else(|| error!(TenetError::NavSnapshotIncomplete))?;
        require_keys_eq!(snapshot.circle, circle.key(), TenetError::AccountSubstitution);
        require_keys_eq!(snapshot.epoch, epoch.key(), TenetError::AccountSubstitution);
        require!(snapshot.assets_remaining == 0, TenetError::NavSnapshotIncomplete);
        let elapsed = Clock::get()?
            .slot
            .checked_sub(snapshot.slot_opened)
            .ok_or(TenetError::NavSnapshotExpired)?;
        require!(elapsed <= NAV_SNAPSHOT_MAX_SLOTS, TenetError::NavSnapshotExpired);
        require!(snapshot.nav_accum > 0, TenetError::ZeroNav);
        require!(
            snapshot.nav_accum >= MIN_NAV_FOR_ISSUANCE,
            TenetError::NavBelowIssuanceMinimum
        );
        let before = circle.total_shares;
        let reserved = math::shares_for_contribution(pending, before, snapshot.nav_accum)?;
        (before, snapshot.nav_accum, reserved)
    };
    epoch.total_shares_before = shares_before;
    epoch.nav_before = nav_before;
    epoch.reserved_shares = reserved;
    epoch.finalized_at = Some(Clock::get()?.unix_timestamp);
    epoch.state = EpochState::Finalized;
    circle.execution_frozen = false;

    circle.total_shares = math::checked_add_u64(circle.total_shares, reserved)?;
    circle.reserved_shares = math::checked_add_u64(circle.reserved_shares, reserved)?;
    if reserved > 0 {
        circle.state = CircleState::Active;
    }

    let sweep = ctx.accounts.epoch_escrow.amount;
    if sweep > 0 {
        transfer_signed(
            &ctx.accounts.token_program,
            ctx.accounts.epoch_escrow.to_account_info(),
            &ctx.accounts.usdc_mint,
            ctx.accounts.active_usdc_vault.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            &circle.key(),
            circle.vault_authority_bump,
            sweep,
        )?;
    }
    Ok(())
}

// ================================================================ settle

/// Permissionless: anyone may settle anyone's receipt; the shares always go to
/// the receipt's owner.
///
/// `circle` is writable only for `reserved_shares` (A-20). This instruction
/// never writes `total_shares` — settlement moves already-issued shares from
/// "reserved" to a member and cannot inflate the supply (spec §12).
#[derive(Accounts)]
pub struct SettleContribution<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        constraint = epoch.state == EpochState::Finalized @ TenetError::EpochNotFinalized,
    )]
    pub epoch: Account<'info, Epoch>,

    /// Closed on settlement, rent to its owner: a second settlement finds no
    /// account. Double settlement is impossible, not merely rejected.
    #[account(
        mut,
        close = owner,
        seeds = [RECEIPT_SEED, epoch.key().as_ref(), receipt.owner.as_ref()],
        bump = receipt.bump,
        constraint = !receipt.settled @ TenetError::AlreadySettled,
    )]
    pub receipt: Account<'info, ContributionReceipt>,

    /// CHECK: must equal `receipt.owner`; only receives the receipt's rent.
    #[account(mut, address = receipt.owner @ TenetError::NotMemberOwner)]
    pub owner: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, circle.key().as_ref(), receipt.owner.as_ref()],
        bump,
    )]
    pub member: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn settle_handler(ctx: Context<SettleContribution>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    let receipt = &mut ctx.accounts.receipt;

    // Both divisor inputs were frozen at finalization: reproducible forever and
    // independent of the order in which receipts are settled.
    let shares = math::shares_for_contribution(
        receipt.amount_usdc_raw,
        epoch.total_shares_before,
        epoch.nav_before,
    )?;
    receipt.shares_entitled = shares;
    receipt.settled = true;

    let m = &mut ctx.accounts.member;
    let was_new_member = m.owner == Pubkey::default();
    let was_zero_balance = !was_new_member && m.shares == 0;
    if was_new_member {
        m.circle = ctx.accounts.circle.key();
        m.owner = receipt.owner;
        m.shares = 0;
        m.contributed_basis_usdc = 0;
        m.joined_epoch = epoch.index;
        m.next_redemption_seq = 0;
        m.bump = ctx.bumps.member;
    }
    // A settled receipt can belong to an existing Member whose previous
    // balance was fully redeemed. Count active Members, not settlement events.
    if was_new_member || was_zero_balance {
        ctx.accounts.circle.member_count =
            ctx.accounts.circle.member_count.checked_add(1).ok_or(TenetError::MathOverflow)?;
    }
    m.shares = math::checked_add_u64(m.shares, shares)?;
    m.contributed_basis_usdc = math::checked_add_u64(m.contributed_basis_usdc, receipt.amount_usdc_raw)?;

    epoch.settled_shares = math::checked_add_u64(epoch.settled_shares, shares)?;
    epoch.settled_count = epoch.settled_count.checked_add(1).ok_or(TenetError::MathOverflow)?;
    let circle = &mut ctx.accounts.circle;
    circle.reserved_shares = math::checked_sub_u64(circle.reserved_shares, shares)?;
    Ok(())
}

// ================================================================ close epoch

#[derive(Accounts)]
pub struct CloseEpoch<'info> {
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        constraint = epoch.state == EpochState::Finalized @ TenetError::EpochNotFinalized,
        constraint = epoch.settled_count == epoch.receipt_count @ TenetError::UnsettledReceipts,
    )]
    pub epoch: Account<'info, Epoch>,
}

pub fn close_epoch_handler(ctx: Context<CloseEpoch>) -> Result<()> {
    let epoch = &mut ctx.accounts.epoch;
    let circle = &mut ctx.accounts.circle;

    // Release rounding residue: shares reserved at finalization that no receipt
    // received. Zero in Epoch 0, which is exact.
    let residue = math::checked_sub_u64(epoch.reserved_shares, epoch.settled_shares)?;
    circle.total_shares = math::checked_sub_u64(circle.total_shares, residue)?;
    circle.reserved_shares = math::checked_sub_u64(circle.reserved_shares, residue)?;

    epoch.state = EpochState::Completed;
    circle.current_epoch = epoch.index.checked_add(1).ok_or(TenetError::MathOverflow)?;
    Ok(())
}
