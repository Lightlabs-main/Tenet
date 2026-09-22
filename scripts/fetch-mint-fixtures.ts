/**
 * Snapshot real mainnet mint accounts into tests/fixtures/mints/ for the
 * on-chain tests. Read-only: one getAccountInfo per mint.
 *
 *   node scripts/fetch-mint-fixtures.ts
 *
 * Why real bytes: vault creation runs the real Token-2022 program against the
 * mint's extensions (transfer fee, scaled UI amount, pausable, transfer hook,
 * permanent delegate). A hand-built mint would test the extensions we thought
 * of; a mainnet snapshot tests the ones that actually exist.
 *
 * Fixtures are dated snapshots, not live data. Re-run to refresh; the slot and
 * timestamp are recorded so a test failure can be traced to a mint change.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // classic SPL (V-014)
  SPACEX: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", // PreStocks, Token-2022 (V-002)
  OPENAI: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", // PreStocks, Token-2022
  AAPLx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", // xStocks (Backed), Token-2022 (V-010)
};

type AccountInfo = {
  context: { slot: number };
  value: { owner: string; lamports: number; data: [string, "base64"]; executable: boolean } | null;
};

async function getAccount(address: string): Promise<AccountInfo> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64", commitment: "finalized" }],
    }),
  });
  // Parsed as text first: lamports fit in a JS number, but keep the habit (V-018).
  const body = JSON.parse(await res.text());
  if (body.error) throw new Error(`${address}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const dir = new URL("../tests/fixtures/mints/", import.meta.url);
mkdirSync(dir, { recursive: true });

for (const [symbol, address] of Object.entries(MINTS)) {
  const info = await getAccount(address);
  if (!info.value) throw new Error(`${symbol} ${address}: account not found`);
  const data = Buffer.from(info.value.data[0], "base64");
  const fixture = {
    _comment: "Mainnet snapshot for tests. Regenerate with scripts/fetch-mint-fixtures.ts.",
    symbol,
    address,
    owner: info.value.owner,
    lamports: info.value.lamports,
    slot: info.context.slot,
    fetched_at: new Date().toISOString(),
    data_len: data.length,
    data_base64: info.value.data[0],
  };
  writeFileSync(new URL(`${symbol}.json`, dir), JSON.stringify(fixture, null, 1) + "\n");
  console.log(`${symbol.padEnd(7)} ${address}  owner=${info.value.owner.slice(0, 8)}…  ${data.length} bytes  slot ${info.context.slot}`);
}
