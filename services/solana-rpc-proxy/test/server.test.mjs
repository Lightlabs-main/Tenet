import assert from "node:assert/strict";
import { test } from "node:test";
import { createRpcProxyServer } from "../server.mjs";
import { isReadOnlyRpcPayload, TENET_PROGRAM_ID } from "../policy.mjs";

async function startServer(t, options = {}) {
  const server = createRpcProxyServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return "http://127.0.0.1:" + server.address().port;
}

const allowedRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "getAccountInfo",
  params: ["11111111111111111111111111111111", { encoding: "base64" }],
};

test("app-needed read methods are allowed but writes remain excluded", () => {
  for (const method of ["getAccountInfo", "getBalance", "getEpochInfo", "getLatestBlockhash", "getProgramAccounts", "getSignatureStatuses", "getTokenAccountBalance", "getTransaction"]) {
    const params = method === "getProgramAccounts" ? [TENET_PROGRAM_ID] : [];
    assert.equal(isReadOnlyRpcPayload({ jsonrpc: "2.0", id: 1, method, params }), true, method);
  }
  assert.equal(isReadOnlyRpcPayload({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [] }), false);
});

test("read-only proxy forwards without browser Origin", async (t) => {
  let calls = 0;
  const url = await startServer(t, {
    fetchImpl: async (target, init) => {
      calls += 1;
      assert.equal(target, "https://api.mainnet-beta.solana.com");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.origin, undefined);
      assert.equal(JSON.parse(init.body.toString()).method, "getAccountInfo");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await fetch(url + "/api/solana", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://38.49.209.149" },
    body: JSON.stringify(allowedRequest),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"value":null/);
  assert.equal(calls, 1);
});

test("PreStocks route uses only its fixed first-party source and GET", async (t) => {
  let calls = 0;
  const url = await startServer(t, {
    fetchImpl: async (target, init) => {
      calls += 1;
      assert.equal(target, "https://prestocks.com/api/prestocks");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.accept, "application/json");
      return new Response(JSON.stringify([{ symbol: "EXAMPLE", tokenPrice: 1.25 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await fetch(url + "/api/prestocks?url=https://attacker.invalid");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"tokenPrice":1.25/);
  assert.equal(calls, 1);

  const write = await fetch(url + "/api/prestocks", { method: "POST", body: "{}" });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET");
  assert.equal(calls, 1);
});

test("writes and foreign program scans are blocked before upstream", async (t) => {
  let calls = 0;
  const url = await startServer(t, { fetchImpl: async () => { calls += 1; return new Response("{}"); } });
  for (const request of [
    { jsonrpc: "2.0", id: 2, method: "sendTransaction", params: ["signed"] },
    { jsonrpc: "2.0", id: 3, method: "getProgramAccounts", params: ["11111111111111111111111111111111"] },
  ]) {
    const response = await fetch(url + "/api/solana", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});

test("malformed JSON and unsupported methods fail closed", async (t) => {
  const url = await startServer(t, { fetchImpl: async () => assert.fail("upstream must not be called") });
  const malformed = await fetch(url + "/api/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(url + "/api/solana")).status, 405);
});

test("oversized requests and batches fail closed", async (t) => {
  const url = await startServer(t, { fetchImpl: async () => assert.fail("upstream must not be called") });
  const oversized = await fetch(url + "/api/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(512_001),
  });
  assert.equal(oversized.status, 413);
  const batch = await fetch(url + "/api/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Array.from({ length: 17 }, (_, id) => ({ ...allowedRequest, id }))),
  });
  assert.equal(batch.status, 403);
});

test("per-client rate limit is enforced", async (t) => {
  const url = await startServer(t, {
    perClientLimit: 1,
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const request = () => fetch(url + "/api/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(allowedRequest),
  });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
});

test("Pyth route: fixed feed allowlist, key only sent upstream, exact strings, cached", async (t) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const ids = [...new URL(url).searchParams.getAll("ids[]")];
    return new Response(JSON.stringify({ parsed: ids.map((id) => ({ id, price: { price: "37241500000", conf: "1880000", expo: -8, publish_time: 1_790_000_000 } })) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const base = await startServer(t, { fetchImpl, pythUrl: "https://pyth.example/hermes", pythKey: "secret-key" });
  const res = await fetch(base + "/api/pyth?ids[]=deadbeef");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.feeds.length, 7);
  assert.equal(body.feeds[0].symbol, "Equity.US.TSLA/USD");
  assert.equal(body.feeds[0].price, "37241500000");
  assert.equal(JSON.stringify(body).includes("secret-key"), false, "key never returned");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-key");
  assert.equal(calls[0].url.includes("deadbeef"), false, "client-supplied ids are ignored");
  await fetch(base + "/api/pyth");
  assert.equal(calls.length, 1, "served from the 3 s cache");
  assert.equal((await fetch(base + "/api/pyth", { method: "POST" })).status, 405);
});

test("Pyth route fails closed without a configured key", async (t) => {
  const base = await startServer(t, { fetchImpl: async () => { throw new Error("must not be called"); }, pythUrl: undefined, pythKey: undefined });
  assert.equal((await fetch(base + "/api/pyth")).status, 503);
});
