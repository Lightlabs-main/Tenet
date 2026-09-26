/**
 * pnpm devnet:metadata — give the devnet test instruments a name, symbol and
 * logo that wallets display (Metaplex Token Metadata). DEVNET ONLY; the
 * operator signs as each mint's mint authority. Idempotent: mints that
 * already have metadata are skipped.
 *
 * Metadata JSON and logos are served by the web app at /tokens/<SYMBOL>.json.
 */
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type KeyPairSigner } from "@solana/kit";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from "../../src/spl";
import { findAdminPda, findFaucetPda, getSetTusdcMetadataInstruction } from "../../src/devnet/index";
import { connect, exists, loadKeypair, requireDeployment, send } from "./lib";

export const TOKEN_METADATA_PROGRAM = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SITE = process.env.TENET_SITE ?? "https://tenetstocks.website";

export const TOKEN_NAMES: Record<string, string> = {
  TNVDA: "NVDA Devnet Test", TAAPL: "AAPL Devnet Test", TSPY: "SPY Devnet Test",
  TSPACEX: "SpaceX Pre-IPO Devnet Test", TOPENAI: "OpenAI Pre-IPO Devnet Test",
  TANTHROPIC: "Anthropic Pre-IPO Devnet Test", TTSLA: "TSLA Devnet Test (Pyth price)",
  TVOO: "VOO Devnet Test (Pyth price)", TUSDC: "Tenet Devnet USDC",
};

const utf8 = (s: string) => new TextEncoder().encode(s);
function borshString(s: string): Uint8Array {
  const b = utf8(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}
const cat = (...parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export async function metadataAddress(mint: Address): Promise<Address> {
  const e = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: TOKEN_METADATA_PROGRAM, seeds: [utf8("metadata"), e.encode(TOKEN_METADATA_PROGRAM), e.encode(mint)],
  });
  return pda;
}

const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");

/**
 * Token Metadata `Create` (42) / `V1` (0) with TokenStandard::Fungible (2) —
 * the variant that supports Token-2022 mints. Layout: AssetData { name,
 * symbol, uri, seller_fee_bps u16, creators None, primary_sale_happened,
 * is_mutable, token_standard, collection None, uses None, collection_details
 * None, rule_set None }, decimals None, print_supply None.
 */
export async function createMetadataIx(mint: Address, tokenProgram: Address, authority: KeyPairSigner, name: string, symbol: string, uri: string): Promise<Instruction> {
  if (utf8(name).length > 32 || utf8(symbol).length > 10 || utf8(uri).length > 200) throw new RangeError(`${symbol}: metadata field too long`);
  const signer = (s: KeyPairSigner, w: boolean) => ({ address: s.address, role: w ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER, signer: s });
  return {
    programAddress: TOKEN_METADATA_PROGRAM,
    accounts: [
      { address: await metadataAddress(mint), role: AccountRole.WRITABLE },
      { address: TOKEN_METADATA_PROGRAM, role: AccountRole.READONLY }, // master edition: none
      { address: mint, role: AccountRole.WRITABLE },
      signer(authority, false), // mint authority
      signer(authority, true), // payer
      signer(authority, false), // update authority
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: cat([42, 0], borshString(name), borshString(symbol), borshString(uri), [0, 0], [0], [0], [1], [2], [0], [0], [0], [0], [0], [0]),
  };
}

async function main() {
  const d = requireDeployment();
  const ctx = await connect();
  const op = await loadKeypair();
  for (const i of d.instruments) {
    const mint = i.mint as Address;
    if (await exists(ctx, await metadataAddress(mint))) { console.log(`  ${i.symbol}: metadata already set`); continue; }
    const ix = await createMetadataIx(mint, i.tokenProgram as Address, op, TOKEN_NAMES[i.symbol] ?? i.symbol, i.symbol, `${SITE}/tokens/${i.symbol}.json`);
    await send(ctx, op, [ix], `${i.symbol}: wallet metadata "${TOKEN_NAMES[i.symbol]}"`);
  }
  // TUSDC's mint authority is the faucet PDA, so tenet-devnet signs for it.
  const tusdc = d.tusdcMint as Address;
  const metadata = await metadataAddress(tusdc);
  if (await exists(ctx, metadata)) { console.log("  TUSDC: metadata already set"); return; }
  await send(ctx, op, [getSetTusdcMetadataInstruction({
    operator: op, admin: (await findAdminPda())[0], faucet: (await findFaucetPda())[0], tusdcMint: tusdc, metadata,
    tokenMetadataProgram: TOKEN_METADATA_PROGRAM, sysvarInstructions: address("Sysvar1nstructions1111111111111111111111111"),
    tokenProgram: TOKEN_PROGRAM, systemProgram: SYSTEM_PROGRAM,
    name: TOKEN_NAMES.TUSDC!, symbol: "TUSDC", uri: `${SITE}/tokens/TUSDC.json`,
  })], `TUSDC: wallet metadata "${TOKEN_NAMES.TUSDC}" (signed by the faucet PDA)`);
}

if (process.argv[1]?.endsWith("metadata.ts")) {
  main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
}
