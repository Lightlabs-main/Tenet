//! Replay `tests/vectors/pda.json` — addresses derived from the SDK's seed
//! builders (`packages/sdk/src/pda.ts`) — through `pda.rs`, which uses the
//! runtime's own `find_program_address`.
//!
//! A mismatch means a client would address the wrong account with no error at
//! the call site. It also cross-checks the TS test harness's hand-written
//! on-curve test: a wrong curve check would show up here as a different bump.

use anchor_lang::prelude::Pubkey;
use serde_json::Value;

use crate::pda;

const VECTORS: &str = include_str!("../../../tests/vectors/pda.json");

fn key(args: &[Value], i: usize) -> Pubkey {
    let h = args[i].as_str().unwrap();
    let mut b = [0u8; 32];
    for (j, byte) in b.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&h[2 * j..2 * j + 2], 16).unwrap();
    }
    Pubkey::new_from_array(b)
}

fn int(args: &[Value], i: usize) -> u64 {
    args[i].as_str().unwrap().parse().unwrap()
}

fn hex(p: &Pubkey) -> String {
    p.to_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn vectors_were_generated_for_this_program_id() {
    // If the program keypair is ever regenerated, every PDA moves. The vectors
    // must be regenerated with it, not left describing a different program.
    let doc: Value = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(doc["programId"].as_str().unwrap(), crate::ID.to_string());
}

#[test]
fn rust_derivations_match_the_sdk_seed_builders() {
    let doc: Value = serde_json::from_str(VECTORS).expect("tests/vectors/pda.json parses");
    let vectors = doc["vectors"].as_array().unwrap();
    assert_eq!(vectors.len() as u64, doc["count"].as_u64().unwrap());

    let mut failures = Vec::new();
    for (i, v) in vectors.iter().enumerate() {
        let f = v["fn"].as_str().unwrap();
        let a = v["args"].as_array().unwrap();
        let (addr, bump) = match f {
            "config" => pda::config(),
            "mandate" => pda::mandate(&key(a, 0)),
            "mandate_asset" => pda::mandate_asset(&key(a, 0), &key(a, 1)),
            "registry" => pda::registry(&key(a, 0)),
            "circle" => pda::circle(&key(a, 0)),
            "circle_asset" => pda::circle_asset(&key(a, 0), &key(a, 1)),
            "vault_authority" => pda::vault_authority(&key(a, 0)),
            "asset_vault" => pda::asset_vault(&key(a, 0), &key(a, 1)),
            "usdc_vault" => pda::usdc_vault(&key(a, 0)),
            "epoch" => pda::epoch(&key(a, 0), int(a, 1)),
            "epoch_escrow" => pda::epoch_escrow(&key(a, 0), int(a, 1)),
            "receipt" => pda::receipt(&key(a, 0), &key(a, 1)),
            "member" => pda::member(&key(a, 0), &key(a, 1)),
            "nav_snapshot" => pda::nav_snapshot(&key(a, 0)),
            "redemption" => pda::redemption(&key(a, 0), &key(a, 1), int(a, 2)),
            "redemption_asset" => pda::redemption_asset(&key(a, 0), &key(a, 1)),
            "exec_auth" => pda::exec_auth(&key(a, 0), &key(a, 1), int(a, 2)),
            "amendment" => pda::amendment(&key(a, 0), int(a, 1)),
            "amendment_vote" => pda::amendment_vote(&key(a, 0), &key(a, 1)),
            other => panic!("vector {i}: unknown derivation {other}"),
        };
        let want_addr = v["address"].as_str().unwrap();
        let want_bump = v["bump"].as_u64().unwrap() as u8;
        if hex(&addr) != want_addr || bump != want_bump {
            failures.push(format!(
                "#{i} {f}: rust {}/{bump}, sdk {want_addr}/{want_bump}",
                hex(&addr)
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );

    // Guard against a vacuous pass: some vectors must need a bump below 255,
    // i.e. the first candidate was ON the curve and had to be rejected.
    assert!(
        vectors.iter().any(|v| v["bump"].as_u64().unwrap() < 255),
        "no vector exercised on-curve rejection"
    );
}
