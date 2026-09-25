/**
 * pnpm devnet:setup — make a deployed Tenet + tenet-devnet usable on Devnet.
 * DEVNET ONLY; idempotent: every step checks chain state first and is skipped
 * when already done, so re-running is always safe.
 *
 *   1. tenet-devnet `initialize` (admin, faucet, program-owned TUSDC mint)
 *   2. Tenet `initialize_config` on the Devnet profile (TUSDC, devnet venue
 *      and feeds) — or, if Config exists, verify it IS that profile
 *   3. per test instrument: Token-2022 mint (with its extension), price feed,
 *      market, inventory, registry entry — each verified after creation
 *   4. record every address in src/devnet/deployment.json
 *
 * Signs with the deployer keypair FILE (TENET_DEVNET_KEYPAIR), which must be
 * the upgrade authority of both programs. It is never printed or copied.
 */
import {
  generateKeyPairSigner, getAddressDecoder, getAddressEncoder, type Address, type Instruction, type KeyPairSigner,
} from "@solana/kit";
import {
  AssetClass, AssetStatus, Network, PriceSource, TENET_PROGRAM_ADDRESS, fetchMaybeConfig,
  getRefreshAssetMetadataInstruction, getUpsertRegistryEntryInstruction, initializeConfig, pda,
} from "../../src/index";
import {
  INSTRUMENTS, INVENTORY_UNITS, MARKET_SPREAD_BPS, TENET_DEVNET_PROGRAM_ADDRESS, createFeed,
  fetchMaybeMarket, fetchMaybePriceFeed, findAdminPda, findFaucetPda, findTusdcMintPda,
  getCreateMarketInstruction, getInitializeInstruction, marketAccounts, type DevnetInstrumentDeployment,
  type InstrumentSpec,
} from "../../src/devnet/index";
import {
  MINT_SIZE, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, createAccountIx, initializeMint2Ix,
  initializeScaledUiAmountIx, initializeTransferFeeConfigIx, mintToIx, mintSupply, programDataAddress,
} from "../../src/spl";
import {
  accountData, balance, connect, exists, explorerAddress, loadKeypair, readDeployment, send, writeDeployment,
  type Ctx,
} from "./lib";

const DEVNET_MAX_PRICE_AGE_SECONDS = 30n * 24n * 60n * 60n;

async function upgradeAuthority(ctx: Ctx, program: Address): Promise<string | null> {
  const d = await accountData(ctx, await programDataAddress(program));
  if (!d) return null;
  return d[12] === 1 ? getAddressDecoder().decode(d.slice(13, 45)) : null;
}

async function requirePrograms(ctx: Ctx, operator: KeyPairSigner) {
  for (const [name, id] of [["tenet", TENET_PROGRAM_ADDRESS], ["tenet_devnet", TENET_DEVNET_PROGRAM_ADDRESS]] as const) {
    const { value } = await ctx.rpc.getAccountInfo(id, { encoding: "base64" }).send();
    if (!value?.executable) throw new Error(`${name} (${id}) is not deployed on Devnet — deploy it first (see docs/devnet.md)`);
    const auth = await upgradeAuthority(ctx, id);
    if (auth !== operator.address) throw new Error(`${name} upgrade authority is ${auth}, not the configured keypair ${operator.address}`);
    console.log(`• ${name} deployed at ${id}, upgrade authority ${auth}`);
  }
}

async function initDevnet(ctx: Ctx, op: KeyPairSigner) {
  const [admin] = await findAdminPda();
  if (await exists(ctx, admin)) return console.log("• tenet-devnet already initialized");
  await send(ctx, op, [getInitializeInstruction({
    upgradeAuthority: op, program: TENET_DEVNET_PROGRAM_ADDRESS, programData: await programDataAddress(TENET_DEVNET_PROGRAM_ADDRESS),
    admin, faucet: (await findFaucetPda())[0], tusdcMint: (await findTusdcMintPda())[0], tokenProgram: TOKEN_PROGRAM,
    systemProgram: SYSTEM_PROGRAM, operator: op.address,
  })], "tenet-devnet initialize (TUSDC mint + faucet)");
}

async function initConfig(ctx: Ctx, op: KeyPairSigner, tusdc: Address) {
  const [config] = await pda.config();
  const existing = await fetchMaybeConfig(ctx.rpc, config);
  if (existing.exists) {
    const c = existing.data;
    const ok = c.network === Network.Devnet && c.usdcMint === tusdc && c.executionVenue === TENET_DEVNET_PROGRAM_ADDRESS
      && c.priceSource === PriceSource.DevnetFeed && c.priceProgram === TENET_DEVNET_PROGRAM_ADDRESS;
    if (!ok) throw new Error(`Config ${config} exists but is not the Devnet profile bound to TUSDC ${tusdc}: ${JSON.stringify(c, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    return console.log("• Tenet Config already initialized (Devnet profile, TUSDC)");
  }
  await send(ctx, op, [await initializeConfig({
    upgradeAuthority: op, config, program: TENET_PROGRAM_ADDRESS, programData: await programDataAddress(TENET_PROGRAM_ADDRESS),
    usdcMint: tusdc, systemProgram: SYSTEM_PROGRAM, registryAuthority: op.address, network: Network.Devnet,
    executionVenue: TENET_DEVNET_PROGRAM_ADDRESS, priceSource: PriceSource.DevnetFeed, priceProgram: TENET_DEVNET_PROGRAM_ADDRESS,
    maxPriceAgeSeconds: DEVNET_MAX_PRICE_AGE_SECONDS,
  })], "tenet initialize_config (Devnet profile)");
}

async function createMint(ctx: Ctx, op: KeyPairSigner, spec: InstrumentSpec): Promise<Address> {
  const mint = await generateKeyPairSigner();
  const ext = spec.extension;
  const space = ext.kind === "transferFee" ? MINT_SIZE.transferFee : ext.kind === "scaledUiAmount" ? MINT_SIZE.scaledUiAmount : MINT_SIZE.plain;
  const lamports = await ctx.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
  const ixs: Instruction[] = [createAccountIx(op, mint, lamports, space, TOKEN_2022_PROGRAM)];
  if (ext.kind === "transferFee") ixs.push(initializeTransferFeeConfigIx(mint.address, op.address, ext.bps, ext.maxFee));
  if (ext.kind === "scaledUiAmount") ixs.push(initializeScaledUiAmountIx(mint.address, op.address, ext.multiplier));
  ixs.push(initializeMint2Ix(TOKEN_2022_PROGRAM, mint.address, spec.decimals, op.address, null));
  await send(ctx, op, ixs, `${spec.symbol}: Token-2022 mint (${ext.kind}, ${spec.decimals} dp)`);
  return mint.address;
}

/** Read the mint back through the RPC's own parser and check what was asked for. */
async function verifyMint(ctx: Ctx, mint: Address, spec: InstrumentSpec) {
  const { value } = await ctx.rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send();
  const info = (value?.data as { parsed?: { info?: { decimals: number; extensions?: { extension: string; state: Record<string, unknown> }[] } } })?.parsed?.info;
  if (!info || info.decimals !== spec.decimals) throw new Error(`${spec.symbol}: mint ${mint} not parsed as a ${spec.decimals}-dp mint`);
  const exts = info.extensions ?? [];
  const ext = spec.extension;
  if (ext.kind === "transferFee") {
    const f = exts.find((e) => e.extension === "transferFeeConfig");
    const bps = (f?.state as { newerTransferFee?: { transferFeeBasisPoints?: number } } | undefined)?.newerTransferFee?.transferFeeBasisPoints;
    if (bps !== ext.bps) throw new Error(`${spec.symbol}: expected a ${ext.bps} bps transfer fee, chain says ${JSON.stringify(f)}`);
  }
  if (ext.kind === "scaledUiAmount" && !exts.some((e) => e.extension === "scaledUiAmountConfig")) {
    throw new Error(`${spec.symbol}: expected a ScaledUiAmount extension, chain says ${JSON.stringify(exts)}`);
  }
}

async function setupInstrument(ctx: Ctx, op: KeyPairSigner, spec: InstrumentSpec, known: string | undefined, tusdc: Address) {
  let mint = known as Address | undefined;
  if (mint && !(await exists(ctx, mint))) {
    console.log(`  ${spec.symbol}: recorded mint ${mint} no longer exists — creating a new one`);
    mint = undefined;
  }
  if (!mint) mint = await createMint(ctx, op, spec);
  await verifyMint(ctx, mint, spec);

  const m = await marketAccounts(mint);
  if (!(await fetchMaybePriceFeed(ctx.rpc, m.feed)).exists) {
    await send(ctx, op, [await createFeed({
      operator: op, admin: m.admin, mint, feed: m.feed, systemProgram: SYSTEM_PROGRAM, symbol: spec.symbol,
      prices: { price: spec.price, conf: 0n, referenceMark: spec.mark, underlyingPrice: spec.underlying },
    })], `${spec.symbol}: price feed ${Number(spec.price) / 1e6} TUSDC`);
  }
  if (!(await fetchMaybeMarket(ctx.rpc, m.market)).exists) {
    await send(ctx, op, [getCreateMarketInstruction({
      operator: op, admin: m.admin, mint, feed: m.feed, market: m.market, inventory: m.inventory, tusdcMint: tusdc,
      usdcVault: m.usdcVault, tokenProgram: TOKEN_2022_PROGRAM, usdcTokenProgram: TOKEN_PROGRAM, systemProgram: SYSTEM_PROGRAM,
      spreadBps: MARKET_SPREAD_BPS,
    })], `${spec.symbol}: market (${MARKET_SPREAD_BPS} bps spread)`);
  }
  const want = INVENTORY_UNITS * 10n ** BigInt(spec.decimals);
  const have = await balance(ctx, m.inventory);
  if (have < want / 2n) {
    await send(ctx, op, [mintToIx(TOKEN_2022_PROGRAM, mint, m.inventory, op, want - have)], `${spec.symbol}: inventory to ${INVENTORY_UNITS} units`);
  }

  // Registry: the feed id Tenet binds is the mint's own address bytes.
  const [registryEntry] = await pda.registry(mint);
  const [config] = await pda.config();
  const mintBytes = getAddressEncoder().encode(mint);
  const fill = (n: number, len: number) => new Uint8Array(len).fill(n);
  await send(ctx, op, [
    getUpsertRegistryEntryInstruction({
      registryAuthority: op, config, registryEntry, mint, systemProgram: SYSTEM_PROGRAM,
      assetClass: spec.assetClass === "preIpo" ? AssetClass.PreIpo : AssetClass.PublicTokenizedEquity,
      issuer: getAddressDecoder().decode(fill(spec.issuerId, 32)), underlyingId: fill(spec.underlyingId, 16),
      symbol: spec.symbol, displayName: spec.name, pythFeedTokenized: mintBytes, pythFeedUnderlying: fill(0, 32),
      status: AssetStatus.Active,
    }),
    getRefreshAssetMetadataInstruction({ payer: op, registryEntry, mint }),
  ], `${spec.symbol}: registry entry + metadata`);

  const supply = mintSupply((await accountData(ctx, mint))!);
  console.log(`  ${spec.symbol} ${explorerAddress(mint)}  supply ${supply.supply} raw`);
  return { symbol: spec.symbol, mint, tokenProgram: TOKEN_2022_PROGRAM, decimals: spec.decimals, feed: m.feed, market: m.market };
}

async function main() {
  const ctx = await connect();
  const op = await loadKeypair();
  console.log(`Tenet devnet setup — operator ${op.address}`);
  const { value: lamports } = await ctx.rpc.getBalance(op.address).send();
  console.log(`• operator balance ${Number(lamports) / 1e9} SOL`);
  await requirePrograms(ctx, op);
  await initDevnet(ctx, op);
  const [tusdc] = await findTusdcMintPda();
  await initConfig(ctx, op, tusdc);

  const record = readDeployment();
  const known = new Map((record.instruments ?? []).map((i) => [i.symbol, i.mint]));
  const instruments: DevnetInstrumentDeployment[] = [];
  for (const spec of INSTRUMENTS) {
    instruments.push(await setupInstrument(ctx, op, spec, known.get(spec.symbol), tusdc));
    // Persist progress after every instrument: a re-run resumes, never duplicates.
    writeDeployment({
      ...record, cluster: "devnet", tenetProgram: TENET_PROGRAM_ADDRESS, devnetProgram: TENET_DEVNET_PROGRAM_ADDRESS,
      operator: op.address, tusdcMint: tusdc, config: (await pda.config())[0],
      instruments: [...instruments, ...(record.instruments ?? []).filter((i) => !instruments.some((n) => n.symbol === i.symbol))],
      reference: record.reference ?? null,
    });
  }
  console.log(`\nDevnet ready. TUSDC ${tusdc}. Deployment recorded in packages/sdk/src/devnet/deployment.json`);
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}`);
  process.exit(1);
});
