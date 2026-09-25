//! Every failure branch listed in `docs/instructions.md` has a named error here,
//! and each becomes a named test (RULE 7).

use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum TenetError {
    // ---- arithmetic -------------------------------------------------------
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Arithmetic underflow")]
    MathUnderflow,
    #[msg("Division by zero")]
    DivisionByZero,

    // ---- mandate validation ----------------------------------------------
    #[msg("Mandate name is empty or too long")]
    InvalidMandateName,
    #[msg("Mandate description is too long")]
    InvalidMandateDescription,
    #[msg("A basis-point value exceeds 10000")]
    InvalidBps,
    #[msg("Minimum contribution must be greater than zero")]
    InvalidMinContribution,
    #[msg("Maximum pool size must exceed the minimum contribution")]
    InvalidMaxPoolSize,
    #[msg("Epoch duration is outside the permitted range")]
    InvalidEpochDuration,
    #[msg("Amendment threshold must be a supermajority")]
    InvalidAmendmentThreshold,
    #[msg("Amendment delay is below the minimum")]
    InvalidAmendmentDelay,
    #[msg("Mandate asset universe is empty")]
    EmptyAssetUniverse,
    #[msg("Target weights exceed 100%")]
    TargetWeightsExceedTotal,
    #[msg("Mandate is not in the required state")]
    InvalidMandateState,
    #[msg("Circle already holds the maximum number of assets")]
    TooManyAssets,

    // ---- authority --------------------------------------------------------
    #[msg("Signer is not the mandate author")]
    NotMandateAuthor,
    #[msg("Signer is not the member owner")]
    NotMemberOwner,
    #[msg("Signer is not the registry authority")]
    NotRegistryAuthority,

    // ---- account validation ----------------------------------------------
    /// Any cross-Circle, cross-mint or wrong-token-program substitution
    /// (INV-018). Tested by `test_account_substitution_rejected`.
    #[msg("Account does not belong to this circle")]
    AccountSubstitution,
    #[msg("Mint does not match the expected mint")]
    MintMismatch,
    #[msg("Token program does not own this mint")]
    TokenProgramMismatch,
    #[msg("USDC mint or decimals do not match the expected configuration")]
    UnexpectedUsdcMint,

    // ---- epoch lifecycle --------------------------------------------------
    #[msg("Epoch is not open for contributions")]
    EpochNotOpen,
    #[msg("Epoch has not closed yet")]
    EpochNotClosed,
    #[msg("Epoch has not been finalized")]
    EpochNotFinalized,
    #[msg("Epoch index does not follow the current epoch")]
    EpochIndexMismatch,
    #[msg("Previous epoch is not complete")]
    PreviousEpochIncomplete,
    #[msg("Contribution is below the mandate minimum")]
    BelowMinimumContribution,
    #[msg("Contribution would exceed the maximum pool size")]
    ExceedsMaxPoolSize,
    #[msg("Receipt has already been settled")]
    AlreadySettled,
    #[msg("Receipts remain unsettled")]
    UnsettledReceipts,

    // ---- valuation --------------------------------------------------------
    #[msg("NAV snapshot is incomplete")]
    NavSnapshotIncomplete,
    #[msg("NAV snapshot has expired")]
    NavSnapshotExpired,
    #[msg("Asset has already been recorded in this snapshot")]
    AssetAlreadyRecorded,
    #[msg("Circle NAV is zero; entrants cannot be priced")]
    ZeroNav,
    /// Distinct from `ZeroNav`: the Circle still has value, but too little to
    /// price shares sanely. Issuance is refused; exit is not (INV-014).
    #[msg("Circle NAV is below the minimum required to issue shares")]
    NavBelowIssuanceMinimum,
    #[msg("Price is stale")]
    StalePrice,
    #[msg("Price confidence interval is too wide")]
    PriceConfidenceTooWide,
    #[msg("Price feed id does not match the registry entry")]
    FeedIdMismatch,

    // ---- execution --------------------------------------------------------
    #[msg("Asset is not in the mandate universe")]
    AssetNotInMandate,
    #[msg("Execution is frozen while a redemption is unreserved")]
    ExecutionFrozen,
    #[msg("Execution would spend more than the unreserved balance")]
    InsufficientUnreservedBalance,
    #[msg("Execution received less than the minimum output")]
    BelowMinimumOutput,
    #[msg("Execution spent more than the maximum input")]
    AboveMaximumInput,
    #[msg("Execution breached the price impact cap")]
    PriceImpactTooHigh,
    #[msg("Execution breached a single-asset weight cap")]
    AssetWeightCapExceeded,
    #[msg("Execution breached the issuer weight cap")]
    IssuerWeightCapExceeded,
    #[msg("Execution breached the pre-IPO weight cap")]
    PreIpoWeightCapExceeded,
    #[msg("Execution authorization has expired")]
    AuthorizationExpired,
    #[msg("Execution authorization does not bind this circle")]
    AuthorizationCircleMismatch,
    #[msg("A non-Jupiter instruction appeared in the execution window")]
    UnexpectedInstructionInWindow,

    // ---- redemption -------------------------------------------------------
    #[msg("Member holds fewer shares than requested")]
    InsufficientShares,
    #[msg("Redemption amount must be greater than zero")]
    ZeroShares,
    #[msg("Asset has already been reserved for this redemption")]
    AlreadyReserved,
    #[msg("Asset has not been reserved for this redemption")]
    NotReserved,
    #[msg("Claim has already been settled")]
    AlreadyClaimed,
    #[msg("A NAV snapshot is open; redemption cannot start")]
    NavSnapshotOpen,

    // ---- fork / amendment -------------------------------------------------
    #[msg("Parent mandate must be active to fork")]
    ParentMandateNotActive,
    #[msg("Amendment has not met the required threshold")]
    AmendmentThresholdNotMet,
    #[msg("Amendment delay has not elapsed")]
    AmendmentDelayNotElapsed,
    #[msg("Member has already voted on this proposal")]
    AlreadyVoted,

    // Registry refresh introduced this error before the existing appended
    // config/mandate errors. Keep its historical position so observed error
    // codes remain stable for clients.
    #[msg("Live mint metadata is invalid or cannot be represented safely")]
    InvalidRegistryMetadata,

    // ---- appended in Phase 2 (append-only: existing codes must not shift) --
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Program data account does not belong to this program")]
    ProgramDataMismatch,
    #[msg("Symbol or display name is empty or too long")]
    InvalidRegistryString,
    #[msg("Asset class does not match the mint's token program or configured USDC mint")]
    AssetClassMismatch,
    #[msg("Registry entry is not active")]
    RegistryEntryInactive,
    #[msg("Weights on one underlying company exceed the Mandate's cap")]
    UnderlyingWeightCapExceeded,
    #[msg("Every Mandate asset and its registry entry must be supplied exactly once")]
    IncompleteMandateAssets,
    #[msg("The contribution window for this epoch has closed")]
    ContributionWindowClosed,
    #[msg("The contribution window is still open")]
    ContributionWindowStillOpen,
    #[msg("This Circle's membership policy does not admit this contributor")]
    MembershipPolicyRejected,
    #[msg("Rolling epochs require a NAV snapshot and are disabled until oracle pricing ships")]
    RollingEpochsDisabled,
    #[msg("Epoch escrow holds less than its receipts promise")]
    EscrowShortfall,
    #[msg("Another exit has unreserved assets; reserve them first (anyone may)")]
    RedemptionPending,
    #[msg("Asset was added after this redemption began and is not part of it")]
    AssetNotInSnapshot,
    #[msg("Every asset of this redemption is already reserved")]
    NothingToReserve,

    // ---- appended execution-boundary errors ------------------------------
    // Keep new codes at the end: existing clients and on-chain tests depend
    // on the append-only error numbering above.
    #[msg("The execution window did not contain a Jupiter swap and matching end instruction")]
    IncompleteExecutionWindow,
    #[msg("The source vault already has a delegate")]
    ExistingVaultDelegate,
    #[msg("The source vault balance increased during execution")]
    SourceBalanceIncreased,
    #[msg("The destination vault balance decreased during execution")]
    DestinationBalanceDecreased,
    #[msg("Execution price policy is unavailable; execution remains gated")]
    ExecutionPricePolicyUnavailable,
    #[msg("Circle holdings would exceed the Mandate's raw supply-consumption cap")]
    SupplyConsumptionCapExceeded,
    #[msg("The Pyth price observation is missing, stale, or insufficiently verified")]
    PriceObservationUnavailable,
    #[msg("The Pyth price must be strictly positive")]
    PriceNotPositive,
    #[msg("Price arithmetic exceeded the checked execution range")]
    PriceArithmeticOverflow,
    #[msg("Actual output is below the Mandate's Pyth price-impact floor")]
    PriceImpactExceeded,
    #[msg("An amendment proposal requires a current Circle member")]
    AmendmentRequiresMember,
    #[msg("The Circle share snapshot changed while the amendment was open")]
    AmendmentSnapshotChanged,
    #[msg("This amendment proposal has already executed")]
    AmendmentAlreadyExecuted,
    #[msg("This instruction is available only for the configured Devnet test-USDC mint")]
    DevnetTestMarketOnly,
    #[msg("The Circle must have exactly one permitted and configured test-equity asset")]
    TestEquityOnlyMandate,
    #[msg("The Devnet test-equity inventory is insufficient")]
    TestInventoryInsufficient,
    #[msg("Test-market purchase amount must be greater than zero")]
    InvalidTestPurchase,
}
