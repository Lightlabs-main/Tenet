/**
 * pnpm devnet:e2e — the whole product on Solana Devnet, with real
 * transactions: POOL -> EXECUTE -> VALUE -> EXIT -> FORK.
 *
 * DEVNET ONLY (genesis-hash checked). Uses the instruments recorded by
 * `pnpm devnet:setup`. The operator keypair FILE funds four fresh wallets with
 * a little SOL, authors the Mandate and moves one test price; every TUSDC
 * comes from the faucet, signed by the wallet that receives it. Every step
 * uses the same SDK flow builders as the web app, and every money movement is
 * verified by reading balances back from chain.
 *
 * Epochs use the 60-second minimum duration, so a run takes a few minutes.
 */
import assert from "node:assert/strict";
import { generateKeyPairSigner, type Address, type KeyPairSigner } from "@solana/kit";
import {
  MembershipPolicy, fetchCircle, fetchEpoch, fetchMandate, fetchMember, fetchMaybeMember, flows, pda,
  type MandateParamsInput,
} from "../src/index";
import {
  FRONTIER_TECHNOLOGY, circleBuyIx, faucetIxs, fetchMarket, fetchPriceFeed, findAdminPda, instrument, quoteBuy,
  transferFee, updateFeed, type DevnetInstrumentDeployment,
} from "../src/devnet/index";
import { TOKEN_PROGRAM, findAta, transferSolIx } from "../src/spl";
import { balance, connect, loadKeypair, requireDeployment, send, sendGroups, waitForChainTime, type Ctx } from "./devnet/lib";

const TUSDC = 1_000_000n;
const d = requireDeployment();
const usdcMint = d.tusdcMint as Address;
const bySymbol = new Map(d.instruments.map((i) => [i.symbol, i]));
const inst = (s: string): DevnetInstrumentDeployment => bySymbol.get(s) ?? (() => { throw new Error(`${s} not deployed`); })();
const assetRef = (s: string) => ({ mint: inst(s).mint as Address, tokenProgram: inst(s).tokenProgram as Address });

function frontierParams(over: Partial<MandateParamsInput> = {}): MandateParamsInput {
  const f = FRONTIER_TECHNOLOGY;
  return {
    name: f.name, description: f.description,
    maxWeightPerAssetBps: f.maxWeightPerAssetBps, maxPreIpoWeightBps: f.maxPreIpoWeightBps,
    maxIssuerWeightBps: f.maxIssuerWeightBps, maxUnderlyingWeightBps: f.maxUnderlyingWeightBps,
    maxSupplyConsumptionBps: f.maxSupplyConsumptionBps, maxPriceImpactBps: f.maxPriceImpactBps,
    minContributionUsdc: 10n * TUSDC, maxPoolSizeUsdc: 1_000_000n * TUSDC, epochDuration: 60n,
    membershipPolicy: MembershipPolicy.Open, amendmentThresholdBps: 6_667, amendmentDelaySeconds: 86_400n,
    ...over,
  };
}

async function price(ctx: Ctx, symbol: string) {
  return (await fetchPriceFeed(ctx.rpc, inst(symbol).feed as Address)).data;
}

/** The Circle's value, computed here from real vault balances and feeds. */
async function liveNav(ctx: Ctx, circle: Address, symbols: readonly string[]): Promise<bigint> {
  const c = (await fetchCircle(ctx.rpc, circle)).data;
  let nav = (await balance(ctx, (await pda.usdcVault(circle))[0])) - c.usdcReservedRaw;
  for (const s of symbols) nav += await valueOf(ctx, circle, s);
  return nav;
}

async function valueOf(ctx: Ctx, circle: Address, symbol: string): Promise<bigint> {
  const bal = await balance(ctx, (await pda.assetVault(circle, inst(symbol).mint as Address))[0]);
  return (bal * (await price(ctx, symbol)).price) / 10n ** BigInt(inst(symbol).decimals);
}

async function epochNav(ctx: Ctx, circle: Address, index: bigint): Promise<bigint> {
  const e = (await fetchEpoch(ctx.rpc, (await pda.epoch(circle, index))[0])).data;
  return e.navBefore + e.pendingUsdcRaw;
}

let nonce = BigInt(Date.now());

/** Execute one asset up to 99% of its target headroom; verify both legs. */
async function executeToTarget(ctx: Ctx, executor: KeyPairSigner, circle: Address, mandate: Address, symbol: string, targetBps: number) {
  const current = (await fetchCircle(ctx.rpc, circle)).data.currentEpoch;
  const nav = await epochNav(ctx, circle, current - 1n);
  const held = await valueOf(ctx, circle, symbol);
  const spend = ((nav * BigInt(targetBps)) / 10_000n - held) * 99n / 100n;
  const i = inst(symbol);
  const market = (await fetchMarket(ctx.rpc, i.market as Address)).data;
  const p = await price(ctx, symbol);
  const quote = quoteBuy(spend, p.price, i.decimals, market.spreadBps);
  const usdcVault = (await pda.usdcVault(circle))[0];
  const dest = (await pda.assetVault(circle, i.mint as Address))[0];
  const [in0, out0] = [await balance(ctx, usdcVault), await balance(ctx, dest)];
  const venue = [await circleBuyIx({ executor, circle, mint: i.mint as Address, assetTokenProgram: i.tokenProgram as Address, amountInRaw: spend, minOutRaw: quote })];
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ixs = await flows.execute({
    executor, circle, mandate, usdcMint, epochIndex: current - 1n, asset: assetRef(symbol), priceAccount: i.feed as Address,
    nonce: nonce++, maxIn: spend, minOut: quote, expiresAt: now + 300n, venue,
  });
  await send(ctx, executor, ixs, `execute ${symbol}: ${Number(spend) / 1e6} TUSDC -> ${Number(quote) / 10 ** i.decimals} ${symbol}`);
  const [in1, out1] = [await balance(ctx, usdcVault), await balance(ctx, dest)];
  assert.equal(in0 - in1, spend, `${symbol}: TUSDC spent`);
  const spec = instrument(symbol);
  const fee = spec.extension.kind === "transferFee" ? transferFee(quote, spec.extension.bps, spec.extension.maxFee) : 0n;
  assert.equal(out1 - out0, quote - fee, `${symbol}: delivered into the Circle vault`);
}

async function runEpoch(ctx: Ctx, payer: KeyPairSigner, circle: Address, mandate: Address, index: bigint, owners: Address[], symbols: readonly string[]) {
  const e = (await fetchEpoch(ctx.rpc, (await pda.epoch(circle, index))[0])).data;
  await waitForChainTime(ctx, e.closesAt, `epoch ${index} to close`);
  await sendGroups(ctx, payer, [await flows.closeContributions({ payer, circle, index })], `close epoch ${index} contributions`);
  if (index === 0n) {
    await sendGroups(ctx, payer, [await flows.finalizeEpochZero({ payer, circle, usdcMint })], "finalize epoch 0");
  } else {
    const assets = symbols.map((s) => ({ ...assetRef(s), priceAccount: inst(s).feed as Address }));
    await sendGroups(ctx, payer, await flows.finalizeRollingEpoch({ payer, circle, mandate, usdcMint, index, assets }), `finalize epoch ${index} at on-chain NAV`);
  }
  await sendGroups(ctx, payer, await flows.settle({ payer, circle, index, owners }), `settle epoch ${index}`);
  await sendGroups(ctx, payer, [await flows.closeEpoch({ payer, circle, index })], `complete epoch ${index}`);
}

async function main() {
  const ctx = await connect();
  const op = await loadKeypair();
  const symbols = FRONTIER_TECHNOLOGY.targets.map(([s]) => s);
  console.log(`Tenet devnet end-to-end — operator ${op.address}`);

  // ---- wallets: SOL from the operator for fees/rent, TUSDC from the faucet.
  const [alice, bob, carol, dave] = await Promise.all([0, 1, 2, 3].map(() => generateKeyPairSigner()));
  const wallets = { alice: alice!, bob: bob!, carol: carol!, dave: dave! };
  await send(ctx, op, Object.values(wallets).map((w) => transferSolIx(op, w.address, 60_000_000n)), "fund 4 wallets with 0.06 SOL each");
  for (const [name, w] of Object.entries(wallets)) {
    await send(ctx, w, await faucetIxs(w), `${name}: Get test USDC (1,000 TUSDC)`);
    assert.equal(await balance(ctx, await findAta(w.address, usdcMint, TOKEN_PROGRAM)), 1_000n * TUSDC);
  }

  // ---- POOL
  const seed = (await generateKeyPairSigner()).address;
  const assets = FRONTIER_TECHNOLOGY.targets.map(([s, bps]) => ({ ...assetRef(s), targetWeightBps: bps }));
  const created = await flows.createMandateAndCircle({ author: op, mandateSeed: seed, params: frontierParams(), assets, usdcMint });
  const { mandate, circle } = created;
  await sendGroups(ctx, op, created.groups, "create Mandate 'Frontier Technology' + Circle + Epoch 0");
  for (const [name, w, amt] of [["alice", wallets.alice, 500n], ["bob", wallets.bob, 300n], ["carol", wallets.carol, 200n]] as const) {
    await send(ctx, w, await flows.contribute({ contributor: w, circle, mandate, usdcMint, index: 0n, amount: amt * TUSDC }), `${name} contributes ${amt} TUSDC`);
  }
  const daveUsdc = await findAta(wallets.dave.address, usdcMint, TOKEN_PROGRAM);
  await send(ctx, wallets.dave, await flows.contribute({ contributor: wallets.dave, circle, mandate, usdcMint, index: 0n, amount: 50n * TUSDC }), "dave contributes 50 TUSDC");
  await send(ctx, wallets.dave, await flows.cancelContribution({ contributor: wallets.dave, circle, usdcMint, index: 0n }), "dave cancels (refund from escrow)");
  assert.equal(await balance(ctx, daveUsdc), 1_000n * TUSDC);
  const members = [wallets.alice.address, wallets.bob.address, wallets.carol.address];
  await runEpoch(ctx, op, circle, mandate, 0n, members, symbols);
  assert.equal((await fetchMember(ctx.rpc, (await pda.member(circle, wallets.alice.address))[0])).data.shares, 500n * TUSDC);
  const nav0 = await epochNav(ctx, circle, 0n);
  assert.equal(nav0, 1_000n * TUSDC);

  // ---- EXECUTE: each asset to its Mandate target, through the devnet market.
  for (const [s, bps] of FRONTIER_TECHNOLOGY.targets) await executeToTarget(ctx, op, circle, mandate, s, bps);
  console.log(`  NAV after execution: ${Number(await liveNav(ctx, circle, symbols)) / 1e6} TUSDC`);

  // ---- VALUE: TNVDA +10%, then a rolling epoch admits dave at on-chain NAV.
  const [admin] = await findAdminPda();
  const tnvda = await price(ctx, "TNVDA");
  await send(ctx, op, [await updateFeed({ operator: op, admin, feed: inst("TNVDA").feed as Address, prices: { price: 110_000_000n, conf: tnvda.conf, referenceMark: tnvda.referenceMark, underlyingPrice: 112_000_000n } })], "TNVDA test price 100 -> 110 (devnet pricing simulation)");
  await sendGroups(ctx, op, [await flows.openEpoch({ payer: op, circle, mandate, usdcMint, index: 1n })], "open epoch 1");
  await send(ctx, wallets.dave, await flows.contribute({ contributor: wallets.dave, circle, mandate, usdcMint, index: 1n, amount: 100n * TUSDC }), "dave contributes 100 TUSDC to epoch 1");
  const e1 = (await fetchEpoch(ctx.rpc, (await pda.epoch(circle, 1n))[0])).data;
  await waitForChainTime(ctx, e1.closesAt, "epoch 1 to close");
  const expectedNav = await liveNav(ctx, circle, symbols);
  await runEpoch(ctx, op, circle, mandate, 1n, [wallets.dave.address], symbols);
  const nav1 = (await fetchEpoch(ctx.rpc, (await pda.epoch(circle, 1n))[0])).data.navBefore;
  assert.equal(nav1, expectedNav, "on-chain NAV equals the independently computed NAV");
  const daveShares = (await fetchMember(ctx.rpc, (await pda.member(circle, wallets.dave.address))[0])).data.shares;
  assert.equal(daveShares, (100n * TUSDC * 1_000n * TUSDC) / nav1);
  console.log(`  epoch 1 NAV ${Number(nav1) / 1e6} TUSDC; dave received ${daveShares} shares for 100 TUSDC`);

  // ---- EXIT in kind: alice 25%, bob 50%, carol 100%.
  for (const [name, w, pct] of [["alice", wallets.alice, 25n], ["bob", wallets.bob, 50n], ["carol", wallets.carol, 100n]] as const) {
    const member = (await fetchMember(ctx.rpc, (await pda.member(circle, w.address))[0])).data;
    const shares = (member.shares * pct) / 100n;
    const groups = await flows.exitInKind({ owner: w, circle, seq: member.nextRedemptionSeq, shares, assets: symbols.map(assetRef), usdcMint });
    await sendGroups(ctx, w, groups, `${name} exits ${pct}% in kind`);
    const after = await fetchMaybeMember(ctx.rpc, (await pda.member(circle, w.address))[0]);
    assert.equal(after.exists ? after.data.shares : 0n, member.shares - shares);
    const got = await balance(ctx, await findAta(w.address, inst("TNVDA").mint as Address, inst("TNVDA").tokenProgram as Address));
    assert.ok(got > 0n, `${name} holds TNVDA in their own wallet`);
  }

  // ---- FORK: pre-IPO cap 30% -> 15%, own Circle, funded and executed.
  const childTargets = [["TNVDA", 3_000], ["TAAPL", 2_500], ["TSPY", 2_500], ["TSPACEX", 750], ["TOPENAI", 750]] as const;
  const fork = await flows.forkMandateAndCircle({
    forker: wallets.dave, parentMandate: mandate, newMandateSeed: (await generateKeyPairSigner()).address,
    params: frontierParams({ name: "Frontier Technology — Lower Pre-IPO", maxPreIpoWeightBps: 1_500 }),
    assets: childTargets.map(([s, bps]) => ({ ...assetRef(s), targetWeightBps: bps })), usdcMint,
  });
  await send(ctx, op, [transferSolIx(op, wallets.dave.address, 150_000_000n)], "top up dave for the fork's accounts");
  await sendGroups(ctx, wallets.dave, fork.groups, "dave forks the Mandate (pre-IPO 15%) + new Circle");
  const child = (await fetchMandate(ctx.rpc, fork.mandate)).data;
  assert.equal(child.forkedFrom.__option, "Some");
  assert.equal(child.maxPreIpoWeightBps, 1_500);
  await send(ctx, wallets.dave, await flows.contribute({ contributor: wallets.dave, circle: fork.circle, mandate: fork.mandate, usdcMint, index: 0n, amount: 400n * TUSDC }), "dave funds the fork with 400 TUSDC");
  await runEpoch(ctx, wallets.dave, fork.circle, fork.mandate, 0n, [wallets.dave.address], symbols);
  for (const [s, bps] of childTargets) await executeToTarget(ctx, wallets.dave, fork.circle, fork.mandate, s, bps);

  console.log(`\n✓ POOL -> EXECUTE -> VALUE -> EXIT -> FORK complete on Devnet`);
  console.log(`  Mandate ${mandate}\n  Circle  ${circle}\n  Fork    ${fork.mandate} (Circle ${fork.circle})`);
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}`);
  process.exit(1);
});
