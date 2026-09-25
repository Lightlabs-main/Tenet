//! U-12: replay the TypeScript domain model's arithmetic against `math.rs`.
//!
//! `tests/vectors/math.json` is generated from `packages/domain` by
//! `scripts/gen-math-vectors.ts`. Every case must produce the same value, or
//! fail with the same `TenetError`. A single disagreement means the property
//! tests over the domain model are no longer evidence about this program.
//!
//! The TS side has its own drift test, so these vectors cannot silently fall
//! behind the model they were generated from.

use anchor_lang::error::Error;
use serde_json::Value;

use crate::math::*;

const VECTORS: &str = include_str!("../../../tests/vectors/math.json");

fn u64_arg(args: &[Value], i: usize) -> u64 {
    args[i].as_str().unwrap().parse().unwrap()
}

fn u128_arg(args: &[Value], i: usize) -> u128 {
    args[i].as_str().unwrap().parse().unwrap()
}

fn error_name(e: Error) -> String {
    match e {
        Error::AnchorError(a) => a.error_name.clone(),
        other => format!("non-Anchor error: {other:?}"),
    }
}

#[test]
fn rust_math_reproduces_the_domain_model_on_every_vector() {
    let doc: Value = serde_json::from_str(VECTORS).expect("tests/vectors/math.json parses");
    let vectors = doc["vectors"].as_array().expect("vectors array");
    assert_eq!(vectors.len() as u64, doc["count"].as_u64().unwrap());

    let mut failures = Vec::new();
    for (i, v) in vectors.iter().enumerate() {
        let f = v["fn"].as_str().unwrap();
        let a = v["args"].as_array().unwrap();

        let got: anchor_lang::Result<u64> = match f {
            "shares_for_contribution" => {
                shares_for_contribution(u64_arg(a, 0), u64_arg(a, 1), u128_arg(a, 2))
            }
            "entitlement_for_redemption" => {
                entitlement_for_redemption(u64_arg(a, 0), u64_arg(a, 1), u64_arg(a, 2))
            }
            "supply_consumption_bps" => supply_consumption_bps(u64_arg(a, 0), u64_arg(a, 1)),
            "weight_bps" => weight_bps(u128_arg(a, 0), u128_arg(a, 1)),
            "transfer_fee_amount" => {
                let bps: u16 = a[1].as_str().unwrap().parse().unwrap();
                transfer_fee_amount(u64_arg(a, 0), bps, u64_arg(a, 2))
            }
            other => panic!("vector {i}: unknown function {other}"),
        };

        let expected = match (v.get("ok"), v.get("err")) {
            (Some(ok), None) => Ok(ok.as_str().unwrap().parse::<u64>().unwrap()),
            (None, Some(err)) => Err(err.as_str().unwrap().to_string()),
            _ => panic!("vector {i}: needs exactly one of ok / err"),
        };
        let actual = got.map_err(error_name);

        if actual != expected {
            failures.push(format!(
                "#{i} {f}({a:?}): rust {actual:?}, domain {expected:?}"
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} vectors disagree:\n{}",
        failures.len(),
        vectors.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
