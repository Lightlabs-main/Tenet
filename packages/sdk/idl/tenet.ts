/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tenet.json`.
 */
export type Tenet = {
  "address": "FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v",
  "metadata": {
    "name": "tenet",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Collectively owned portfolios of tokenized stocks, governed by an on-chain investment constitution."
  },
  "instructions": [
    {
      "name": "addCircleAsset",
      "discriminator": [
        140,
        17,
        61,
        74,
        14,
        87,
        40,
        37
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "mandateAsset",
          "docs": [
            "Bound to this Circle's Mandate by its stored `mandate` field; the account",
            "type proves it is a genuine MandateAsset written by this program."
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 or classic — whichever owns this mint. Branch explicitly,",
            "never assume (V-002)."
          ]
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "circleAsset",
          "docs": [
            "Mint in the seed: a second vault for the same asset cannot exist."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Sized from the mint's own extensions: Anchor asks Token-2022 which",
            "account-side extensions this mint requires (transfer fee amount,",
            "pausable, transfer hook, ...), so real PreStocks/xStocks mints work."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "addMandateAsset",
      "discriminator": [
        179,
        206,
        218,
        42,
        140,
        54,
        45,
        186
      ],
      "accounts": [
        {
          "name": "author",
          "writable": true,
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "mandateAsset",
          "docs": [
            "Mint in the seed: a second add of the same mint fails because the",
            "account already exists. Duplicates are impossible, not merely rejected."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mandate"
              },
              {
                "kind": "account",
                "path": "registryEntry.mint",
                "account": "assetRegistryEntry"
              }
            ]
          }
        },
        {
          "name": "registryEntry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "registryEntry.mint",
                "account": "assetRegistryEntry"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetWeightBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "beginExecution",
      "discriminator": [
        148,
        246,
        18,
        188,
        252,
        93,
        187,
        14
      ],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "mandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "mandateAssetOut"
        },
        {
          "name": "circleAssetOut",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "outMint"
              }
            ]
          }
        },
        {
          "name": "sourceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "destVault",
          "writable": true
        },
        {
          "name": "inMint"
        },
        {
          "name": "outMint"
        },
        {
          "name": "sourceTokenProgram"
        },
        {
          "name": "destTokenProgram"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "executionAuth",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  101,
                  99,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "maxIn",
          "type": "u64"
        },
        {
          "name": "minOut",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "cancelContribution",
      "discriminator": [
        184,
        238,
        88,
        63,
        152,
        103,
        17,
        123
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "epochEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "contributorUsdc",
          "docs": [
            "Refund goes to an account the contributor controls, in USDC."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "cancelEpoch",
      "discriminator": [
        120,
        226,
        234,
        25,
        215,
        85,
        0,
        155
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "navSnapshot",
          "docs": [
            "Optional because cancellation may happen before a snapshot is opened."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "claimRedemptionAsset",
      "discriminator": [
        42,
        7,
        62,
        186,
        108,
        134,
        128,
        184
      ],
      "accounts": [
        {
          "name": "memberOwner",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "redemption",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "memberOwner"
              },
              {
                "kind": "account",
                "path": "redemption.seq",
                "account": "redemption"
              }
            ]
          }
        },
        {
          "name": "circleAsset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "redemptionAsset",
          "docs": [
            "Closed on claim, rent to the member: a second claim finds no account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "redemption"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Recorded at vault creation from the mint's owner; never assumed."
          ]
        },
        {
          "name": "memberTokenAccount",
          "docs": [
            "The member's own account for this asset."
          ],
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimRedemptionUsdc",
      "discriminator": [
        171,
        90,
        50,
        244,
        156,
        19,
        211,
        106
      ],
      "accounts": [
        {
          "name": "memberOwner",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "redemption",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "memberOwner"
              },
              {
                "kind": "account",
                "path": "redemption.seq",
                "account": "redemption"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "docs": [
            "Active capital only — never an epoch escrow (INV-002)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "redemptionAsset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "redemption"
              },
              {
                "kind": "account",
                "path": "activeUsdcVault.mint"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "memberUsdc",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeContributions",
      "discriminator": [
        148,
        16,
        30,
        62,
        42,
        145,
        78,
        31
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "epoch",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeEpoch",
      "discriminator": [
        13,
        87,
        7,
        133,
        109,
        14,
        83,
        25
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "contribute",
      "discriminator": [
        82,
        33,
        68,
        131,
        32,
        0,
        205,
        95
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "mandate"
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "docs": [
            "One per contributor per epoch; repeat contributions add to it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "contributorUsdc",
          "writable": true
        },
        {
          "name": "epochEscrow",
          "docs": [
            "The ESCROW for this epoch — derived, never the active vault. A caller",
            "cannot route a contribution into active capital."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "docs": [
            "Read for the pool-size cap."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createCircle",
      "discriminator": [
        186,
        99,
        49,
        131,
        31,
        51,
        13,
        198
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "circle",
          "docs": [
            "1:1 with the Mandate in v1: a second Circle for the same Mandate cannot",
            "be initialized at this address."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "docs": [
            "Active capital only. Pending contributions go to a per-epoch escrow,",
            "a different account (spec §22, INV-002)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createMandate",
      "discriminator": [
        230,
        170,
        158,
        68,
        33,
        169,
        16,
        158
      ],
      "accounts": [
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "mandateSeed"
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandateSeed"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "mandateParams"
            }
          }
        }
      ]
    },
    {
      "name": "endExecution",
      "discriminator": [
        167,
        104,
        37,
        207,
        92,
        147,
        230,
        237
      ],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true
        },
        {
          "name": "mandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "executionAuth",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  101,
                  99,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "executionAuth.nonce",
                "account": "executionAuth"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "inMint",
          "writable": true
        },
        {
          "name": "outMint",
          "writable": true
        },
        {
          "name": "mandateAssetOut"
        },
        {
          "name": "registryEntry"
        },
        {
          "name": "priceUpdate",
          "docs": [
            "Pyth Receiver `PriceUpdateV2`; freshness, feed binding, and confidence",
            "are checked in the handler before any price-dependent cap is applied."
          ]
        },
        {
          "name": "sourceVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "circleAssetOut",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "executionAuth.outMint",
                "account": "executionAuth"
              }
            ]
          }
        },
        {
          "name": "destVault",
          "writable": true
        },
        {
          "name": "sourceTokenProgram"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "finalizeEpoch",
      "discriminator": [
        159,
        93,
        117,
        217,
        63,
        44,
        249,
        76
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "epochEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "navSnapshot",
          "docs": [
            "Required only for rolling epochs. Epoch 0 intentionally remains",
            "oracle-free, so clients omit this account when `circle.total_shares ==",
            "0`; the handler rejects a rolling finalization without it."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "activeUsdcVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeMandate",
      "discriminator": [
        154,
        156,
        152,
        123,
        124,
        231,
        159,
        251
      ],
      "accounts": [
        {
          "name": "author",
          "signer": true,
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "forkMandate",
      "discriminator": [
        210,
        180,
        56,
        219,
        28,
        123,
        151,
        189
      ],
      "accounts": [
        {
          "name": "forker",
          "writable": true,
          "signer": true
        },
        {
          "name": "parentMandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "parentMandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "newMandateSeed"
        },
        {
          "name": "newMandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "newMandateSeed"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "forkMandateAsset",
      "discriminator": [
        133,
        4,
        157,
        72,
        136,
        131,
        188,
        46
      ],
      "accounts": [
        {
          "name": "forker",
          "writable": true,
          "signer": true
        },
        {
          "name": "parentMandate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "parentMandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "parentAsset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "parentMandate"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "newMandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "newMandate.mandateSeed",
                "account": "mandate"
              }
            ]
          }
        },
        {
          "name": "newAsset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "newMandate"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "registryEntry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "upgradeAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v"
        },
        {
          "name": "programData"
        },
        {
          "name": "usdcMint",
          "docs": [
            "USDC is classic SPL Token with 6 decimals (V-014). Asserted here rather",
            "than assumed: shares are defined as 1 per micro-USDC in Epoch 0, so a",
            "different decimals count would silently change what a share means."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "registryAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initiateRedemption",
      "discriminator": [
        115,
        149,
        159,
        170,
        179,
        169,
        44,
        56
      ],
      "accounts": [
        {
          "name": "memberOwner",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "memberOwner"
              }
            ]
          }
        },
        {
          "name": "redemption",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "memberOwner"
              },
              {
                "kind": "account",
                "path": "member.nextRedemptionSeq",
                "account": "member"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openEpoch",
      "discriminator": [
        75,
        57,
        218,
        33,
        173,
        254,
        207,
        136
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "docs": [
            "`index == circle.current_epoch`, and `current_epoch` advances only in",
            "`close_epoch`. Together with the epoch PDA being unique per index, this",
            "means epochs open strictly in order, one at a time: epoch N+1 cannot open",
            "before N completes, and N cannot be opened twice."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "mandate"
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "docs": [
            "The Circle's active USDC vault fixes which mint is USDC for this Circle",
            "(it was checked against Config at creation)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "epochEscrow",
          "docs": [
            "Anchor performs this `init` (a CPI into `token_program`) while loading",
            "accounts, before the `TokenProgramMismatch` constraint above is checked.",
            "A wrong token program is therefore refused by the token program itself",
            "and the transaction reverts — see the module note in circle.rs."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openNavSnapshot",
      "discriminator": [
        176,
        21,
        227,
        23,
        113,
        32,
        92,
        76
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "navSnapshot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  97,
                  118,
                  95,
                  115,
                  110,
                  97,
                  112,
                  115,
                  104,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "recordAssetNav",
      "discriminator": [
        87,
        118,
        219,
        144,
        251,
        168,
        29,
        147
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "circle",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "navSnapshot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  97,
                  118,
                  95,
                  115,
                  110,
                  97,
                  112,
                  115,
                  104,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              }
            ]
          }
        },
        {
          "name": "circleAsset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "mandateAsset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "registryEntry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "vault"
        },
        {
          "name": "mint"
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "refreshAssetMetadata",
      "discriminator": [
        126,
        229,
        129,
        225,
        64,
        140,
        47,
        119
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "registryEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The live mint is read directly. No caller-supplied observation is",
            "accepted, and the recorded token program must remain immutable."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "reserveRedemptionAsset",
      "discriminator": [
        27,
        236,
        21,
        56,
        237,
        137,
        14,
        102
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "redemption",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "redemption.owner",
                "account": "redemption"
              },
              {
                "kind": "account",
                "path": "redemption.seq",
                "account": "redemption"
              }
            ]
          }
        },
        {
          "name": "circleAsset",
          "docs": [
            "Seeds bind it to THIS circle; the snapshot bitmap binds it to this exit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "The vault balance read here is canonical."
          ]
        },
        {
          "name": "redemptionAsset",
          "docs": [
            "Mint in the seed: reserving the same asset twice for one exit is",
            "impossible — the account already exists."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "redemption"
              },
              {
                "kind": "account",
                "path": "circleAsset.mint",
                "account": "circleAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "reserveRedemptionUsdc",
      "discriminator": [
        14,
        64,
        32,
        207,
        189,
        246,
        147,
        197
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "redemption",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "redemption.owner",
                "account": "redemption"
              },
              {
                "kind": "account",
                "path": "redemption.seq",
                "account": "redemption"
              }
            ]
          }
        },
        {
          "name": "activeUsdcVault",
          "docs": [
            "ACTIVE capital only. Epoch escrows are not Circle capital and are never",
            "part of an exit (INV-002)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              }
            ]
          }
        },
        {
          "name": "redemptionAsset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "redemption"
              },
              {
                "kind": "account",
                "path": "activeUsdcVault.mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "settleContribution",
      "discriminator": [
        165,
        233,
        187,
        90,
        113,
        239,
        113,
        120
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "circle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  105,
                  114,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "circle.mandate",
                "account": "circle"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "epoch"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "docs": [
            "Closed on settlement, rent to its owner: a second settlement finds no",
            "account. Double settlement is impossible, not merely rejected."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "receipt.owner",
                "account": "contributionReceipt"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "circle"
              },
              {
                "kind": "account",
                "path": "receipt.owner",
                "account": "contributionReceipt"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "upsertRegistryEntry",
      "discriminator": [
        55,
        211,
        145,
        211,
        167,
        199,
        216,
        161
      ],
      "accounts": [
        {
          "name": "registryAuthority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "registryEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "`InterfaceAccount` proves the mint exists and is owned by the classic or",
            "Token-2022 program. Which one is recorded, never assumed (V-002)."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "registryParams"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "assetRegistryEntry",
      "discriminator": [
        234,
        239,
        108,
        165,
        185,
        162,
        7,
        84
      ]
    },
    {
      "name": "circle",
      "discriminator": [
        27,
        59,
        8,
        117,
        62,
        199,
        222,
        252
      ]
    },
    {
      "name": "circleAsset",
      "discriminator": [
        60,
        218,
        229,
        120,
        92,
        97,
        60,
        212
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "contributionReceipt",
      "discriminator": [
        191,
        236,
        159,
        86,
        162,
        165,
        122,
        95
      ]
    },
    {
      "name": "epoch",
      "discriminator": [
        93,
        83,
        120,
        89,
        151,
        138,
        152,
        108
      ]
    },
    {
      "name": "executionAuth",
      "discriminator": [
        186,
        68,
        149,
        252,
        120,
        82,
        26,
        116
      ]
    },
    {
      "name": "mandate",
      "discriminator": [
        113,
        216,
        98,
        159,
        185,
        63,
        55,
        18
      ]
    },
    {
      "name": "mandateAsset",
      "discriminator": [
        72,
        46,
        243,
        193,
        251,
        24,
        54,
        196
      ]
    },
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    },
    {
      "name": "navSnapshot",
      "discriminator": [
        19,
        170,
        155,
        175,
        66,
        136,
        181,
        32
      ]
    },
    {
      "name": "redemption",
      "discriminator": [
        112,
        75,
        232,
        189,
        22,
        114,
        156,
        203
      ]
    },
    {
      "name": "redemptionAsset",
      "discriminator": [
        186,
        90,
        140,
        135,
        220,
        187,
        217,
        208
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6001,
      "name": "mathUnderflow",
      "msg": "Arithmetic underflow"
    },
    {
      "code": 6002,
      "name": "divisionByZero",
      "msg": "Division by zero"
    },
    {
      "code": 6003,
      "name": "invalidMandateName",
      "msg": "Mandate name is empty or too long"
    },
    {
      "code": 6004,
      "name": "invalidMandateDescription",
      "msg": "Mandate description is too long"
    },
    {
      "code": 6005,
      "name": "invalidBps",
      "msg": "A basis-point value exceeds 10000"
    },
    {
      "code": 6006,
      "name": "invalidMinContribution",
      "msg": "Minimum contribution must be greater than zero"
    },
    {
      "code": 6007,
      "name": "invalidMaxPoolSize",
      "msg": "Maximum pool size must exceed the minimum contribution"
    },
    {
      "code": 6008,
      "name": "invalidEpochDuration",
      "msg": "Epoch duration is outside the permitted range"
    },
    {
      "code": 6009,
      "name": "invalidAmendmentThreshold",
      "msg": "Amendment threshold must be a supermajority"
    },
    {
      "code": 6010,
      "name": "invalidAmendmentDelay",
      "msg": "Amendment delay is below the minimum"
    },
    {
      "code": 6011,
      "name": "emptyAssetUniverse",
      "msg": "Mandate asset universe is empty"
    },
    {
      "code": 6012,
      "name": "targetWeightsExceedTotal",
      "msg": "Target weights exceed 100%"
    },
    {
      "code": 6013,
      "name": "invalidMandateState",
      "msg": "Mandate is not in the required state"
    },
    {
      "code": 6014,
      "name": "tooManyAssets",
      "msg": "Circle already holds the maximum number of assets"
    },
    {
      "code": 6015,
      "name": "notMandateAuthor",
      "msg": "Signer is not the mandate author"
    },
    {
      "code": 6016,
      "name": "notMemberOwner",
      "msg": "Signer is not the member owner"
    },
    {
      "code": 6017,
      "name": "notRegistryAuthority",
      "msg": "Signer is not the registry authority"
    },
    {
      "code": 6018,
      "name": "accountSubstitution",
      "msg": "Account does not belong to this circle"
    },
    {
      "code": 6019,
      "name": "mintMismatch",
      "msg": "Mint does not match the expected mint"
    },
    {
      "code": 6020,
      "name": "tokenProgramMismatch",
      "msg": "Token program does not own this mint"
    },
    {
      "code": 6021,
      "name": "unexpectedUsdcMint",
      "msg": "USDC mint or decimals do not match the expected configuration"
    },
    {
      "code": 6022,
      "name": "epochNotOpen",
      "msg": "Epoch is not open for contributions"
    },
    {
      "code": 6023,
      "name": "epochNotClosed",
      "msg": "Epoch has not closed yet"
    },
    {
      "code": 6024,
      "name": "epochNotFinalized",
      "msg": "Epoch has not been finalized"
    },
    {
      "code": 6025,
      "name": "epochIndexMismatch",
      "msg": "Epoch index does not follow the current epoch"
    },
    {
      "code": 6026,
      "name": "previousEpochIncomplete",
      "msg": "Previous epoch is not complete"
    },
    {
      "code": 6027,
      "name": "belowMinimumContribution",
      "msg": "Contribution is below the mandate minimum"
    },
    {
      "code": 6028,
      "name": "exceedsMaxPoolSize",
      "msg": "Contribution would exceed the maximum pool size"
    },
    {
      "code": 6029,
      "name": "alreadySettled",
      "msg": "Receipt has already been settled"
    },
    {
      "code": 6030,
      "name": "unsettledReceipts",
      "msg": "Receipts remain unsettled"
    },
    {
      "code": 6031,
      "name": "navSnapshotIncomplete",
      "msg": "NAV snapshot is incomplete"
    },
    {
      "code": 6032,
      "name": "navSnapshotExpired",
      "msg": "NAV snapshot has expired"
    },
    {
      "code": 6033,
      "name": "assetAlreadyRecorded",
      "msg": "Asset has already been recorded in this snapshot"
    },
    {
      "code": 6034,
      "name": "zeroNav",
      "msg": "Circle NAV is zero; entrants cannot be priced"
    },
    {
      "code": 6035,
      "name": "navBelowIssuanceMinimum",
      "msg": "Circle NAV is below the minimum required to issue shares"
    },
    {
      "code": 6036,
      "name": "stalePrice",
      "msg": "Price is stale"
    },
    {
      "code": 6037,
      "name": "priceConfidenceTooWide",
      "msg": "Price confidence interval is too wide"
    },
    {
      "code": 6038,
      "name": "feedIdMismatch",
      "msg": "Price feed id does not match the registry entry"
    },
    {
      "code": 6039,
      "name": "assetNotInMandate",
      "msg": "Asset is not in the mandate universe"
    },
    {
      "code": 6040,
      "name": "executionFrozen",
      "msg": "Execution is frozen while a redemption is unreserved"
    },
    {
      "code": 6041,
      "name": "insufficientUnreservedBalance",
      "msg": "Execution would spend more than the unreserved balance"
    },
    {
      "code": 6042,
      "name": "belowMinimumOutput",
      "msg": "Execution received less than the minimum output"
    },
    {
      "code": 6043,
      "name": "aboveMaximumInput",
      "msg": "Execution spent more than the maximum input"
    },
    {
      "code": 6044,
      "name": "priceImpactTooHigh",
      "msg": "Execution breached the price impact cap"
    },
    {
      "code": 6045,
      "name": "assetWeightCapExceeded",
      "msg": "Execution breached a single-asset weight cap"
    },
    {
      "code": 6046,
      "name": "issuerWeightCapExceeded",
      "msg": "Execution breached the issuer weight cap"
    },
    {
      "code": 6047,
      "name": "preIpoWeightCapExceeded",
      "msg": "Execution breached the pre-IPO weight cap"
    },
    {
      "code": 6048,
      "name": "authorizationExpired",
      "msg": "Execution authorization has expired"
    },
    {
      "code": 6049,
      "name": "authorizationCircleMismatch",
      "msg": "Execution authorization does not bind this circle"
    },
    {
      "code": 6050,
      "name": "unexpectedInstructionInWindow",
      "msg": "A non-Jupiter instruction appeared in the execution window"
    },
    {
      "code": 6051,
      "name": "insufficientShares",
      "msg": "Member holds fewer shares than requested"
    },
    {
      "code": 6052,
      "name": "zeroShares",
      "msg": "Redemption amount must be greater than zero"
    },
    {
      "code": 6053,
      "name": "alreadyReserved",
      "msg": "Asset has already been reserved for this redemption"
    },
    {
      "code": 6054,
      "name": "notReserved",
      "msg": "Asset has not been reserved for this redemption"
    },
    {
      "code": 6055,
      "name": "alreadyClaimed",
      "msg": "Claim has already been settled"
    },
    {
      "code": 6056,
      "name": "navSnapshotOpen",
      "msg": "A NAV snapshot is open; redemption cannot start"
    },
    {
      "code": 6057,
      "name": "parentMandateNotActive",
      "msg": "Parent mandate must be active to fork"
    },
    {
      "code": 6058,
      "name": "amendmentThresholdNotMet",
      "msg": "Amendment has not met the required threshold"
    },
    {
      "code": 6059,
      "name": "amendmentDelayNotElapsed",
      "msg": "Amendment delay has not elapsed"
    },
    {
      "code": 6060,
      "name": "alreadyVoted",
      "msg": "Member has already voted on this proposal"
    },
    {
      "code": 6061,
      "name": "invalidRegistryMetadata",
      "msg": "Live mint metadata is invalid or cannot be represented safely"
    },
    {
      "code": 6062,
      "name": "notUpgradeAuthority",
      "msg": "Signer is not the program's upgrade authority"
    },
    {
      "code": 6063,
      "name": "programDataMismatch",
      "msg": "Program data account does not belong to this program"
    },
    {
      "code": 6064,
      "name": "invalidRegistryString",
      "msg": "Symbol or display name is empty or too long"
    },
    {
      "code": 6065,
      "name": "assetClassMismatch",
      "msg": "Asset class does not match the mint's token program or configured USDC mint"
    },
    {
      "code": 6066,
      "name": "registryEntryInactive",
      "msg": "Registry entry is not active"
    },
    {
      "code": 6067,
      "name": "underlyingWeightCapExceeded",
      "msg": "Weights on one underlying company exceed the Mandate's cap"
    },
    {
      "code": 6068,
      "name": "incompleteMandateAssets",
      "msg": "Every Mandate asset and its registry entry must be supplied exactly once"
    },
    {
      "code": 6069,
      "name": "contributionWindowClosed",
      "msg": "The contribution window for this epoch has closed"
    },
    {
      "code": 6070,
      "name": "contributionWindowStillOpen",
      "msg": "The contribution window is still open"
    },
    {
      "code": 6071,
      "name": "membershipPolicyRejected",
      "msg": "This Circle's membership policy does not admit this contributor"
    },
    {
      "code": 6072,
      "name": "rollingEpochsDisabled",
      "msg": "Rolling epochs require a NAV snapshot and are disabled until oracle pricing ships"
    },
    {
      "code": 6073,
      "name": "escrowShortfall",
      "msg": "Epoch escrow holds less than its receipts promise"
    },
    {
      "code": 6074,
      "name": "redemptionPending",
      "msg": "Another exit has unreserved assets; reserve them first (anyone may)"
    },
    {
      "code": 6075,
      "name": "assetNotInSnapshot",
      "msg": "Asset was added after this redemption began and is not part of it"
    },
    {
      "code": 6076,
      "name": "nothingToReserve",
      "msg": "Every asset of this redemption is already reserved"
    },
    {
      "code": 6077,
      "name": "incompleteExecutionWindow",
      "msg": "The execution window did not contain a Jupiter swap and matching end instruction"
    },
    {
      "code": 6078,
      "name": "existingVaultDelegate",
      "msg": "The source vault already has a delegate"
    },
    {
      "code": 6079,
      "name": "sourceBalanceIncreased",
      "msg": "The source vault balance increased during execution"
    },
    {
      "code": 6080,
      "name": "destinationBalanceDecreased",
      "msg": "The destination vault balance decreased during execution"
    },
    {
      "code": 6081,
      "name": "executionPricePolicyUnavailable",
      "msg": "Execution price policy is unavailable; execution remains gated"
    },
    {
      "code": 6082,
      "name": "supplyConsumptionCapExceeded",
      "msg": "Circle holdings would exceed the Mandate's raw supply-consumption cap"
    },
    {
      "code": 6083,
      "name": "priceObservationUnavailable",
      "msg": "The Pyth price observation is missing, stale, or insufficiently verified"
    },
    {
      "code": 6084,
      "name": "priceNotPositive",
      "msg": "The Pyth price must be strictly positive"
    },
    {
      "code": 6085,
      "name": "priceArithmeticOverflow",
      "msg": "Price arithmetic exceeded the checked execution range"
    },
    {
      "code": 6086,
      "name": "priceImpactExceeded",
      "msg": "Actual output is below the Mandate's Pyth price-impact floor"
    }
  ],
  "types": [
    {
      "name": "assetClass",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "usdc"
          },
          {
            "name": "publicTokenizedEquity"
          },
          {
            "name": "preIpo"
          }
        ]
      }
    },
    {
      "name": "assetRegistryEntry",
      "docs": [
        "Classification plus live, observable mint state.",
        "",
        "The two halves have different trust models, which is why `upsert_registry_entry`",
        "(authority-gated judgement) and `refresh_asset_metadata` (permissionless fact)",
        "are separate instructions — decision A-16."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "assetClass",
            "type": {
              "defined": {
                "name": "assetClass"
              }
            }
          },
          {
            "name": "issuer",
            "docs": [
              "The token issuer — Backed, PreStocks — i.e. counterparty risk."
            ],
            "type": "pubkey"
          },
          {
            "name": "underlyingId",
            "docs": [
              "The underlying company. Distinct from `issuer`: SPCXx and SPACEX are the",
              "same underlying through different issuers (V-010, `REVIEW.md` R-23)."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "displayName",
            "type": "string"
          },
          {
            "name": "pythFeedTokenized",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pythFeedUnderlying",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "assetStatus"
              }
            }
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "rawSupply",
            "type": "u64"
          },
          {
            "name": "effectiveMultiplierE18",
            "docs": [
              "Effective multiplier, scaled by 1e18. Selected by comparing the mint's",
              "`newMultiplierEffectiveTimestamp` against the clock — reading the",
              "`multiplier` field alone is wrong on live mainnet data (V-003, V-017,",
              "V-026). Display only; never enters ownership accounting (INV-019)."
            ],
            "type": "u128"
          },
          {
            "name": "activeTransferFeeBps",
            "docs": [
              "Fee in force at the CURRENT epoch, not simply `newerTransferFee` (V-004)."
            ],
            "type": "u16"
          },
          {
            "name": "activeTransferFeeMax",
            "type": "u64"
          },
          {
            "name": "issuerControls",
            "docs": [
              "Bitflags: 1 permanent delegate · 2 freeze · 4 paused · 8 transfer hook.",
              "Powers Tenet cannot constrain, so they are surfaced, not hidden (R-09)."
            ],
            "type": "u8"
          },
          {
            "name": "lastVerifiedSlot",
            "type": "u64"
          },
          {
            "name": "lastVerifiedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "assetStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "restricted"
          },
          {
            "name": "disabled"
          }
        ]
      }
    },
    {
      "name": "circle",
      "docs": [
        "Pooled capital governed by one Mandate.",
        "",
        "Holds no token balances: every vault's own `amount` is authoritative."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "circleState"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "reservedShares",
            "docs": [
              "Derived aggregate of `Σ over open epochs (reserved − settled)`.",
              "",
              "Makes INV-001 checkable in a single account read instead of iterating",
              "epochs — which matters because it is asserted after every step of the",
              "fuzz harness. Not a second source of truth: the property test recomputes",
              "the per-epoch sum and asserts the two agree (decision A-14)."
            ],
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "type": "u64"
          },
          {
            "name": "memberCount",
            "docs": [
              "Number of Members with a non-zero share balance. This is updated on",
              "zero→positive settlement and positive→zero redemption transitions."
            ],
            "type": "u32"
          },
          {
            "name": "assetCount",
            "type": "u16"
          },
          {
            "name": "pendingReservations",
            "docs": [
              "Redemptions whose reservations are incomplete. Execution is frozen while",
              "this is non-zero — but note the freeze alone is NOT sufficient: spending",
              "must also respect `balance − reserved` (`REVIEW.md` H-01)."
            ],
            "type": "u32"
          },
          {
            "name": "executionFrozen",
            "docs": [
              "Set while a NAV snapshot is open, so vault balances cannot move",
              "underneath a valuation in progress."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "docs": [
              "Bump of the `VaultAuthority` PDA, which signs every vault transfer.",
              "Stored so each signing does not re-derive it."
            ],
            "type": "u8"
          },
          {
            "name": "usdcReservedRaw",
            "docs": [
              "USDC promised to exiting members and not yet claimed — an OBLIGATION,",
              "not a balance (the vault's own `amount` stays authoritative). Every",
              "debit of the active USDC vault must use `amount − usdc_reserved_raw`",
              "(REVIEW.md H-01). Asset vaults carry the same on `CircleAsset`."
            ],
            "type": "u64"
          },
          {
            "name": "assetBitmap",
            "docs": [
              "Bit `i` set when the vault for Mandate asset index `i` exists. Exits",
              "snapshot this to know exactly which vaults they cover."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "circleAsset",
      "docs": [
        "One asset held by a Circle, and the vault that holds it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "mandateAsset",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "Stored because a Circle holds BOTH token programs at once: classic SPL",
              "for USDC (V-014) and Token-2022 for every tokenized equity (V-002,",
              "V-010). Assuming one program anywhere in the custody path is a bug."
            ],
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "assetStatus"
              }
            }
          },
          {
            "name": "reservedForRedemptionRaw",
            "docs": [
              "Raw units already promised to exiting members and not yet claimed.",
              "Every debit of this vault must use `vault.amount − reserved`."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "circleState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "funding"
          },
          {
            "name": "active"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Program-wide settings. Decision A-18.",
        "",
        "The spec referenced `config.registry_authority` and `config.usdc_mint`",
        "without ever defining the account. It holds exactly those two values and no",
        "custody power. It is created once, by the program's upgrade authority, so",
        "nobody can race the deployer to choose the registry authority."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registryAuthority",
            "docs": [
              "Classifies mints (pre-IPO? which issuer?). A disclosed trust",
              "assumption, R-13 — it can mislabel an asset but cannot move funds."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "The only mint Circles accept as USDC (V-014)."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "contributionReceipt",
      "docs": [
        "A member's pending contribution for one epoch.",
        "",
        "Cancellable by the owner before finalization, with no admin approval anywhere",
        "in that path (spec §10, §20)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcRaw",
            "type": "u64"
          },
          {
            "name": "sharesEntitled",
            "type": "u64"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "epochState"
              }
            }
          },
          {
            "name": "pendingUsdcRaw",
            "type": "u64"
          },
          {
            "name": "totalSharesBefore",
            "docs": [
              "Frozen at finalization. Settlement divides by these two rather than a",
              "precomputed rate, which keeps every intermediate inside u128 and makes",
              "the result reproducible and order-independent (decision A-17)."
            ],
            "type": "u64"
          },
          {
            "name": "navBefore",
            "type": "u128"
          },
          {
            "name": "reservedShares",
            "type": "u64"
          },
          {
            "name": "settledShares",
            "type": "u64"
          },
          {
            "name": "receiptCount",
            "type": "u32"
          },
          {
            "name": "settledCount",
            "type": "u32"
          },
          {
            "name": "finalizedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochState",
      "docs": [
        "Explicit states — never inferred from timestamps alone (spec §30).",
        "",
        "`Cancelled` is a safety valve, not a failure: when prices cannot be trusted",
        "the honest outcome is to refuse to price new shares and let contributors take",
        "their money back, rather than guess a NAV."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "finalized"
          },
          {
            "name": "executing"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "executionAuth",
      "docs": [
        "Authorization for one execution.",
        "",
        "Seeded on a nonce and closed on use, so replay fails at account init rather",
        "than at a flag check (INV-020)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "inMint",
            "type": "pubkey"
          },
          {
            "name": "outMint",
            "type": "pubkey"
          },
          {
            "name": "maxIn",
            "type": "u64"
          },
          {
            "name": "minOut",
            "type": "u64"
          },
          {
            "name": "preInBalance",
            "type": "u64"
          },
          {
            "name": "preOutBalance",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandate",
      "docs": [
        "The investment constitution. Rules, never money."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "mandateSeed",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "mandateState"
              }
            }
          },
          {
            "name": "assetCount",
            "type": "u16"
          },
          {
            "name": "maxWeightPerAssetBps",
            "type": "u16"
          },
          {
            "name": "maxPreIpoWeightBps",
            "type": "u16"
          },
          {
            "name": "maxIssuerWeightBps",
            "docs": [
              "Cap on exposure to one token ISSUER — counterparty risk."
            ],
            "type": "u16"
          },
          {
            "name": "maxUnderlyingWeightBps",
            "docs": [
              "Cap on exposure to one UNDERLYING company — investment concentration.",
              "Separate from the issuer cap because the same company can be held through",
              "two different issuers (V-010, R-23)."
            ],
            "type": "u16"
          },
          {
            "name": "maxSupplyConsumptionBps",
            "type": "u16"
          },
          {
            "name": "maxPriceImpactBps",
            "type": "u16"
          },
          {
            "name": "minContributionUsdc",
            "type": "u64"
          },
          {
            "name": "maxPoolSizeUsdc",
            "type": "u64"
          },
          {
            "name": "epochDuration",
            "type": "i64"
          },
          {
            "name": "membershipPolicy",
            "type": {
              "defined": {
                "name": "membershipPolicy"
              }
            }
          },
          {
            "name": "amendmentThresholdBps",
            "type": "u16"
          },
          {
            "name": "amendmentDelaySeconds",
            "type": "i64"
          },
          {
            "name": "forkedFrom",
            "docs": [
              "Lineage. A fork records its parent and never touches it (INV-017)."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandateAsset",
      "docs": [
        "One permitted asset. Keyed on mint in the PDA seed, so a duplicate cannot be",
        "initialized at all."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "registryEntry",
            "type": "pubkey"
          },
          {
            "name": "targetWeightBps",
            "type": "u16"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandateParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "maxWeightPerAssetBps",
            "type": "u16"
          },
          {
            "name": "maxPreIpoWeightBps",
            "type": "u16"
          },
          {
            "name": "maxIssuerWeightBps",
            "type": "u16"
          },
          {
            "name": "maxUnderlyingWeightBps",
            "type": "u16"
          },
          {
            "name": "maxSupplyConsumptionBps",
            "type": "u16"
          },
          {
            "name": "maxPriceImpactBps",
            "type": "u16"
          },
          {
            "name": "minContributionUsdc",
            "type": "u64"
          },
          {
            "name": "maxPoolSizeUsdc",
            "type": "u64"
          },
          {
            "name": "epochDuration",
            "type": "i64"
          },
          {
            "name": "membershipPolicy",
            "type": {
              "defined": {
                "name": "membershipPolicy"
              }
            }
          },
          {
            "name": "amendmentThresholdBps",
            "type": "u16"
          },
          {
            "name": "amendmentDelaySeconds",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mandateState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "draft"
          },
          {
            "name": "active"
          }
        ]
      }
    },
    {
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "contributedBasisUsdc",
            "docs": [
              "A record of what was contributed. **Not** tax cost basis under any",
              "jurisdiction's methodology, and never presented as such (spec §28)."
            ],
            "type": "u64"
          },
          {
            "name": "joinedEpoch",
            "type": "u64"
          },
          {
            "name": "nextRedemptionSeq",
            "docs": [
              "Seq of this member's NEXT redemption; seeds its PDA so a member can exit",
              "in several parts, each a distinct account."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "membershipPolicy",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "inviteOnly"
          }
        ]
      }
    },
    {
      "name": "navSnapshot",
      "docs": [
        "NAV accumulated across transactions.",
        "",
        "Decouples the asset count from transaction size, and bounds the whole",
        "valuation to a slot window so an epoch cannot be priced at stale prices",
        "(decision A-05)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "pubkey"
          },
          {
            "name": "slotOpened",
            "type": "u64"
          },
          {
            "name": "navAccum",
            "type": "u128"
          },
          {
            "name": "assetsRemaining",
            "type": "u16"
          },
          {
            "name": "recordedBitmap",
            "docs": [
              "One bit per `CircleAsset.index`, so an asset cannot be counted twice."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "priceFeedMessage",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "docs": [
              "`FeedId` but avoid the type alias because of compatibility issues with Anchor's `idl-build` feature."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "exponent",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "docs": [
              "The timestamp of this price update in seconds"
            ],
            "type": "i64"
          },
          {
            "name": "prevPublishTime",
            "docs": [
              "The timestamp of the previous price update. This field is intended to allow users to",
              "identify the single unique price update for any moment in time:",
              "for any time t, the unique update is the one such that prev_publish_time < t <= publish_time.",
              "",
              "Note that there may not be such an update while we are migrating to the new message-sending logic,",
              "as some price updates on pythnet may not be sent to other chains (because the message-sending",
              "logic may not have triggered). We can solve this problem by making the message-sending mandatory",
              "(which we can do once publishers have migrated over).",
              "",
              "Additionally, this field may be equal to publish_time if the message is sent on a slot where",
              "where the aggregation was unsuccesful. This problem will go away once all publishers have",
              "migrated over to a recent version of pyth-agent."
            ],
            "type": "i64"
          },
          {
            "name": "emaPrice",
            "type": "i64"
          },
          {
            "name": "emaConf",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdateV2",
      "docs": [
        "A price update account. This account is used by the Pyth Receiver program to store a verified price update from a Pyth price feed.",
        "It contains:",
        "- `write_authority`: The write authority for this account. This authority can close this account to reclaim rent or update the account to contain a different price update.",
        "- `verification_level`: The [`VerificationLevel`] of this price update. This represents how many Wormhole guardian signatures have been verified for this price update.",
        "- `price_message`: The actual price update.",
        "- `posted_slot`: The slot at which this price update was posted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writeAuthority",
            "type": "pubkey"
          },
          {
            "name": "verificationLevel",
            "type": {
              "defined": {
                "name": "verificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "priceFeedMessage"
              }
            }
          },
          {
            "name": "postedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redemption",
      "docs": [
        "An in-flight exit. Shares are burned at initiation, so the entitlement is",
        "frozen against the vaults as they stood at that instant.",
        "",
        "Requires no price, no oracle, no approval (RULE 6, INV-014)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circle",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "sharesRedeemed",
            "type": "u64"
          },
          {
            "name": "totalSharesAtSnapshot",
            "type": "u64"
          },
          {
            "name": "assetsRemaining",
            "type": "u16"
          },
          {
            "name": "initiatedAt",
            "type": "i64"
          },
          {
            "name": "reservationDeadline",
            "docs": [
              "After this, anyone may force-complete the remaining reservations so one",
              "absent participant cannot freeze execution indefinitely (R-20)."
            ],
            "type": "i64"
          },
          {
            "name": "assetBitmapAtSnapshot",
            "docs": [
              "`circle.asset_bitmap` at initiation: exactly the vaults this exit covers.",
              "Only those may be reserved. Without it a vault added AFTER initiation",
              "(permissionless, and empty) could be reserved in place of a real asset,",
              "completing the exit with a real asset never reserved — a third party",
              "could do that to grief an exiter.",
              "",
              "A bitmap, not a count: `CircleAsset.index` is the asset's index in the",
              "MANDATE, so vaults need not exist for a contiguous `0..count`. With a",
              "count, a Circle holding only asset 1 would reject asset 1 (`1 < 1`), the",
              "exit could never complete, and every later exit and epoch would block."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "redemptionAsset",
      "docs": [
        "One asset's claim. Separate account per asset so a failure on one — a paused",
        "mint, a frozen account, a transfer hook — cannot trap the others (spec §65)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "redemption",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amountRaw",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registryParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetClass",
            "type": {
              "defined": {
                "name": "assetClass"
              }
            }
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "underlyingId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "displayName",
            "type": "string"
          },
          {
            "name": "pythFeedTokenized",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pythFeedUnderlying",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "assetStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "verificationLevel",
      "docs": [
        "Pyth price updates are bridged to all blockchains via Wormhole.",
        "Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.",
        "The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,",
        "so we also allow for partial verification.",
        "",
        "This enum represents how much a price update has been verified:",
        "- If `Full`, we have verified the signatures for two thirds of the current guardians.",
        "- If `Partial`, only `num_signatures` guardian signatures have been checked.",
        "",
        "# Warning",
        "Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "full"
          }
        ]
      }
    }
  ]
};
