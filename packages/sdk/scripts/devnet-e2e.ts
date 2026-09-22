/**
 * Devnet end-to-end: the Phase 2 exit criterion ("a real wallet completes
 * contribute -> finalize -> settle on devnet"), plus an exit and claim.
 *
 *   cd packages/sdk && node --import tsx scripts/devnet-e2e.ts
 *
 * DEVNET ONLY. The RPC URL is fixed below and checked. The test "USDC" is a
 * devnet mint created for this run (.keys/devnet.env) — NOT Circle USDC — and
 * the test equity is a plain Token-2022 mint. The program does not hardcode a
 * USDC mint (Config carries it), so this exercises the same code path.
 *
 * Every address comes from the SDK: Codama's generated PDA helpers where they
 * exist, and the Rust-verified seeds in src/pda.ts for the rest. Every money
 * step is checked by reading balances back from the chain.
 */
import { readFileSync } from "node:fs";
import {
  AccountRole, address, appendTransactionMessageInstructions, assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, fetchEncodedAccount,
  generateKeyPairSigner, getAddressEncoder, getProgramDerivedAddress, getSignatureFromTransaction,
  pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner,
} from "@solana/kit";
import {
  AssetClass, AssetStatus, MembershipPolicy, TENET_PROGRAM_ADDRESS,
  contribute, createMandate, initiateRedemption, openEpoch, seeds,
  fetchMaybeConfig, fetchCircle, fetchEpoch, fetchMember, fetchRedemptionAsset,
  findActiveUsdcVaultPda, findCircleAssetPda, findCirclePda, findConfigPda, findEpochEscrowPda,
  findEpochPda, findMandatePda, findMemberPda, findReceiptPda, findRegistryEntryPda,
  findVaultAuthorityPda, findVaultPda,
  getAddCircleAssetInstructionAsync, getAddMandateAssetInstruction,
  getClaimRedemptionAssetInstructionAsync, getClaimRedemptionUsdcInstructionAsync,
  getCloseContributionsInstruction, getCloseEpochInstruction, getCreateCircleInstructionAsync,
  getFinalizeEpochInstructionAsync, getFinalizeMandateInstruction,
  getInitializeConfigInstructionAsync, getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstructionAsync, getSettleContributionInstruction,
  getUpsertRegistryEntryInstructionAsync,
} from "../src/index";

// ---------------------------------------------------------------- devnet only

const RPC_URL = "https://api.devnet.solana.com";
const WS_URL = "wss://api.devnet.solana.com";
if (!RPC_URL.includes("devnet")) throw new Error("REFUSING: not devnet");

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const USDC = 1_000_000n; // 1 test-USDC in raw units

const env = Object.fromEntries(
  readFileSync(new URL("../../../.keys/devnet.env", import.meta.url), "utf8")
    .trim().split("\n").map((l: string) => l.split("=") as [string, string]),
);
const TEST_USDC = address(env.TEST_USDC);
const TEST_EQUITY = address(env.TEST_EQUITY);
const USDC_ATA = address(env.USDC_ATA);
const EQUITY_ATA = address(env.EQUITY_ATA);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

// ---------------------------------------------------------------- helpers

const enc = getAddressEncoder();
const bytes = (a: Address) => new Uint8Array(enc.encode(a));

/** Derive with the SDK's Rust-verified seeds (for PDAs Codama did not generate). */
async function pda(seedList: Uint8Array[]): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress: TENET_PROGRAM_ADDRESS, seeds: seedList });
  return a;
}

async function send(label: string, payer: KeyPairSigner, ixs: Instruction[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const msg = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(ixs, m),
      );
      const tx = await signTransactionMessageWithSigners(msg);
      assertIsTransactionWithBlockhashLifetime(tx);
      await sendAndConfirm(tx, { commitment: "confirmed" });
      console.log(`  ✓ ${label.padEnd(28)} ${getSignatureFromTransaction(tx)}`);
      return;
    } catch (e) {
      // Retry only transport hiccups; a program error is a real failure.
      const msg = String((e as Error)?.message ?? e);
      const programError = /custom program error|InstructionError|Program .* failed/i.test(msg);
      if (programError || attempt >= 3) {
        console.error(`  ✗ ${label}: ${msg}`);
        const logs = (e as { context?: { logs?: string[] } })?.context?.logs;
        if (logs) console.error(logs.slice(-8).join("\n"));
        throw e;
      }
      console.log(`  … ${label}: retrying after transport error (${attempt})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function tokenAmount(account: Address): Promise<bigint> {
  const { value } = await rpc.getTokenAccountBalance(account, { commitment: "confirmed" }).send();
  return BigInt(value.amount); // parsed from the string: never through a JS number (V-018)
}

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(`CHECK FAILED: ${what}`);
  console.log(`  ✓ ${what}`);
}

// ---------------------------------------------------------------- run

const keyBytes = new Uint8Array(JSON.parse(readFileSync(
  "\\\\wsl.localhost\\Debian\\root\\.config\\solana\\tenet-devnet.json", "utf8")));
const wallet = await createKeyPairSignerFromBytes(keyBytes);
console.log(`devnet e2e — wallet ${wallet.address}, program ${TENET_PROGRAM_ADDRESS}`);
console.log(`test USDC ${TEST_USDC} (devnet test mint, NOT Circle USDC)`);

// 1. Config — once per program deployment.
console.log("\n[config]");
const [configPda] = await findConfigPda();
const existing = await fetchMaybeConfig(rpc, configPda);
if (existing.exists) {
  check(existing.data.usdcMint === TEST_USDC, "existing Config points at the test USDC mint");
} else {
  const [programData] = await getProgramDerivedAddress({
    programAddress: address("BPFLoaderUpgradeab1e11111111111111111111111"),
    seeds: [bytes(TENET_PROGRAM_ADDRESS)],
  });
  await send("initialize_config", wallet, [await getInitializeConfigInstructionAsync({
    upgradeAuthority: wallet, programData, usdcMint: TEST_USDC, registryAuthority: wallet.address,
  })]);
}

// 2. Registry — classify the test equity (idempotent upsert).
console.log("\n[registry]");
const [registryEntry] = await findRegistryEntryPda({ mint: TEST_EQUITY });
await send("upsert_registry_entry", wallet, [await getUpsertRegistryEntryInstructionAsync({
  registryAuthority: wallet, registryEntry, mint: TEST_EQUITY,
  assetClass: AssetClass.PublicTokenizedEquity, issuer: wallet.address,
  underlyingId: new Uint8Array(16).fill(7), symbol: "TEQx",
  displayName: "Devnet Test Equity", pythFeedTokenized: new Uint8Array(32),
  pythFeedUnderlying: new Uint8Array(32), status: AssetStatus.Active,
})]);

// 3. Mandate — a fresh one per run, 60-second epochs.
console.log("\n[mandate]");
const mandateSeed = (await generateKeyPairSigner()).address;
const [mandate] = await findMandatePda({ mandateSeed });
await send("create_mandate", wallet, [await createMandate({
  author: wallet, mandateSeed, mandate,
  name: `Devnet E2E ${new Date().toISOString().slice(0, 16)}`, description: "Phase 2 exit criterion run",
  maxWeightPerAssetBps: 4_000, maxPreIpoWeightBps: 3_000, maxIssuerWeightBps: 6_000,
  maxUnderlyingWeightBps: 5_000, maxSupplyConsumptionBps: 100, maxPriceImpactBps: 100,
  minContributionUsdc: 1n * USDC, maxPoolSizeUsdc: 1_000n * USDC, epochDuration: 60n,
  membershipPolicy: MembershipPolicy.Open, amendmentThresholdBps: 6_667, amendmentDelaySeconds: 86_400n,
})]);
const mandateAsset = await pda(seeds.mandateAsset(bytes(mandate), bytes(TEST_EQUITY)));
await send("add_mandate_asset", wallet, [await getAddMandateAssetInstruction({
  author: wallet, mandate, mandateAsset, registryEntry, targetWeightBps: 4_000,
})]);
const finalize = getFinalizeMandateInstruction({ author: wallet, mandate });
await send("finalize_mandate", wallet, [{
  ...finalize,
  accounts: [
    ...finalize.accounts,
    { address: mandateAsset, role: AccountRole.READONLY },
    { address: registryEntry, role: AccountRole.READONLY },
  ],
}]);

// 4. Circle.
console.log("\n[circle]");
const [circle] = await findCirclePda({ mandate });
const [vaultAuthority] = await findVaultAuthorityPda({ circle });
const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle });
await send("create_circle", wallet, [await getCreateCircleInstructionAsync({
  creator: wallet, mandate, circle, vaultAuthority, activeUsdcVault, usdcMint: TEST_USDC, tokenProgram: TOKEN,
})]);
const [circleAsset] = await findCircleAssetPda({ circle, mint: TEST_EQUITY });
const [vault] = await findVaultPda({ circle, mint: TEST_EQUITY });
await send("add_circle_asset", wallet, [await getAddCircleAssetInstructionAsync({
  payer: wallet, circle, mandateAsset, circleAsset, vault, vaultAuthority, mint: TEST_EQUITY, tokenProgram: TOKEN_2022,
})]);

// --setup-only: stop here, leaving a Circle with no shares so a person can open
// Epoch 0 and run the whole flow from a browser wallet.
if (process.argv.includes("--setup-only")) {
  console.log(`\nREADY for a browser run. Circle (no shares yet, epoch 0 not opened):\n  ${circle}`);
  process.exit(0);
}

// 5. Epoch 0 — THE Phase 2 exit criterion.
console.log("\n[epoch 0]");
const [epoch] = await findEpochPda({ circle, index: 0n });
const [epochEscrow] = await findEpochEscrowPda({ circle, index: 0n });
await send("open_epoch", wallet, [await openEpoch({
  payer: wallet, circle, mandate, epoch, epochEscrow, activeUsdcVault, usdcMint: TEST_USDC,
  vaultAuthority, tokenProgram: TOKEN, index: 0n,
})]);

const before = await tokenAmount(USDC_ATA);
const [receipt] = await findReceiptPda({ epoch, contributor: wallet.address });
await send("contribute 5 test-USDC", wallet, [await contribute({
  contributor: wallet, circle, mandate, epoch, receipt, contributorUsdc: USDC_ATA, epochEscrow,
  activeUsdcVault, usdcMint: TEST_USDC, tokenProgram: TOKEN, amount: 5n * USDC,
})]);
check((await tokenAmount(USDC_ATA)) === before - 5n * USDC, "wallet debited exactly 5 test-USDC");
check((await tokenAmount(epochEscrow)) === 5n * USDC, "5 test-USDC in the EPOCH ESCROW");
check((await tokenAmount(activeUsdcVault)) === 0n, "active vault untouched while pending (INV-002)");

const closesAt = (await fetchEpoch(rpc, epoch)).data.closesAt;
for (;;) {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  const now = await rpc.getBlockTime(slot).send(); // may be null for a very recent slot
  if (now !== null && BigInt(now) >= closesAt) break;
  process.stdout.write(`  … waiting for the contribution window (${closesAt - BigInt(now ?? 0)}s)\r`);
  await new Promise((r) => setTimeout(r, 5000));
}
console.log("");
await send("close_contributions", wallet, [getCloseContributionsInstruction({ payer: wallet, epoch })]);
await send("finalize_epoch", wallet, [await getFinalizeEpochInstructionAsync({
  payer: wallet, circle, epoch, epochEscrow, activeUsdcVault, usdcMint: TEST_USDC, vaultAuthority, tokenProgram: TOKEN,
})]);
check((await tokenAmount(activeUsdcVault)) === 5n * USDC, "escrow swept into active capital");

const [member] = await findMemberPda({ circle, memberOwner: wallet.address });
await send("settle_contribution", wallet, [await getSettleContributionInstruction({
  payer: wallet, circle, epoch, receipt, owner: wallet.address, member,
})]);
await send("close_epoch", wallet, [getCloseEpochInstruction({ payer: wallet, circle, epoch })]);
const m = (await fetchMember(rpc, member)).data;
const c = (await fetchCircle(rpc, circle)).data;
check(m.shares === 5n * USDC, "member holds 5,000,000 shares (1 per micro-USDC, exact)");
check(c.totalShares === 5n * USDC && c.reservedShares === 0n, "circle: total 5,000,000, none reserved");
check(m.shares + c.reservedShares === c.totalShares, "INV-001 holds on devnet");

// 6. Exit — half the shares, claimed back in kind.
console.log("\n[exit]");
const redemption = await pda(seeds.redemption(bytes(circle), bytes(wallet.address), 0n));
await send("initiate_redemption", wallet, [await initiateRedemption({
  memberOwner: wallet, circle, member, redemption, shares: 2_500_000n,
})]);
const redemptionUsdc = await pda(seeds.redemptionAsset(bytes(redemption), bytes(TEST_USDC)));
const redemptionEquity = await pda(seeds.redemptionAsset(bytes(redemption), bytes(TEST_EQUITY)));
await send("reserve_redemption_asset", wallet, [await getReserveRedemptionAssetInstruction({
  payer: wallet, circle, redemption, circleAsset, vault, redemptionAsset: redemptionEquity,
})]);
await send("reserve_redemption_usdc", wallet, [await getReserveRedemptionUsdcInstructionAsync({
  payer: wallet, circle, redemption, activeUsdcVault, redemptionAsset: redemptionUsdc,
})]);
check((await fetchRedemptionAsset(rpc, redemptionUsdc)).data.amountRaw === 2_500_000n, "entitled to exactly 2.5 test-USDC");

const beforeClaim = await tokenAmount(USDC_ATA);
await send("claim_redemption_usdc", wallet, [await getClaimRedemptionUsdcInstructionAsync({
  memberOwner: wallet, circle, redemption, activeUsdcVault, redemptionAsset: redemptionUsdc,
  usdcMint: TEST_USDC, tokenProgram: TOKEN, memberUsdc: USDC_ATA, vaultAuthority,
})]);
await send("claim_redemption_asset (0)", wallet, [await getClaimRedemptionAssetInstructionAsync({
  memberOwner: wallet, circle, redemption, circleAsset, redemptionAsset: redemptionEquity, vault,
  mint: TEST_EQUITY, tokenProgram: TOKEN_2022, memberTokenAccount: EQUITY_ATA, vaultAuthority,
})]);
check((await tokenAmount(USDC_ATA)) === beforeClaim + 2_500_000n, "2.5 test-USDC returned to the wallet");
check((await tokenAmount(activeUsdcVault)) === 2_500_000n, "circle keeps the other 2.5");
const after = (await fetchCircle(rpc, circle)).data;
check(after.totalShares === 2_500_000n && after.usdcReservedRaw === 0n && after.pendingReservations === 0,
  "circle: 2,500,000 shares left, no obligations or pending exits");

const acct = await fetchEncodedAccount(rpc, circle);
console.log(`\nDONE. circle ${circle} (${acct.exists ? "live" : "missing"}) on devnet.`);
