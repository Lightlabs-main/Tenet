//! Devnet end to end, in process: the real `tenet.so` and `tenet_devnet.so`,
//! real Token-2022 instruments (one with a transfer fee, one with
//! ScaledUiAmount, mixed decimals), real TUSDC from the faucet, and real
//! token movements through the devnet market inside Tenet's execution window.
//!
//! POOL -> EXECUTE -> VALUE -> EXIT -> FORK, with no balance written by hand:
//! every token that moves here is moved by a token program.

mod common;

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, Discriminator, InstructionData,
    ToAccountMetas,
};
use anchor_spl::token_2022::spl_token_2022 as t22;
use common::*;
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use t22::extension::ExtensionType;
use tenet::state::{AssetClass, AssetStatus, Circle, Epoch, Mandate, Member, MembershipPolicy};
use tenet::TenetError;
use tenet_devnet::{DevnetError, FeedPrices};

const TUSDC: u64 = 1_000_000;
const DAY: i64 = 86_400;
const SPREAD_BPS: u16 = 30;
/// Tokens minted into each market's inventory (economic units).
const INVENTORY_UNITS: u64 = 1_000_000;

// ================================================================ devnet program

fn loader() -> Pubkey {
    "BPFLoaderUpgradeab1e11111111111111111111111".parse().unwrap()
}

fn program_data_for(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &loader()).0
}

/// Same as `common::set_upgrade_authority`, for any program.
fn set_authority(svm: &mut LiteSVM, program: &Pubkey, authority: &Pubkey) {
    let addr = program_data_for(program);
    let mut acc = svm.get_account(&addr).expect("program data");
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(addr, acc).unwrap();
}

fn dpda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &tenet_devnet::ID).0
}
fn admin_pda() -> Pubkey {
    dpda(&[tenet_devnet::ADMIN_SEED])
}
fn faucet_pda() -> Pubkey {
    dpda(&[tenet_devnet::FAUCET_SEED])
}
fn tusdc_pda() -> Pubkey {
    dpda(&[tenet_devnet::TUSDC_MINT_SEED])
}
fn feed_pda(mint: &Pubkey) -> Pubkey {
    dpda(&[tenet_devnet::FEED_SEED, mint.as_ref()])
}
fn market_pda(mint: &Pubkey) -> Pubkey {
    dpda(&[tenet_devnet::MARKET_SEED, mint.as_ref()])
}
fn inventory_pda(mint: &Pubkey) -> Pubkey {
    dpda(&[tenet_devnet::INVENTORY_SEED, mint.as_ref()])
}
fn market_usdc_pda(mint: &Pubkey) -> Pubkey {
    dpda(&[tenet_devnet::MARKET_USDC_SEED, mint.as_ref()])
}

fn dix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: tenet_devnet::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn devnet_initialize_ix(authority: &Pubkey, operator: &Pubkey) -> Instruction {
    dix(
        tenet_devnet::accounts::Initialize {
            upgrade_authority: *authority,
            program: tenet_devnet::ID,
            program_data: program_data_for(&tenet_devnet::ID),
            admin: admin_pda(),
            faucet: faucet_pda(),
            tusdc_mint: tusdc_pda(),
            token_program: token(),
            system_program: system_program(),
        },
        tenet_devnet::instruction::Initialize { operator: *operator },
    )
}

fn request_tusdc_ix(owner: &Pubkey, destination: &Pubkey) -> Instruction {
    dix(
        tenet_devnet::accounts::RequestTusdc {
            owner: *owner,
            faucet: faucet_pda(),
            claim: dpda(&[tenet_devnet::CLAIM_SEED, owner.as_ref()]),
            tusdc_mint: tusdc_pda(),
            destination: *destination,
            token_program: token(),
            system_program: system_program(),
        },
        tenet_devnet::instruction::RequestTusdc {},
    )
}

fn prices(price: i64, reference_mark: i64, underlying_price: i64) -> FeedPrices {
    FeedPrices { price, conf: 0, reference_mark, underlying_price }
}

fn create_feed_ix(operator: &Pubkey, mint: &Pubkey, symbol: &str, p: FeedPrices) -> Instruction {
    dix(
        tenet_devnet::accounts::CreateFeed {
            operator: *operator,
            admin: admin_pda(),
            mint: *mint,
            feed: feed_pda(mint),
            system_program: system_program(),
        },
        tenet_devnet::instruction::CreateFeed { symbol: symbol.into(), prices: p },
    )
}

fn update_feed_ix(operator: &Pubkey, mint: &Pubkey, p: FeedPrices) -> Instruction {
    dix(
        tenet_devnet::accounts::UpdateFeed { operator: *operator, admin: admin_pda(), feed: feed_pda(mint) },
        tenet_devnet::instruction::UpdateFeed { prices: p },
    )
}

fn create_market_ix(operator: &Pubkey, mint: &Pubkey) -> Instruction {
    dix(
        tenet_devnet::accounts::CreateMarket {
            operator: *operator,
            admin: admin_pda(),
            mint: *mint,
            feed: feed_pda(mint),
            market: market_pda(mint),
            inventory: inventory_pda(mint),
            tusdc_mint: tusdc_pda(),
            usdc_vault: market_usdc_pda(mint),
            token_program: token_2022(),
            usdc_token_program: token(),
            system_program: system_program(),
        },
        tenet_devnet::instruction::CreateMarket { spread_bps: SPREAD_BPS },
    )
}

fn set_spread_ix(operator: &Pubkey, mint: &Pubkey, spread_bps: u16) -> Instruction {
    dix(
        tenet_devnet::accounts::SetSpread { operator: *operator, admin: admin_pda(), market: market_pda(mint) },
        tenet_devnet::instruction::SetSpread { spread_bps },
    )
}

fn buy_ix(payer: &Pubkey, mint: &Pubkey, source: &Pubkey, destination: &Pubkey, amount_in: u64, min_out: u64) -> Instruction {
    dix(
        tenet_devnet::accounts::Buy {
            payer: *payer,
            admin: admin_pda(),
            market: market_pda(mint),
            feed: feed_pda(mint),
            inventory: inventory_pda(mint),
            usdc_vault: market_usdc_pda(mint),
            source: *source,
            destination: *destination,
            mint: *mint,
            tusdc_mint: tusdc_pda(),
            asset_token_program: token_2022(),
            usdc_token_program: token(),
        },
        tenet_devnet::instruction::Buy { amount_in_raw: amount_in, min_out_raw: min_out },
    )
}

// ================================================================ instruments

#[derive(Clone, Copy)]
enum Ext {
    None,
    TransferFee(u16),
    ScaledUi,
}

struct Instrument {
    symbol: &'static str,
    name: &'static str,
    class: AssetClass,
    decimals: u8,
    ext: Ext,
    price: i64,
    mark: i64,
    underlying: i64,
    target_bps: u16,
    mint: Pubkey,
}

fn catalog() -> Vec<Instrument> {
    let i = |symbol, name, class, decimals, ext, price, mark, underlying, target_bps| Instrument {
        symbol, name, class, decimals, ext, price, mark, underlying, target_bps, mint: Pubkey::default(),
    };
    use AssetClass::{PreIpo, PublicTokenizedEquity as Pub};
    vec![
        i("TNVDA", "NVDA — DEVNET TEST INSTRUMENT", Pub, 6, Ext::None, 100_000_000, 0, 102_000_000, 2_500),
        i("TAAPL", "AAPL — DEVNET TEST INSTRUMENT", Pub, 6, Ext::None, 75_000_000, 0, 75_000_000, 2_000),
        i("TSPY", "SPY — DEVNET TEST INSTRUMENT", Pub, 9, Ext::ScaledUi, 50_000_000, 0, 50_000_000, 2_000),
        i("TSPACEX", "SpaceX Exposure — DEVNET TEST INSTRUMENT", PreIpo, 6, Ext::None, 40_000_000, 50_000_000, 0, 1_500),
        i("TOPENAI", "OpenAI Exposure — DEVNET TEST INSTRUMENT", PreIpo, 6, Ext::TransferFee(25), 35_000_000, 0, 0, 1_500),
    ]
}

/// A real Token-2022 mint, initialized by the token program itself. The
/// account is allocated at the size the requested extensions need; every
/// extension and the mint are then initialized by instruction.
fn create_t22_mint(svm: &mut LiteSVM, payer: &Keypair, decimals: u8, ext: Ext) -> Pubkey {
    use t22::extension::{scaled_ui_amount, transfer_fee};
    let mint = Keypair::new().pubkey();
    let types = match ext {
        Ext::None => vec![],
        Ext::TransferFee(_) => vec![ExtensionType::TransferFeeConfig],
        Ext::ScaledUi => vec![ExtensionType::ScaledUiAmount],
    };
    let len = ExtensionType::try_calculate_account_len::<t22::state::Mint>(&types).unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(len);
    svm.set_account(mint, Account { lamports, data: vec![0; len], owner: token_2022(), executable: false, rent_epoch: 0 })
        .unwrap();
    let authority = payer.pubkey();
    let mut ixs = vec![];
    match ext {
        Ext::None => {}
        Ext::TransferFee(bps) => ixs.push(
            transfer_fee::instruction::initialize_transfer_fee_config(
                &token_2022(), &mint, Some(&authority), Some(&authority), bps, u64::MAX,
            )
            .unwrap(),
        ),
        Ext::ScaledUi => ixs.push(
            scaled_ui_amount::instruction::initialize(&token_2022(), &mint, Some(authority), 1.0).unwrap(),
        ),
    }
    ixs.push(t22::instruction::initialize_mint2(&token_2022(), &mint, &authority, None, decimals).unwrap());
    send(svm, &ixs, payer, &[]).expect("create Token-2022 mint");
    mint
}

// ================================================================ tenet ix builders

fn end_execution_ix(executor: &Pubkey, circle: &Pubkey, mandate: &Pubkey, epoch: &Pubkey, nonce: u64, usdc: &Pubkey, out_mint: &Pubkey, price_account: &Pubkey) -> Instruction {
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::EndExecution {
            executor: *executor,
            circle: *circle,
            mandate: *mandate,
            execution_auth: tenet::pda::exec_auth(circle, epoch, nonce).0,
            epoch: *epoch,
            in_mint: *usdc,
            out_mint: *out_mint,
            mandate_asset_out: tenet::pda::mandate_asset(mandate, out_mint).0,
            registry_entry: tenet::pda::registry(out_mint).0,
            config: tenet::pda::config().0,
            price_account: *price_account,
            source_vault: tenet::pda::usdc_vault(circle).0,
            circle_asset_out: tenet::pda::circle_asset(circle, out_mint).0,
            dest_vault: tenet::pda::asset_vault(circle, out_mint).0,
            source_token_program: token(),
            vault_authority: tenet::pda::vault_authority(circle).0,
        }
        .to_account_metas(None),
        data: tenet::instruction::EndExecution {}.data(),
    }
}

fn open_nav_snapshot_ix(payer: &Pubkey, circle: &Pubkey, index: u64) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::OpenNavSnapshot {
            payer: *payer,
            circle: *circle,
            epoch,
            nav_snapshot: tenet::pda::nav_snapshot(&epoch).0,
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            vault_authority: tenet::pda::vault_authority(circle).0,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::OpenNavSnapshot {}.data(),
    }
}

fn record_asset_nav_ix(payer: &Pubkey, circle: &Pubkey, mandate: &Pubkey, index: u64, mint: &Pubkey, price_account: &Pubkey) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::RecordAssetNav {
            payer: *payer,
            circle: *circle,
            epoch,
            nav_snapshot: tenet::pda::nav_snapshot(&epoch).0,
            circle_asset: tenet::pda::circle_asset(circle, mint).0,
            mandate_asset: tenet::pda::mandate_asset(mandate, mint).0,
            registry_entry: tenet::pda::registry(mint).0,
            vault: tenet::pda::asset_vault(circle, mint).0,
            mint: *mint,
            config: tenet::pda::config().0,
            price_account: *price_account,
            vault_authority: tenet::pda::vault_authority(circle).0,
        }
        .to_account_metas(None),
        data: tenet::instruction::RecordAssetNav {}.data(),
    }
}

fn finalize_rolling_ix(payer: &Pubkey, circle: &Pubkey, usdc: &Pubkey, index: u64) -> Instruction {
    let epoch = epoch_key(circle, index);
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::FinalizeEpoch {
            payer: *payer,
            circle: *circle,
            epoch,
            epoch_escrow: tenet::pda::epoch_escrow(circle, index).0,
            nav_snapshot: Some(tenet::pda::nav_snapshot(&epoch).0),
            active_usdc_vault: tenet::pda::usdc_vault(circle).0,
            usdc_mint: *usdc,
            vault_authority: tenet::pda::vault_authority(circle).0,
            token_program: token(),
        }
        .to_account_metas(None),
        data: tenet::instruction::FinalizeEpoch {}.data(),
    }
}

// ================================================================ world

struct World {
    svm: LiteSVM,
    /// Upgrade authority of both programs, devnet operator, registry authority
    /// and instrument mint authority. On devnet these are the deployer wallet.
    admin: Keypair,
    tusdc: Pubkey,
    instruments: Vec<Instrument>,
    nonce: u64,
}

impl World {
    fn new() -> World {
        let mut svm = LiteSVM::new();
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy");
        svm.add_program_from_file(tenet::ID, format!("{dir}/tenet.so")).expect("tenet.so");
        svm.add_program_from_file(tenet_devnet::ID, format!("{dir}/tenet_devnet.so")).expect("tenet_devnet.so");
        let admin = funded(&mut svm);
        set_authority(&mut svm, &tenet::ID, &admin.pubkey());
        set_authority(&mut svm, &tenet_devnet::ID, &admin.pubkey());

        // tenet-devnet: admin + faucet + program-owned TUSDC mint.
        send(&mut svm, &[devnet_initialize_ix(&admin.pubkey(), &admin.pubkey())], &admin, &[]).expect("devnet init");
        let tusdc = tusdc_pda();

        // Tenet Config on the Devnet profile, bound to TUSDC.
        let ix = initialize_config_ix(&admin.pubkey(), &admin.pubkey(), &tusdc);
        send(&mut svm, &[ix], &admin, &[]).expect("tenet config (devnet)");

        let mut w = World { svm, admin, tusdc, instruments: catalog(), nonce: 0 };
        for idx in 0..w.instruments.len() {
            w.list_instrument(idx);
        }
        w
    }

    fn a(&self) -> Keypair {
        self.admin.insecure_clone()
    }

    fn mint(&self, symbol: &str) -> Pubkey {
        self.instruments.iter().find(|i| i.symbol == symbol).unwrap().mint
    }

    fn inst(&self, symbol: &str) -> &Instrument {
        self.instruments.iter().find(|i| i.symbol == symbol).unwrap()
    }

    /// Mint -> feed -> market (inventory funded by a real mint_to) -> registry.
    fn list_instrument(&mut self, idx: usize) {
        let admin = self.a();
        let (decimals, ext, symbol) = (self.instruments[idx].decimals, self.instruments[idx].ext, self.instruments[idx].symbol);
        let mint = create_t22_mint(&mut self.svm, &admin, decimals, ext);
        self.instruments[idx].mint = mint;
        let i = &self.instruments[idx];
        let p = prices(i.price, i.mark, i.underlying);
        send(&mut self.svm, &[create_feed_ix(&admin.pubkey(), &mint, symbol, p)], &admin, &[]).expect("feed");
        send(&mut self.svm, &[create_market_ix(&admin.pubkey(), &mint)], &admin, &[]).expect("market");
        let amount = INVENTORY_UNITS * 10u64.pow(decimals as u32);
        let mint_to = t22::instruction::mint_to(&token_2022(), &mint, &inventory_pda(&mint), &admin.pubkey(), &[], amount).unwrap();
        send(&mut self.svm, &[mint_to], &admin, &[]).expect("fund inventory");

        let i = &self.instruments[idx];
        let n = idx as u8 + 1;
        let params = tenet::RegistryParams {
            asset_class: i.class,
            issuer: Pubkey::new_from_array([n; 32]),
            underlying_id: [n; 16],
            symbol: i.symbol.into(),
            display_name: i.name.into(),
            // The devnet feed id is the mint's own address.
            pyth_feed_tokenized: mint.to_bytes(),
            pyth_feed_underlying: [0; 32],
            status: AssetStatus::Active,
        };
        send(&mut self.svm, &[upsert_ix(&admin.pubkey(), &mint, params), refresh_metadata_ix(&admin.pubkey(), &mint)], &admin, &[])
            .expect("register");
    }

    /// A wallet with SOL and a TUSDC account filled by the real faucet.
    fn wallet_with_tusdc(&mut self) -> (Keypair, Pubkey) {
        let k = funded(&mut self.svm);
        let acc = token_account_with(&mut self.svm, &self.tusdc, &k.pubkey(), 0);
        send(&mut self.svm, &[request_tusdc_ix(&k.pubkey(), &acc)], &k, &[]).expect("faucet");
        assert_eq!(token_balance(&self.svm, &acc), tenet_devnet::FAUCET_CLAIM_RAW);
        (k, acc)
    }

    fn set_price(&mut self, symbol: &str, price: i64, mark: i64, underlying: i64) {
        let admin = self.a();
        let mint = self.mint(symbol);
        send(&mut self.svm, &[update_feed_ix(&admin.pubkey(), &mint, prices(price, mark, underlying))], &admin, &[])
            .expect("update feed");
        let i = self.instruments.iter_mut().find(|i| i.symbol == symbol).unwrap();
        i.price = price;
    }

    fn refresh_all(&mut self) {
        let admin = self.a();
        let ixs: Vec<Instruction> = self.instruments.iter().map(|i| refresh_metadata_ix(&admin.pubkey(), &i.mint)).collect();
        send(&mut self.svm, &ixs, &admin, &[]).expect("refresh metadata");
    }

    /// Mandate + finalize + Circle + CircleAssets. `targets` in catalog order.
    fn mandate_and_circle(&mut self, author: &Keypair, params: tenet::MandateParams, targets: &[u16]) -> (Pubkey, Pubkey) {
        let seed = Keypair::new().pubkey();
        let mandate = tenet::pda::mandate(&seed).0;
        send(&mut self.svm, &[create_mandate_ix(&author.pubkey(), &seed, params)], author, &[]).expect("create mandate");
        let mints: Vec<Pubkey> = self.instruments.iter().map(|i| i.mint).collect();
        for (mint, &w) in mints.iter().zip(targets) {
            send(&mut self.svm, &[add_asset_ix(&author.pubkey(), &mandate, mint, w)], author, &[]).expect("add asset");
        }
        self.activate(author, mandate)
    }

    fn activate(&mut self, author: &Keypair, mandate: Pubkey) -> (Pubkey, Pubkey) {
        let mints: Vec<Pubkey> = self.instruments.iter().map(|i| i.mint).collect();
        let pairs: Vec<(Pubkey, Pubkey)> =
            mints.iter().map(|m| (tenet::pda::mandate_asset(&mandate, m).0, tenet::pda::registry(m).0)).collect();
        send(&mut self.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], author, &[]).expect("finalize mandate");
        let tusdc = self.tusdc;
        send(&mut self.svm, &[create_circle_ix(&author.pubkey(), &mandate, &tusdc, &token())], author, &[]).expect("create circle");
        let circle = tenet::pda::circle(&mandate).0;
        for m in &mints {
            let ma = tenet::pda::mandate_asset(&mandate, m).0;
            send(&mut self.svm, &[add_circle_asset_ix(&author.pubkey(), &circle, &ma, m, &token_2022())], author, &[])
                .expect("add circle asset");
        }
        (mandate, circle)
    }

    fn contribute(&mut self, who: &Keypair, from: &Pubkey, circle: &Pubkey, mandate: &Pubkey, index: u64, amount: u64) {
        let tusdc = self.tusdc;
        let ix = contribute_ix(&who.pubkey(), circle, mandate, &tusdc, index, from, amount);
        send(&mut self.svm, &[ix], who, &[]).expect("contribute");
    }

    /// Close, finalize (Epoch 0: no oracle), settle everyone, complete.
    fn finish_epoch_zero(&mut self, circle: &Pubkey, members: &[Pubkey]) {
        let tusdc = self.tusdc;
        let p = funded(&mut self.svm);
        let closes = read::<Epoch>(&self.svm, &epoch_key(circle, 0)).closes_at;
        warp_to(&mut self.svm, closes);
        send(&mut self.svm, &[close_contributions_ix(&p.pubkey(), circle, 0)], &p, &[]).unwrap();
        send(&mut self.svm, &[finalize_epoch_ix(&p.pubkey(), circle, &tusdc, 0)], &p, &[]).expect("finalize epoch 0");
        for m in members {
            send(&mut self.svm, &[settle_ix(&p.pubkey(), circle, 0, m)], &p, &[]).expect("settle");
        }
        send(&mut self.svm, &[close_epoch_ix(&p.pubkey(), circle, 0)], &p, &[]).expect("close epoch 0");
    }

    fn nav_of_epoch(&self, circle: &Pubkey, index: u64) -> u128 {
        let e: Epoch = read(&self.svm, &epoch_key(circle, index));
        e.nav_before + u128::from(e.pending_usdc_raw)
    }

    /// The live value of a Circle, computed here independently of the program
    /// from real vault balances and feed prices.
    fn live_nav(&self, circle: &Pubkey) -> u128 {
        let c: Circle = read(&self.svm, circle);
        let mut nav = u128::from(token_balance(&self.svm, &tenet::pda::usdc_vault(circle).0) - c.usdc_reserved_raw);
        for i in &self.instruments {
            nav += self.value_of(circle, i);
        }
        nav
    }

    fn value_of(&self, circle: &Pubkey, i: &Instrument) -> u128 {
        let bal = token_balance(&self.svm, &tenet::pda::asset_vault(circle, &i.mint).0);
        u128::from(bal) * i.price as u128 / 10u128.pow(i.decimals as u32)
    }

    /// One Execute: begin -> tenet-devnet buy -> end, in one transaction.
    /// Returns (spent, gained) measured from the Circle's real vaults.
    fn execute(&mut self, circle: &Pubkey, mandate: &Pubkey, symbol: &str, spend: u64) -> Result<(u64, u64), String> {
        self.execute_with(circle, mandate, symbol, spend, |_| {})
    }

    fn execute_with(
        &mut self,
        circle: &Pubkey,
        mandate: &Pubkey,
        symbol: &str,
        spend: u64,
        tamper: impl FnOnce(&mut Vec<Instruction>),
    ) -> Result<(u64, u64), String> {
        let current = read::<Circle>(&self.svm, circle).current_epoch;
        self.execute_at(circle, mandate, symbol, spend, current - 1, &[], tamper)
    }

    /// Execute with an explicit NAV epoch; `later` are the (Cancelled) epochs
    /// after it, passed as remaining accounts of begin_execution (A-24).
    #[allow(clippy::too_many_arguments)]
    fn execute_at(
        &mut self,
        circle: &Pubkey,
        mandate: &Pubkey,
        symbol: &str,
        spend: u64,
        nav_epoch: u64,
        later: &[Pubkey],
        tamper: impl FnOnce(&mut Vec<Instruction>),
    ) -> Result<(u64, u64), String> {
        let executor = funded(&mut self.svm);
        let mint = self.mint(symbol);
        let tusdc = self.tusdc;
        let epoch = epoch_key(circle, nav_epoch);
        let market = read::<tenet_devnet::Market>(&self.svm, &market_pda(&mint));
        let inst = self.inst(symbol);
        let quote = tenet_devnet::quote_buy(spend, inst.price, inst.decimals, market.spread_bps).unwrap();
        self.nonce += 1;
        let nonce = self.nonce;
        let expires = now(&self.svm) + 300;
        let mut begin = begin_execution_ix(
            &executor.pubkey(), circle, mandate, &epoch, &tenet::pda::mandate_asset(mandate, &mint).0,
            &mint, nonce, spend, 1, expires,
        );
        begin.accounts[9].pubkey = tusdc;
        for l in later {
            begin.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*l, false));
        }
        let usdc_vault = tenet::pda::usdc_vault(circle).0;
        let dest = tenet::pda::asset_vault(circle, &mint).0;
        let venue = buy_ix(&executor.pubkey(), &mint, &usdc_vault, &dest, spend, quote);
        let end = end_execution_ix(&executor.pubkey(), circle, mandate, &epoch, nonce, &tusdc, &mint, &feed_pda(&mint));
        let mut ixs = vec![begin, venue, end];
        tamper(&mut ixs);

        let (in0, out0) = (token_balance(&self.svm, &usdc_vault), token_balance(&self.svm, &dest));
        let market_usdc0 = token_balance(&self.svm, &market_usdc_pda(&mint));
        send(&mut self.svm, &ixs, &executor, &[])?;
        let (in1, out1) = (token_balance(&self.svm, &usdc_vault), token_balance(&self.svm, &dest));
        let spent = in0 - in1;
        let gained = out1 - out0;
        // Real movements, both sides of the trade.
        assert_eq!(spent, spend);
        assert_eq!(token_balance(&self.svm, &market_usdc_pda(&mint)) - market_usdc0, spend);
        match inst_ext(self.inst(symbol)) {
            Ext::TransferFee(bps) => assert_eq!(gained, quote - (quote * bps as u64).div_ceil(10_000)),
            _ => assert_eq!(gained, quote),
        }
        // The delegate granted by begin_execution is gone.
        let vault = svm_token(&self.svm, &usdc_vault);
        assert_eq!(vault.delegate, None.into(), "delegate revoked");
        Ok((spent, gained))
    }
}

fn inst_ext(i: &Instrument) -> Ext {
    i.ext
}

fn svm_token(svm: &LiteSVM, key: &Pubkey) -> anchor_spl::token::spl_token::state::Account {
    use anchor_lang::solana_program::program_pack::Pack;
    anchor_spl::token::spl_token::state::Account::unpack(&svm.get_account(key).unwrap().data).unwrap()
}

fn frontier_params() -> tenet::MandateParams {
    tenet::MandateParams {
        name: "Frontier Technology".into(),
        description: "Public and pre-IPO frontier technology — DEVNET TEST".into(),
        max_weight_per_asset_bps: 3_000,
        max_pre_ipo_weight_bps: 3_000,
        max_issuer_weight_bps: 3_000,
        max_underlying_weight_bps: 3_000,
        max_supply_consumption_bps: 100,
        max_price_impact_bps: 100,
        min_contribution_usdc: 10 * TUSDC,
        max_pool_size_usdc: 1_000_000 * TUSDC,
        epoch_duration: DAY,
        membership_policy: MembershipPolicy::Open,
        amendment_threshold_bps: 6_667,
        amendment_delay_seconds: tenet::MIN_AMENDMENT_DELAY_SECONDS,
    }
}

/// Spend 99% of an asset's remaining target headroom.
fn headroom(w: &World, circle: &Pubkey, nav: u128, symbol: &str, target_bps: u16) -> u64 {
    let target = nav * target_bps as u128 / 10_000;
    let held = w.value_of(circle, w.inst(symbol));
    ((target - held) * 99 / 100) as u64
}

// ================================================================ the test

#[test]
fn devnet_pool_execute_value_exit_fork() {
    // The core reads the devnet feed by this discriminator; it must be the
    // devnet program's real one.
    assert_eq!(tenet::DEVNET_PRICE_FEED_DISCRIMINATOR, tenet_devnet::PriceFeed::DISCRIMINATOR);

    let mut w = World::new();
    let tusdc = w.tusdc;

    // ---- Faucet: real mint through the PDA authority, rate limited.
    let (alice, alice_usdc) = w.wallet_with_tusdc();
    let (bob, bob_usdc) = w.wallet_with_tusdc();
    let (carol, carol_usdc) = w.wallet_with_tusdc();
    let (dave, dave_usdc) = w.wallet_with_tusdc();
    let r = send(&mut w.svm, &[request_tusdc_ix(&alice.pubkey(), &alice_usdc)], &alice, &[]);
    expect_log(r, &format!("Custom({})", u32::from(DevnetError::FaucetCooldown)));
    // Only the operator can move prices.
    let mint = w.mint("TNVDA");
    let r = send(&mut w.svm, &[update_feed_ix(&bob.pubkey(), &mint, prices(1, 0, 0))], &bob, &[]);
    expect_log(r, "NotOperator");

    // ---- POOL: Mandate + Circle + Epoch 0 with three members.
    let author = funded(&mut w.svm);
    let targets: Vec<u16> = w.instruments.iter().map(|i| i.target_bps).collect();
    let (mandate, circle) = w.mandate_and_circle(&author, frontier_params(), &targets);
    let p = funded(&mut w.svm);
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &tusdc, 0)], &p, &[]).unwrap();
    w.contribute(&alice, &alice_usdc, &circle, &mandate, 0, 1_000 * TUSDC);
    w.contribute(&bob, &bob_usdc, &circle, &mandate, 0, 500 * TUSDC);
    w.contribute(&carol, &carol_usdc, &circle, &mandate, 0, 300 * TUSDC);
    // Dave changes his mind: a real refund from escrow.
    w.contribute(&dave, &dave_usdc, &circle, &mandate, 0, 100 * TUSDC);
    send(&mut w.svm, &[cancel_ix(&dave.pubkey(), &circle, &tusdc, 0, &dave_usdc)], &dave, &[]).expect("cancel");
    assert_eq!(token_balance(&w.svm, &dave_usdc), 1_000 * TUSDC);
    w.finish_epoch_zero(&circle, &[alice.pubkey(), bob.pubkey(), carol.pubkey()]);

    let shares = |w: &World, who: &Keypair| read::<Member>(&w.svm, &tenet::pda::member(&circle, &who.pubkey()).0).shares;
    assert_eq!((shares(&w, &alice), shares(&w, &bob), shares(&w, &carol)), (1_000 * TUSDC, 500 * TUSDC, 300 * TUSDC));
    assert_eq!(token_balance(&w.svm, &tenet::pda::usdc_vault(&circle).0), 1_800 * TUSDC);
    let nav0 = w.nav_of_epoch(&circle, 0);
    assert_eq!(nav0, 1_800 * TUSDC as u128);

    // ---- EXECUTE: rejections first, each reverting every token movement.
    let usdc_vault = tenet::pda::usdc_vault(&circle).0;
    // (a) Anything but the venue inside the window.
    let tnvda = w.mint("TNVDA");
    let r = w.execute_with(&circle, &mandate, "TNVDA", 10 * TUSDC, |ixs| {
        let executor = ixs[0].accounts[0].pubkey;
        ixs.insert(1, refresh_metadata_ix(&executor, &tnvda));
    });
    expect_err(r.map(|_| unreachable!()), TenetError::UnexpectedInstructionInWindow);
    // (b) A price account from another program (here: a token account).
    let r = w.execute_with(&circle, &mandate, "TNVDA", 10 * TUSDC, |ixs| {
        let end = ixs.last_mut().unwrap();
        end.accounts[10].pubkey = usdc_vault;
    });
    expect_err(r.map(|_| unreachable!()), TenetError::PriceSourceMismatch);
    // (c) Another instrument's feed.
    let taapl_feed = feed_pda(&w.mint("TAAPL"));
    let r = w.execute_with(&circle, &mandate, "TNVDA", 10 * TUSDC, |ixs| {
        ixs.last_mut().unwrap().accounts[10].pubkey = taapl_feed;
    });
    expect_err(r.map(|_| unreachable!()), TenetError::PriceFeedMismatch);
    // (d) A venue filling worse than the Mandate's 1% price-impact cap.
    let admin = w.a();
    let taapl = w.mint("TAAPL");
    send(&mut w.svm, &[set_spread_ix(&admin.pubkey(), &taapl, 500)], &admin, &[]).unwrap();
    let r = w.execute(&circle, &mandate, "TAAPL", 10 * TUSDC);
    expect_err(r.map(|_| unreachable!()), TenetError::PriceImpactExceeded);
    send(&mut w.svm, &[set_spread_ix(&admin.pubkey(), &taapl, SPREAD_BPS)], &admin, &[]).unwrap();
    // (e) More than the Mandate target in one go.
    let r = w.execute(&circle, &mandate, "TNVDA", 460 * TUSDC);
    expect_err(r.map(|_| unreachable!()), TenetError::TargetWeightExceeded);
    assert_eq!(token_balance(&w.svm, &usdc_vault), 1_800 * TUSDC, "every rejection reverted");

    // Execute the Epoch: each asset to (just under) its target.
    let symbols: Vec<(&'static str, u16)> = w.instruments.iter().map(|i| (i.symbol, i.target_bps)).collect();
    for &(sym, bps) in &symbols {
        let spend = headroom(&w, &circle, nav0, sym, bps);
        w.execute(&circle, &mandate, sym, spend).unwrap_or_else(|e| panic!("execute {sym}: {e}"));
    }
    // Held at target, so one more TUSDC of TNVDA would breach it.
    let r = w.execute(&circle, &mandate, "TNVDA", 10 * TUSDC);
    expect_err(r.map(|_| unreachable!()), TenetError::TargetWeightExceeded);
    let cash = token_balance(&w.svm, &usdc_vault);
    assert!(cash > 90 * TUSDC && cash < 120 * TUSDC, "≈5% cash buffer + headroom, got {cash}");

    // ---- VALUE: prices move; a rolling epoch admits a new member at the
    // on-chain NAV computed from real vaults and feeds.
    w.set_price("TNVDA", 110_000_000, 0, 112_000_000); // +10%
    w.set_price("TSPACEX", 36_000_000, 50_000_000, 0); // -10%, mark 50 => market -28% vs mark
    let (erin, erin_usdc) = w.wallet_with_tusdc();
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &tusdc, 1)], &p, &[]).unwrap();
    w.contribute(&erin, &erin_usdc, &circle, &mandate, 1, 200 * TUSDC);
    let closes = read::<Epoch>(&w.svm, &epoch_key(&circle, 1)).closes_at;
    warp_to(&mut w.svm, closes);
    send(&mut w.svm, &[close_contributions_ix(&p.pubkey(), &circle, 1)], &p, &[]).unwrap();
    w.refresh_all();
    let expected_nav = w.live_nav(&circle);
    send(&mut w.svm, &[open_nav_snapshot_ix(&p.pubkey(), &circle, 1)], &p, &[]).unwrap();
    // Frozen while valuing: no execution can move the NAV mid-snapshot.
    let r = w.execute(&circle, &mandate, "TAAPL", TUSDC);
    expect_err(r.map(|_| unreachable!()), TenetError::ExecutionFrozen);
    let mints: Vec<Pubkey> = w.instruments.iter().map(|i| i.mint).collect();
    for m in &mints {
        let ix = record_asset_nav_ix(&p.pubkey(), &circle, &mandate, 1, m, &feed_pda(m));
        send(&mut w.svm, &[ix], &p, &[]).expect("record asset nav");
    }
    send(&mut w.svm, &[finalize_rolling_ix(&p.pubkey(), &circle, &tusdc, 1)], &p, &[]).expect("finalize rolling");
    send(&mut w.svm, &[settle_ix(&p.pubkey(), &circle, 1, &erin.pubkey())], &p, &[]).unwrap();
    send(&mut w.svm, &[close_epoch_ix(&p.pubkey(), &circle, 1)], &p, &[]).unwrap();

    let e1: Epoch = read(&w.svm, &epoch_key(&circle, 1));
    assert_eq!(e1.nav_before, expected_nav, "on-chain NAV == independent NAV");
    assert!(expected_nav > nav0, "TNVDA's +10% outweighs TSPACEX's -10%");
    let shares_before = 1_800 * TUSDC;
    let erin_expected = (200 * TUSDC as u128 * shares_before as u128 / expected_nav) as u64;
    assert_eq!(shares(&w, &erin), erin_expected);
    assert!(erin_expected < 200 * TUSDC, "NAV rose, so a TUSDC buys less than one share");

    // Execute the new cash into TSPACEX, which fell below target.
    let nav1 = w.nav_of_epoch(&circle, 1);
    let spend = headroom(&w, &circle, nav1, "TSPACEX", 1_500);
    w.execute(&circle, &mandate, "TSPACEX", spend).expect("rebalance TSPACEX");

    // ---- EXIT in kind: 25%, 50%, 100%. Nobody else is diluted.
    let all_mints: Vec<Pubkey> = mints.iter().copied().chain([tusdc]).collect();
    let balance_of = |w: &World, m: &Pubkey| {
        if *m == tusdc { token_balance(&w.svm, &usdc_vault) } else { token_balance(&w.svm, &tenet::pda::asset_vault(&circle, m).0) }
    };
    for (who, who_usdc, pct) in [(&alice, alice_usdc, 25u64), (&bob, bob_usdc, 50), (&carol, carol_usdc, 100)] {
        let total_before = read::<Circle>(&w.svm, &circle).total_shares;
        let before: Vec<u64> = all_mints.iter().map(|m| balance_of(&w, m)).collect();
        let held = shares(&w, who);
        let redeem = held * pct / 100;
        send(&mut w.svm, &[initiate_redemption_ix(&who.pubkey(), &circle, 0, redeem)], who, &[]).expect("initiate");
        let r = redemption_key(&circle, &who.pubkey(), 0);
        let s = funded(&mut w.svm);
        for m in &mints {
            send(&mut w.svm, &[reserve_asset_ix(&s.pubkey(), &circle, &r, m)], &s, &[]).expect("reserve asset");
        }
        send(&mut w.svm, &[reserve_usdc_ix(&s.pubkey(), &circle, &r, &tusdc)], &s, &[]).expect("reserve usdc");
        for (m, &b) in mints.iter().zip(&before) {
            let to = clone_token_account_for(&mut w.svm, &tenet::pda::asset_vault(&circle, m).0, &who.pubkey());
            send(&mut w.svm, &[claim_asset_ix(&who.pubkey(), &circle, &r, m, &to)], who, &[]).expect("claim asset");
            let entitled = (b as u128 * redeem as u128 / total_before as u128) as u64;
            let fee = match w.instruments.iter().find(|i| i.mint == *m).unwrap().ext {
                Ext::TransferFee(bps) => (entitled * bps as u64).div_ceil(10_000),
                _ => 0,
            };
            assert_eq!(token_balance(&w.svm, &to), entitled - fee, "{pct}% exit, in kind");
        }
        let usdc_before_claim = token_balance(&w.svm, &who_usdc);
        send(&mut w.svm, &[claim_usdc_ix(&who.pubkey(), &circle, &r, &tusdc, &who_usdc)], who, &[]).expect("claim usdc");
        assert_eq!(
            token_balance(&w.svm, &who_usdc) - usdc_before_claim,
            (before[mints.len()] as u128 * redeem as u128 / total_before as u128) as u64
        );
        assert_eq!(shares(&w, who), held - redeem);

        // No dilution: every remaining share is backed by at least as much of
        // every asset as before (floors round in the stayers' favour).
        let total_after = read::<Circle>(&w.svm, &circle).total_shares;
        assert_eq!(total_after, total_before - redeem);
        for (m, &b) in all_mints.iter().zip(&before) {
            let a = balance_of(&w, m);
            assert!(a as u128 * total_before as u128 >= b as u128 * total_after as u128, "diluted by exit");
        }
    }
    assert_eq!(shares(&w, &carol), 0, "a full exit leaves no shares");

    // ---- FORK: same universe, pre-IPO cap 30% -> 15%, new Circle.
    let frank = funded(&mut w.svm);
    let mut rules = frontier_params();
    rules.name = "Frontier Technology — Lower Pre-IPO".into();
    rules.max_pre_ipo_weight_bps = 1_500;
    let seed = Keypair::new().pubkey();
    let child = tenet::pda::mandate(&seed).0;
    send(&mut w.svm, &[fork_ix(&frank.pubkey(), &mandate, &seed, rules)], &frank, &[]).expect("fork");
    let child_targets = [3_000u16, 2_500, 2_500, 750, 750];
    for (m, &t) in mints.iter().zip(&child_targets) {
        send(&mut w.svm, &[fork_asset_ix(&frank.pubkey(), &mandate, &child, m, t)], &frank, &[]).expect("fork asset");
    }
    let (_, child_circle) = w.activate(&frank, child);
    let cm: Mandate = read(&w.svm, &child);
    assert_eq!(cm.forked_from, Some(mandate));
    assert_eq!(cm.max_pre_ipo_weight_bps, 1_500);
    assert_eq!(read::<Mandate>(&w.svm, &mandate).max_pre_ipo_weight_bps, 3_000);

    let (grace, grace_usdc) = w.wallet_with_tusdc();
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &child_circle, &child, &tusdc, 0)], &p, &[]).unwrap();
    w.contribute(&grace, &grace_usdc, &child_circle, &child, 0, 400 * TUSDC);
    w.finish_epoch_zero(&child_circle, &[grace.pubkey()]);
    let child_nav = w.nav_of_epoch(&child_circle, 0);
    // The child's own, tighter rule binds: TSPACEX may reach 7.5%, not 15%.
    let r = w.execute(&child_circle, &child, "TSPACEX", 40 * TUSDC);
    expect_err(r.map(|_| unreachable!()), TenetError::TargetWeightExceeded);
    for (sym, bps) in [("TNVDA", 3_000u16), ("TSPACEX", 750)] {
        let spend = headroom(&w, &child_circle, child_nav, sym, bps);
        w.execute(&child_circle, &child, sym, spend).unwrap_or_else(|e| panic!("child execute {sym}: {e}"));
    }
    assert_ne!(tenet::pda::usdc_vault(&child_circle).0, usdc_vault);
}


/// A-24: a valuation that times out is cancelled; the Circle is NOT stuck.
/// Contributors are refunded, execution continues on the last Completed NAV
/// (proving every later epoch Cancelled), and the next window opens.
#[test]
fn cancelled_valuation_reopens_windows_and_keeps_execution() {
    let mut w = World::new();
    let tusdc = w.tusdc;
    let (alice, alice_usdc) = w.wallet_with_tusdc();
    let (bob, bob_usdc) = w.wallet_with_tusdc();
    let author = funded(&mut w.svm);
    let targets: Vec<u16> = w.instruments.iter().map(|i| i.target_bps).collect();
    let (mandate, circle) = w.mandate_and_circle(&author, frontier_params(), &targets);
    let p = funded(&mut w.svm);
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &tusdc, 0)], &p, &[]).unwrap();
    w.contribute(&alice, &alice_usdc, &circle, &mandate, 0, 500 * TUSDC);
    w.finish_epoch_zero(&circle, &[alice.pubkey()]);

    // Window 1: bob contributes; the valuation snapshot opens and times out.
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &tusdc, 1)], &p, &[]).unwrap();
    w.contribute(&bob, &bob_usdc, &circle, &mandate, 1, 200 * TUSDC);
    let closes = read::<Epoch>(&w.svm, &epoch_key(&circle, 1)).closes_at;
    warp_to(&mut w.svm, closes);
    send(&mut w.svm, &[close_contributions_ix(&p.pubkey(), &circle, 1)], &p, &[]).unwrap();
    w.refresh_all();
    send(&mut w.svm, &[open_nav_snapshot_ix(&p.pubkey(), &circle, 1)], &p, &[]).unwrap();
    let e1 = epoch_key(&circle, 1);
    let snap = tenet::pda::nav_snapshot(&e1).0;
    let slot = w.svm.get_sysvar::<anchor_lang::prelude::Clock>().slot;
    w.svm.warp_to_slot(slot + tenet::NAV_SNAPSHOT_MAX_SLOTS + 5);
    let cancel = Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CancelEpoch { payer: p.pubkey(), circle, epoch: e1, nav_snapshot: Some(snap) }.to_account_metas(None),
        data: tenet::instruction::CancelEpoch {}.data(),
    };
    send(&mut w.svm, &[cancel], &p, &[]).expect("cancel the timed-out valuation");
    let c: Circle = read(&w.svm, &circle);
    assert_eq!(c.current_epoch, 2, "the Circle moves on");
    assert!(!c.execution_frozen);
    assert_eq!(read::<Epoch>(&w.svm, &e1).state, tenet::state::EpochState::Cancelled);

    // The window-1 contribution comes back from that epoch's own escrow.
    send(&mut w.svm, &[cancel_ix(&bob.pubkey(), &circle, &tusdc, 1, &bob_usdc)], &bob, &[]).expect("refund");
    assert_eq!(token_balance(&w.svm, &bob_usdc), 1_000 * TUSDC);

    // Execution uses the epoch-0 NAV, proving epoch 1 Cancelled ...
    let nav0 = w.nav_of_epoch(&circle, 0);
    assert_eq!(nav0, 500 * TUSDC as u128);
    let spend = headroom(&w, &circle, nav0, "TNVDA", 2_500);
    // ... and every way around the proof is refused:
    let r = w.execute_at(&circle, &mandate, "TNVDA", spend, 0, &[], |_| {});
    expect_err(r.map(|_| unreachable!()), TenetError::EpochIndexMismatch); // later epoch omitted
    let e0 = epoch_key(&circle, 0);
    let r = w.execute_at(&circle, &mandate, "TNVDA", spend, 0, &[e0], |_| {});
    expect_err(r.map(|_| unreachable!()), TenetError::EpochIndexMismatch); // wrong epoch as proof
    let r = w.execute_at(&circle, &mandate, "TNVDA", spend, 1, &[], |_| {});
    expect_err(r.map(|_| unreachable!()), TenetError::EpochNotFinalized); // the cancelled one as NAV
    w.execute_at(&circle, &mandate, "TNVDA", spend, 0, &[e1], |_| {}).expect("execute on the last completed NAV");

    // The next window opens, prices at on-chain NAV and completes normally.
    send(&mut w.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &tusdc, 2)], &p, &[]).expect("window 2 opens");
    w.contribute(&bob, &bob_usdc, &circle, &mandate, 2, 100 * TUSDC);
    let closes = read::<Epoch>(&w.svm, &epoch_key(&circle, 2)).closes_at;
    warp_to(&mut w.svm, closes);
    send(&mut w.svm, &[close_contributions_ix(&p.pubkey(), &circle, 2)], &p, &[]).unwrap();
    w.refresh_all();
    send(&mut w.svm, &[open_nav_snapshot_ix(&p.pubkey(), &circle, 2)], &p, &[]).unwrap();
    let mints: Vec<Pubkey> = w.instruments.iter().map(|i| i.mint).collect();
    for m in &mints {
        send(&mut w.svm, &[record_asset_nav_ix(&p.pubkey(), &circle, &mandate, 2, m, &feed_pda(m))], &p, &[]).unwrap();
    }
    send(&mut w.svm, &[finalize_rolling_ix(&p.pubkey(), &circle, &tusdc, 2)], &p, &[]).expect("finalize window 2");
    send(&mut w.svm, &[settle_ix(&p.pubkey(), &circle, 2, &bob.pubkey())], &p, &[]).unwrap();
    send(&mut w.svm, &[close_epoch_ix(&p.pubkey(), &circle, 2)], &p, &[]).unwrap();
    assert_eq!(read::<Circle>(&w.svm, &circle).current_epoch, 3);
    assert!(read::<Member>(&w.svm, &tenet::pda::member(&circle, &bob.pubkey()).0).shares > 0);
    // Back on the ordinary path: epoch 2, nothing after it.
    let nav2 = w.nav_of_epoch(&circle, 2);
    let spend = headroom(&w, &circle, nav2, "TAAPL", 2_000);
    w.execute(&circle, &mandate, "TAAPL", spend).expect("execute on the window-2 NAV");
}
