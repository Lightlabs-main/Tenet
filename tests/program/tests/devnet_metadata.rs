//! tenet-devnet `set_tusdc_metadata`: the faucet PDA (TUSDC's mint
//! authority) signs a Metaplex Token Metadata `Create` for TUSDC.
//!
//! Runs against the REAL Metaplex program, dumped from Devnet:
//!   solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s /tmp/mpl.so --url devnet
//!   TENET_MPL_SO=/tmp/mpl.so cargo test -p tenet-program-tests --test devnet_metadata
//! Skipped (with a note) when TENET_MPL_SO is not set, so CI does not need
//! the ~1 MB binary in the repository.

mod common;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use common::*;
use litesvm::LiteSVM;
use solana_signer::Signer;

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

#[test]
fn tusdc_metadata_is_created_by_the_faucet_pda_and_operator_only() {
    let Ok(mpl) = std::env::var("TENET_MPL_SO") else {
        eprintln!("skipped: set TENET_MPL_SO to a dump of the Metaplex Token Metadata program");
        return;
    };
    let mpl_id = tenet_devnet::TOKEN_METADATA_PROGRAM_ID;
    let mut svm = LiteSVM::new();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy");
    svm.add_program_from_file(tenet_devnet::ID, format!("{dir}/tenet_devnet.so")).unwrap();
    svm.add_program_from_file(mpl_id, mpl).unwrap();
    let admin = funded(&mut svm);
    // Upgrade authority for tenet-devnet `initialize`.
    let loader: Pubkey = "BPFLoaderUpgradeab1e11111111111111111111111".parse().unwrap();
    let pd = pda(&[tenet_devnet::ID.as_ref()], &loader);
    let mut acc = svm.get_account(&pd).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(pd, acc).unwrap();

    let d = |s: &[&[u8]]| pda(s, &tenet_devnet::ID);
    let (admin_pda, faucet, tusdc) = (d(&[tenet_devnet::ADMIN_SEED]), d(&[tenet_devnet::FAUCET_SEED]), d(&[tenet_devnet::TUSDC_MINT_SEED]));
    let init = Instruction {
        program_id: tenet_devnet::ID,
        accounts: tenet_devnet::accounts::Initialize {
            upgrade_authority: admin.pubkey(), program: tenet_devnet::ID, program_data: pd, admin: admin_pda,
            faucet, tusdc_mint: tusdc, token_program: token(), system_program: system_program(),
        }.to_account_metas(None),
        data: tenet_devnet::instruction::Initialize { operator: admin.pubkey() }.data(),
    };
    send(&mut svm, &[init], &admin, &[]).expect("initialize");

    let metadata = pda(&[b"metadata", mpl_id.as_ref(), tusdc.as_ref()], &mpl_id);
    let ix = |operator: Pubkey| Instruction {
        program_id: tenet_devnet::ID,
        accounts: tenet_devnet::accounts::SetTusdcMetadata {
            operator, admin: admin_pda, faucet, tusdc_mint: tusdc, metadata, token_metadata_program: mpl_id,
            sysvar_instructions: solana_instructions_sysvar::ID, token_program: token(), system_program: system_program(),
        }.to_account_metas(None),
        data: tenet_devnet::instruction::SetTusdcMetadata {
            name: "Tenet Devnet USDC".into(), symbol: "TUSDC".into(), uri: "https://tenetstocks.website/tokens/TUSDC.json".into(),
        }.data(),
    };

    // Anyone but the operator is refused.
    let stranger = funded(&mut svm);
    expect_log(send(&mut svm, &[ix(stranger.pubkey())], &stranger, &[]), "NotOperator");

    send(&mut svm, &[ix(admin.pubkey())], &admin, &[]).expect("set TUSDC metadata");
    let md = svm.get_account(&metadata).expect("metadata account created");
    assert_eq!(md.owner, mpl_id);
    let hay = String::from_utf8_lossy(&md.data);
    assert!(hay.contains("Tenet Devnet USDC") && hay.contains("TUSDC"), "name and symbol stored");
    // Metadata layout: key(1) | update_authority(32) | mint(32) | ...
    assert_eq!(&md.data[1..33], faucet.as_ref(), "faucet PDA is the update authority");
    assert_eq!(&md.data[33..65], tusdc.as_ref());
}
