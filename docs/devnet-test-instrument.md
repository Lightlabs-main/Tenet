# Devnet test instrument

TST-EQ is a fixed-inventory Token-2022 instrument used only to test Tenet's Devnet asset-vault path. It is not a stock, security, economic exposure to an issuer, market-priced asset, or promise of redemption.

The test conversion is one raw test unit per raw test-USDC unit (both use six decimals). That ratio exists only to test custody and exact balance deltas; it is not a price, NAV input, performance result, or valuation. The Circle receives units only from fixed inventory. Exiting returns the Member's proportional test-token balance; there is no promise that the test-market reserve returns USDC.

## Sequence

1. The wallet initializes the fixed test market and inventory.
2. The wallet creates a separate test Circle and Epoch 0.
3. A Member contributes project test-USDC into Epoch escrow and settles the contribution.
4. After settlement, the Member may allocate active test-USDC to TST-EQ.
5. Exiting returns the proportional TST-EQ balance.

Normal Jupiter execution for public tokenized equities remains unavailable. The test path must not show issuer names, equity prices, Pyth observations, performance, or shareholder rights.

## Funding and deployment state

The project's existing Devnet USDC mint is 8XcK83nbTAtdvfHCFWLCAEHigHDBAGuEachzQss9oCkt. A read-only observation found a 6-decimal classic SPL mint, supply 110,000,000 raw units, mint authority 9pCJ96uVkHb6wiSvbSpTNL99A3jsieQ9R8w6A9s2o6aE, and no freeze authority. No verified authority key or faucet is available in the inspected VPS deployment-key locations; the app must not fabricate a faucet.

The candidate Tenet SBF artifact is 1,149,176 bytes and SHA-256 bac5398fc6e020b5c39692555ddb2d68a789cf6fc5367de8ef7f9d5fbc5d2ce2. The deployed program is older (819,472 bytes, hash 4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f). Wallet actions stay disabled until the on-chain program-data hash equals the tested candidate hash. The configured upgrade authority is the user's public wallet F5WouUdTmk6n4SaSTZLrE9PCUrArnWdGYwykqPH2jBiK; its private key must remain in that wallet and must not be sent to chat or copied to the VPS.

A rent query for a buffer sized to the new binary returned 5.83846432 Devnet SOL. This is a test-network amount, not a USD price or Mainnet SOL requirement. No Devnet airdrop, mint, program upgrade, or user-wallet transaction has been sent.

## Validation

tests/program/tests/devnet_test_market.rs exercises initialization, vault binding, account-substitution rejection, and Epoch escrow separation using deterministic LiteSVM fixtures. Passing these tests proves local program behavior only; it does not prove deployment or funding on public Devnet.
