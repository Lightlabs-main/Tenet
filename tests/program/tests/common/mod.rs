//! Shared LiteSVM harness for on-chain tests against target/deploy/tenet.so.
#![allow(dead_code)]

use std::str::FromStr;

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
    ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use tenet::TenetError;

pub const USDC_DECIMALS: u8 = 6;

pub struct Env {
    pub svm: LiteSVM,
    /// Upgrade authority of the program, and fee payer for setup.
    pub admin: Keypair,
    pub registry_authority: Keypair,
    pub usdc_mint: Pubkey,
}

pub fn system_program() -> Pubkey {
    anchor_lang::system_program::ID
}

pub fn program_data_address() -> Pubkey {
    let loader = Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap();
    Pubkey::find_program_address(&[tenet::ID.as_ref()], &loader).0
}

/// LiteSVM deploys with `upgrade_authority_address: None`. Write one in, as a
/// real upgradeable deploy would have. Layout (bincode): u32 variant = 3,
/// u64 slot, then Option<Pubkey> as a 1-byte tag and 32 bytes.
pub fn set_upgrade_authority(svm: &mut LiteSVM, authority: &Pubkey) {
    let addr = program_data_address();
    let mut acc = svm.get_account(&addr).expect("program data exists");
    assert_eq!(
        u32::from_le_bytes(acc.data[0..4].try_into().unwrap()),
        3,
        "not ProgramData"
    );
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(addr, acc).unwrap();
}

/// An initialized SPL mint (base layout, 82 bytes), owned by `token_program`.
/// A Token-2022 mint without extensions has the same layout.
pub fn create_mint(svm: &mut LiteSVM, token_program: &Pubkey, decimals: u8) -> Pubkey {
    let mint = Keypair::new().pubkey();
    let mut data = vec![0u8; 82];
    // mint_authority: COption::None (4-byte tag 0) — left zeroed
    data[36..44].copy_from_slice(&1_000_000_000_000u64.to_le_bytes()); // supply
    data[44] = decimals;
    data[45] = 1; // is_initialized
    svm.set_account(
        mint,
        Account {
            lamports: 1_461_600,
            data,
            owner: *token_program,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    mint
}

pub fn token() -> Pubkey {
    anchor_spl::token::ID
}
pub fn token_2022() -> Pubkey {
    anchor_spl::token_2022::ID
}

pub fn funded(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

/// Program loaded, upgrade authority set, a classic 6-decimal USDC mint.
/// Config NOT initialized — `with_config` does that.
pub fn env() -> Env {
    let mut svm = LiteSVM::new();
    let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/tenet.so");
    svm.add_program_from_file(tenet::ID, so)
        .expect("load tenet.so");
    let admin = funded(&mut svm);
    let registry_authority = funded(&mut svm);
    set_upgrade_authority(&mut svm, &admin.pubkey());
    let usdc_mint = create_mint(&mut svm, &token(), USDC_DECIMALS);
    Env {
        svm,
        admin,
        registry_authority,
        usdc_mint,
    }
}

pub fn with_config() -> Env {
    let mut e = env();
    let ix = initialize_config_ix(
        &e.admin.pubkey(),
        &e.registry_authority.pubkey(),
        &e.usdc_mint,
    );
    let admin = e.admin.insecure_clone();
    send(&mut e.svm, &[ix], &admin, &[]).expect("config initializes");
    e
}

pub type TxResult = Result<litesvm::types::TransactionMetadata, String>;

/// Send one transaction. Expires the blockhash first so that two identical
/// transactions are never deduplicated as "already processed" — that would
/// hide the program's real rejection.
pub fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> TxResult {
    svm.expire_blockhash();
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let msg = Message::new(ixs, Some(&payer.pubkey()));
    let tx = Transaction::new(&signers, msg, svm.latest_blockhash());
    svm.send_transaction(tx)
        .map_err(|f| format!("{:?}\nlogs:\n{}", f.err, f.meta.logs.join("\n")))
}

/// Assert the transaction failed with exactly this Tenet error.
#[track_caller]
pub fn expect_err(r: TxResult, want: TenetError) {
    let code = u32::from(want);
    match r {
        Ok(_) => panic!("expected {want:?} ({code}), but the transaction succeeded"),
        Err(e) => assert!(
            e.contains(&format!("Custom({code})")),
            "expected {want:?} ({code}), got:\n{e}"
        ),
    }
}

/// Assert failure whose logs contain `needle` (for runtime / Anchor errors).
#[track_caller]
pub fn expect_log(r: TxResult, needle: &str) {
    match r {
        Ok(_) => panic!("expected failure containing {needle:?}, but it succeeded"),
        Err(e) => assert!(e.contains(needle), "expected {needle:?} in:\n{e}"),
    }
}

pub fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account exists");
    T::try_deserialize(&mut acc.data.as_slice()).expect("deserializes")
}

// ---------------------------------------------------------------- ix builders

/// The only legal Config for a given stablecoin (A-23): canonical USDC gets
/// the mainnet venues (Jupiter + Pyth); anything else is a devnet test
/// stablecoin and gets the tenet-devnet market and feeds.
pub fn config_params_for(usdc: &Pubkey, registry_authority: &Pubkey) -> tenet::ConfigParams {
    use tenet::state::{Network, PriceSource};
    if *usdc == tenet::CANONICAL_USDC_MINT {
        tenet::ConfigParams {
            registry_authority: *registry_authority,
            network: Network::Mainnet,
            execution_venue: tenet::JUPITER_PROGRAM_ID,
            price_source: PriceSource::Pyth,
            price_program: tenet::PYTH_RECEIVER_PROGRAM_ID,
            max_price_age_seconds: tenet::MAINNET_MAX_PRICE_AGE_SECONDS,
        }
    } else {
        tenet::ConfigParams {
            registry_authority: *registry_authority,
            network: Network::Devnet,
            execution_venue: tenet_devnet::ID,
            price_source: PriceSource::DevnetFeed,
            price_program: tenet_devnet::ID,
            max_price_age_seconds: tenet::DEVNET_MAX_PRICE_AGE_SECONDS,
        }
    }
}

pub fn initialize_config_ix(
    authority: &Pubkey,
    registry_authority: &Pubkey,
    usdc: &Pubkey,
) -> Instruction {
    initialize_config_ix_with(authority, usdc, config_params_for(usdc, registry_authority))
}

pub fn initialize_config_ix_with(
    authority: &Pubkey,
    usdc: &Pubkey,
    params: tenet::ConfigParams,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::InitializeConfig {
            upgrade_authority: *authority,
            config: tenet::pda::config().0,
            program: tenet::ID,
            program_data: program_data_address(),
            usdc_mint: *usdc,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::InitializeConfig { params }.data(),
    }
}

pub fn registry_params(
    class: tenet::state::AssetClass,
    issuer: u8,
    underlying: u8,
) -> tenet::RegistryParams {
    tenet::RegistryParams {
        asset_class: class,
        issuer: Pubkey::new_from_array([issuer; 32]),
        underlying_id: [underlying; 16],
        symbol: "SPCXx".into(),
        display_name: "SpaceX (Backed)".into(),
        pyth_feed_tokenized: [0; 32],
        pyth_feed_underlying: [0; 32],
        status: tenet::state::AssetStatus::Active,
    }
}

pub fn upsert_ix(authority: &Pubkey, mint: &Pubkey, params: tenet::RegistryParams) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::UpsertRegistryEntry {
            registry_authority: *authority,
            config: tenet::pda::config().0,
            registry_entry: tenet::pda::registry(mint).0,
            mint: *mint,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::UpsertRegistryEntry { params }.data(),
    }
}

pub fn refresh_metadata_ix(payer: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::RefreshAssetMetadata {
            payer: *payer,
            registry_entry: tenet::pda::registry(mint).0,
            mint: *mint,
        }
        .to_account_metas(None),
        data: tenet::instruction::RefreshAssetMetadata {}.data(),
    }
}

pub fn mandate_params() -> tenet::MandateParams {
    tenet::MandateParams {
        name: "Frontier Tech".into(),
        description: "Pre-IPO and public frontier technology".into(),
        max_weight_per_asset_bps: 4_000,
        max_pre_ipo_weight_bps: 3_000,
        max_issuer_weight_bps: 6_000,
        max_underlying_weight_bps: 5_000,
        max_supply_consumption_bps: 100,
        max_price_impact_bps: 100,
        min_contribution_usdc: 1_000_000,
        max_pool_size_usdc: 100_000_000_000,
        epoch_duration: 7 * 24 * 60 * 60,
        membership_policy: tenet::state::MembershipPolicy::Open,
        amendment_threshold_bps: 6_667,
        amendment_delay_seconds: tenet::MIN_AMENDMENT_DELAY_SECONDS,
    }
}

pub fn create_mandate_ix(
    author: &Pubkey,
    seed: &Pubkey,
    params: tenet::MandateParams,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CreateMandate {
            author: *author,
            mandate_seed: *seed,
            mandate: tenet::pda::mandate(seed).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::CreateMandate { params }.data(),
    }
}

pub fn add_asset_ix(
    author: &Pubkey,
    mandate: &Pubkey,
    mint: &Pubkey,
    target_weight_bps: u16,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::AddMandateAsset {
            author: *author,
            mandate: *mandate,
            mandate_asset: tenet::pda::mandate_asset(mandate, mint).0,
            registry_entry: tenet::pda::registry(mint).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::AddMandateAsset { target_weight_bps }.data(),
    }
}

pub fn fork_ix(
    forker: &Pubkey,
    parent: &Pubkey,
    seed: &Pubkey,
    params: tenet::MandateParams,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ForkMandate {
            forker: *forker,
            parent_mandate: *parent,
            new_mandate_seed: *seed,
            new_mandate: tenet::pda::mandate(seed).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::ForkMandate { params }.data(),
    }
}

pub fn fork_asset_ix(
    forker: &Pubkey,
    parent: &Pubkey,
    child: &Pubkey,
    mint: &Pubkey,
    target_weight_bps: u16,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ForkMandateAsset {
            forker: *forker,
            parent_mandate: *parent,
            mint: *mint,
            parent_asset: tenet::pda::mandate_asset(parent, mint).0,
            new_mandate: *child,
            new_asset: tenet::pda::mandate_asset(child, mint).0,
            registry_entry: tenet::pda::registry(mint).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::ForkMandateAsset { target_weight_bps }.data(),
    }
}

/// `pairs` = (mandate_asset, registry_entry) passed as remaining accounts.
pub fn finalize_ix(author: &Pubkey, mandate: &Pubkey, pairs: &[(Pubkey, Pubkey)]) -> Instruction {
    let mut accounts = tenet::accounts::FinalizeMandate {
        author: *author,
        mandate: *mandate,
    }
    .to_account_metas(None);
    for (a, r) in pairs {
        accounts
            .push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*a, false));
        accounts
            .push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*r, false));
    }
    Instruction {
        program_id: tenet::ID,
        accounts,
        data: tenet::instruction::FinalizeMandate {}.data(),
    }
}

/// Register a Token-2022 equity mint and return it.
pub fn register_equity(
    e: &mut Env,
    class: tenet::state::AssetClass,
    issuer: u8,
    underlying: u8,
) -> Pubkey {
    let mint = create_mint(&mut e.svm, &token_2022(), 9);
    let ra = e.registry_authority.insecure_clone();
    send(
        &mut e.svm,
        &[upsert_ix(
            &ra.pubkey(),
            &mint,
            registry_params(class, issuer, underlying),
        )],
        &ra,
        &[],
    )
    .expect("register equity");
    mint
}

// ---------------------------------------------------------------- fixtures

/// Load a mainnet mint snapshot from tests/fixtures/mints/<symbol>.json into
/// the VM at its real address, byte for byte. Returns the mint address.
pub fn load_mint_fixture(svm: &mut LiteSVM, symbol: &str) -> Pubkey {
    use base64::Engine;
    let path = format!(
        "{}/../fixtures/mints/{symbol}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {path}"));
    let f: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let address = Pubkey::from_str(f["address"].as_str().unwrap()).unwrap();
    let owner = Pubkey::from_str(f["owner"].as_str().unwrap()).unwrap();
    let data = base64::engine::general_purpose::STANDARD
        .decode(f["data_base64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        data.len() as u64,
        f["data_len"].as_u64().unwrap(),
        "{symbol} fixture length"
    );
    svm.set_account(
        address,
        Account {
            lamports: f["lamports"].as_u64().unwrap(),
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    address
}

/// Like `with_config`, but Config points at the REAL USDC mint (mainnet
/// snapshot). Needed wherever the token program actually runs against it.
pub fn with_real_usdc_config() -> Env {
    let mut svm = LiteSVM::new();
    let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/tenet.so");
    svm.add_program_from_file(tenet::ID, so)
        .expect("load tenet.so");
    let admin = funded(&mut svm);
    let registry_authority = funded(&mut svm);
    set_upgrade_authority(&mut svm, &admin.pubkey());
    let usdc_mint = load_mint_fixture(&mut svm, "USDC");
    let ix = initialize_config_ix(&admin.pubkey(), &registry_authority.pubkey(), &usdc_mint);
    send(&mut svm, &[ix], &admin, &[]).expect("config with real USDC");
    Env {
        svm,
        admin,
        registry_authority,
        usdc_mint,
    }
}

/// Register a fixture mint under the given class.
pub fn register_fixture(
    e: &mut Env,
    symbol: &str,
    class: tenet::state::AssetClass,
    issuer: u8,
    underlying: u8,
) -> Pubkey {
    let mint = load_mint_fixture(&mut e.svm, symbol);
    let ra = e.registry_authority.insecure_clone();
    let mut p = registry_params(class, issuer, underlying);
    p.symbol = symbol.into();
    p.display_name = symbol.into();
    send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &mint, p)], &ra, &[])
        .unwrap_or_else(|err| panic!("register {symbol}: {err}"));
    mint
}

// ---------------------------------------------------------------- amendments

pub fn propose_amendment_ix(
    proposer: &Pubkey,
    mandate: &Pubkey,
    circle: &Pubkey,
    proposal_id: u64,
    params: tenet::MandateParams,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ProposeAmendment {
            proposer: *proposer,
            mandate: *mandate,
            circle: *circle,
            member: tenet::pda::member(circle, proposer).0,
            proposal: tenet::pda::amendment(mandate, proposal_id).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::ProposeAmendment {
            proposal_id,
            params,
        }
        .data(),
    }
}

pub fn vote_amendment_ix(
    voter: &Pubkey,
    mandate: &Pubkey,
    circle: &Pubkey,
    proposal_id: u64,
    support: bool,
) -> Instruction {
    let proposal = tenet::pda::amendment(mandate, proposal_id).0;
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::VoteAmendment {
            voter: *voter,
            proposal,
            mandate: *mandate,
            circle: *circle,
            member: tenet::pda::member(circle, voter).0,
            vote: tenet::pda::amendment_vote(&proposal, voter).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::VoteAmendment { support }.data(),
    }
}

pub fn execute_amendment_ix(
    executor: &Pubkey,
    mandate: &Pubkey,
    circle: &Pubkey,
    proposal_id: u64,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ExecuteAmendment {
            executor: *executor,
            proposal: tenet::pda::amendment(mandate, proposal_id).0,
            mandate: *mandate,
            circle: *circle,
        }
        .to_account_metas(None),
        data: tenet::instruction::ExecuteAmendment {}.data(),
    }
}

// ---------------------------------------------------------------- circle

pub fn create_circle_ix(
    creator: &Pubkey,
    mandate: &Pubkey,
    usdc_mint: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let circle = tenet::pda::circle(mandate).0;
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CreateCircle {
            creator: *creator,
            config: tenet::pda::config().0,
            mandate: *mandate,
            circle,
            vault_authority: tenet::pda::vault_authority(&circle).0,
            active_usdc_vault: tenet::pda::usdc_vault(&circle).0,
            usdc_mint: *usdc_mint,
            token_program: *token_program,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::CreateCircle {}.data(),
    }
}

pub fn add_circle_asset_ix(
    payer: &Pubkey,
    circle: &Pubkey,
    mandate_asset: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::AddCircleAsset {
            payer: *payer,
            circle: *circle,
            mandate_asset: *mandate_asset,
            circle_asset: tenet::pda::circle_asset(circle, mint).0,
            vault: tenet::pda::asset_vault(circle, mint).0,
            vault_authority: tenet::pda::vault_authority(circle).0,
            mint: *mint,
            token_program: *token_program,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::AddCircleAsset {}.data(),
    }
}

// ---------------------------------------------------------------- tokens & time

/// A classic SPL token account (165 bytes) for `owner`, holding `amount` of
/// `mint`. Written directly: real USDC cannot be minted in a test, but the
/// token program will move these balances exactly as it would real ones.
pub fn token_account_with(svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
    let key = Keypair::new().pubkey();
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // AccountState::Initialized
    svm.set_account(
        key,
        Account {
            lamports: 2_039_280,
            data,
            owner: token(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    key
}

pub fn token_balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    let acc = svm.get_account(key).expect("token account exists");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<anchor_lang::prelude::Clock>()
        .unix_timestamp
}

/// Move the clock to `unix_timestamp`.
pub fn warp_to(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut c = svm.get_sysvar::<anchor_lang::prelude::Clock>();
    c.unix_timestamp = unix_timestamp;
    c.slot += 1;
    svm.set_sysvar(&c);
}

// ---------------------------------------------------------------- epoch

pub fn epoch_key(circle: &Pubkey, index: u64) -> Pubkey {
    tenet::pda::epoch(circle, index).0
}

pub fn open_epoch_ix(
    payer: &Pubkey,
    circle: &Pubkey,
    mandate: &Pubkey,
    usdc: &Pubkey,
    index: u64,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::OpenEpoch {
            payer: *payer,
            circle: *circle,
            mandate: *mandate,
            epoch: epoch_key(circle, index),
            epoch_escrow: tenet::pda::epoch_escrow(circle, index).0,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            usdc_mint: *usdc,
            vault_authority: tenet::pda::vault_authority(circle).0,
            token_program: token(),
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::OpenEpoch { index }.data(),
    }
}

/// `escrow` is normally the derived epoch escrow; tests pass other accounts to
/// prove a contribution cannot be routed elsewhere.
pub fn contribute_ix_to(
    contributor: &Pubkey,
    circle: &Pubkey,
    mandate: &Pubkey,
    usdc: &Pubkey,
    index: u64,
    from: &Pubkey,
    escrow: &Pubkey,
    amount: u64,
) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::Contribute {
            contributor: *contributor,
            circle: *circle,
            mandate: *mandate,
            epoch,
            receipt: tenet::pda::receipt(&epoch, contributor).0,
            contributor_usdc: *from,
            epoch_escrow: *escrow,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            usdc_mint: *usdc,
            token_program: token(),
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::Contribute { amount }.data(),
    }
}

pub fn contribute_ix(
    contributor: &Pubkey,
    circle: &Pubkey,
    mandate: &Pubkey,
    usdc: &Pubkey,
    index: u64,
    from: &Pubkey,
    amount: u64,
) -> Instruction {
    let escrow = tenet::pda::epoch_escrow(circle, index).0;
    contribute_ix_to(
        contributor,
        circle,
        mandate,
        usdc,
        index,
        from,
        &escrow,
        amount,
    )
}

pub fn cancel_ix(
    contributor: &Pubkey,
    circle: &Pubkey,
    usdc: &Pubkey,
    index: u64,
    to: &Pubkey,
) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CancelContribution {
            contributor: *contributor,
            circle: *circle,
            epoch,
            receipt: tenet::pda::receipt(&epoch, contributor).0,
            epoch_escrow: tenet::pda::epoch_escrow(circle, index).0,
            contributor_usdc: *to,
            usdc_mint: *usdc,
            vault_authority: tenet::pda::vault_authority(circle).0,
            token_program: token(),
        }
        .to_account_metas(None),
        data: tenet::instruction::CancelContribution {}.data(),
    }
}

pub fn close_contributions_ix(payer: &Pubkey, circle: &Pubkey, index: u64) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CloseContributions {
            payer: *payer,
            epoch: epoch_key(circle, index),
        }
        .to_account_metas(None),
        data: tenet::instruction::CloseContributions {}.data(),
    }
}

pub fn finalize_epoch_ix(
    payer: &Pubkey,
    circle: &Pubkey,
    usdc: &Pubkey,
    index: u64,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::FinalizeEpoch {
            payer: *payer,
            circle: *circle,
            epoch: epoch_key(circle, index),
            epoch_escrow: tenet::pda::epoch_escrow(circle, index).0,
            nav_snapshot: None,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            usdc_mint: *usdc,
            vault_authority: tenet::pda::vault_authority(circle).0,
            token_program: token(),
        }
        .to_account_metas(None),
        data: tenet::instruction::FinalizeEpoch {}.data(),
    }
}

pub fn cancel_epoch_ix(payer: &Pubkey, circle: &Pubkey, index: u64) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CancelEpoch {
            payer: *payer,
            circle: *circle,
            epoch: epoch_key(circle, index),
            nav_snapshot: None,
        }
        .to_account_metas(None),
        data: tenet::instruction::CancelEpoch {}.data(),
    }
}

pub fn settle_ix(payer: &Pubkey, circle: &Pubkey, index: u64, owner: &Pubkey) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::SettleContribution {
            payer: *payer,
            circle: *circle,
            epoch,
            receipt: tenet::pda::receipt(&epoch, owner).0,
            owner: *owner,
            member: tenet::pda::member(circle, owner).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::SettleContribution {}.data(),
    }
}

pub fn close_epoch_ix(payer: &Pubkey, circle: &Pubkey, index: u64) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CloseEpoch {
            payer: *payer,
            circle: *circle,
            epoch: epoch_key(circle, index),
        }
        .to_account_metas(None),
        data: tenet::instruction::CloseEpoch {}.data(),
    }
}

pub fn begin_execution_ix(
    executor: &Pubkey,
    circle: &Pubkey,
    mandate: &Pubkey,
    epoch: &Pubkey,
    mandate_asset_out: &Pubkey,
    out_mint: &Pubkey,
    nonce: u64,
    max_in: u64,
    min_out: u64,
    expires_at: i64,
) -> Instruction {
    let circle_asset_out = tenet::pda::circle_asset(circle, out_mint).0;
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::BeginExecution {
            executor: *executor,
            circle: *circle,
            mandate: *mandate,
            config: tenet::pda::config().0,
            epoch: *epoch,
            mandate_asset_out: *mandate_asset_out,
            circle_asset_out,
            source_vault: tenet::pda::usdc_vault(circle).0,
            dest_vault: tenet::pda::asset_vault(circle, out_mint).0,
            in_mint: Pubkey::default(), // replaced by the caller below
            out_mint: *out_mint,
            source_token_program: token(),
            dest_token_program: token_2022(),
            vault_authority: tenet::pda::vault_authority(circle).0,
            execution_auth: tenet::pda::exec_auth(circle, epoch, nonce).0,
            instructions_sysvar: solana_instructions_sysvar::ID,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::BeginExecution {
            nonce,
            max_in,
            min_out,
            expires_at,
        }
        .data(),
    }
}

// ---------------------------------------------------------------- redemption

/// Overwrite a token account's `amount` (base layout offset 64, identical for
/// classic and Token-2022). Used to simulate holdings: execution is Phase 4,
/// and an exit's entitlement depends only on vault balances.
pub fn set_token_amount(svm: &mut LiteSVM, key: &Pubkey, amount: u64) {
    let mut acc = svm.get_account(key).expect("token account");
    acc.data[64..72].copy_from_slice(&amount.to_le_bytes());
    svm.set_account(*key, acc).unwrap();
}

/// Set a token account's state byte (offset 108): 1 Initialized, 2 Frozen.
pub fn set_token_state(svm: &mut LiteSVM, key: &Pubkey, state: u8) {
    let mut acc = svm.get_account(key).expect("token account");
    acc.data[108] = state;
    svm.set_account(*key, acc).unwrap();
}

/// A token account for `owner` with EXACTLY the layout of `template` (same
/// program, mint and extensions), empty. Cloning a real vault gives a member
/// account carrying whatever account-side extensions the real mint requires.
pub fn clone_token_account_for(svm: &mut LiteSVM, template: &Pubkey, owner: &Pubkey) -> Pubkey {
    let mut acc = svm.get_account(template).expect("template");
    acc.data[32..64].copy_from_slice(owner.as_ref());
    acc.data[64..72].copy_from_slice(&0u64.to_le_bytes());
    // A delegate or close authority on the template must not carry over.
    acc.data[72..108].fill(0);
    acc.data[108] = 1;
    acc.data[129..165].fill(0);
    let key = Keypair::new().pubkey();
    svm.set_account(key, acc).unwrap();
    key
}

pub fn redemption_key(circle: &Pubkey, owner: &Pubkey, seq: u64) -> Pubkey {
    tenet::pda::redemption(circle, owner, seq).0
}

pub fn initiate_redemption_ix(
    owner: &Pubkey,
    circle: &Pubkey,
    seq: u64,
    shares: u64,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::InitiateRedemption {
            member_owner: *owner,
            circle: *circle,
            member: tenet::pda::member(circle, owner).0,
            redemption: redemption_key(circle, owner, seq),
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::InitiateRedemption { shares }.data(),
    }
}

pub fn reserve_asset_ix(
    payer: &Pubkey,
    circle: &Pubkey,
    redemption: &Pubkey,
    mint: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ReserveRedemptionAsset {
            payer: *payer,
            circle: *circle,
            redemption: *redemption,
            circle_asset: tenet::pda::circle_asset(circle, mint).0,
            vault: tenet::pda::asset_vault(circle, mint).0,
            redemption_asset: tenet::pda::redemption_asset(redemption, mint).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::ReserveRedemptionAsset {}.data(),
    }
}

pub fn reserve_usdc_ix(
    payer: &Pubkey,
    circle: &Pubkey,
    redemption: &Pubkey,
    usdc: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ReserveRedemptionUsdc {
            payer: *payer,
            circle: *circle,
            redemption: *redemption,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            redemption_asset: tenet::pda::redemption_asset(redemption, usdc).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::ReserveRedemptionUsdc {}.data(),
    }
}

pub fn claim_asset_ix(
    owner: &Pubkey,
    circle: &Pubkey,
    redemption: &Pubkey,
    mint: &Pubkey,
    to: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ClaimRedemptionAsset {
            member_owner: *owner,
            circle: *circle,
            redemption: *redemption,
            circle_asset: tenet::pda::circle_asset(circle, mint).0,
            redemption_asset: tenet::pda::redemption_asset(redemption, mint).0,
            vault: tenet::pda::asset_vault(circle, mint).0,
            mint: *mint,
            token_program: token_2022(),
            member_token_account: *to,
            vault_authority: tenet::pda::vault_authority(circle).0,
        }
        .to_account_metas(None),
        data: tenet::instruction::ClaimRedemptionAsset {}.data(),
    }
}

pub fn claim_usdc_ix(
    owner: &Pubkey,
    circle: &Pubkey,
    redemption: &Pubkey,
    usdc: &Pubkey,
    to: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::ClaimRedemptionUsdc {
            member_owner: *owner,
            circle: *circle,
            redemption: *redemption,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            redemption_asset: tenet::pda::redemption_asset(redemption, usdc).0,
            usdc_mint: *usdc,
            token_program: token(),
            member_usdc: *to,
            vault_authority: tenet::pda::vault_authority(circle).0,
        }
        .to_account_metas(None),
        data: tenet::instruction::ClaimRedemptionUsdc {}.data(),
    }
}

/// Create a Draft mandate authored by a fresh wallet. Returns (author, mandate).
pub fn draft_mandate(e: &mut Env) -> (Keypair, Pubkey) {
    draft_mandate_with(e, mandate_params())
}

pub fn draft_mandate_with(e: &mut Env, params: tenet::MandateParams) -> (Keypair, Pubkey) {
    let author = funded(&mut e.svm);
    let seed = Keypair::new().pubkey();
    send(
        &mut e.svm,
        &[create_mandate_ix(&author.pubkey(), &seed, params)],
        &author,
        &[],
    )
    .expect("create mandate");
    (author, tenet::pda::mandate(&seed).0)
}
