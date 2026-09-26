import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { isReadOnlyRpcPayload, MAINNET_RPC_URL } from "./policy.mjs";

const REQUEST_MAX_BYTES = 512_000;
const RESPONSE_MAX_BYTES = 8_000_000;
const RATE_WINDOW_MS = 60_000;
const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

/**
 * The only Pyth feeds served. Fixed server-side: the browser cannot ask for
 * anything else, and the API key (PYTH_API_KEY, from a root-only systemd
 * EnvironmentFile) never leaves this process.
 */
export const PYTH_FEEDS = [
  ["Equity.US.TSLA/USD", "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1"],
  ["Equity.US.QQQ/USD", "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d"],
  ["Equity.US.VOO/USD", "236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179"],
  ["Crypto.SOL/USD", "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"],
  ["Crypto.BTC/USD", "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"],
  ["Crypto.ETH/USD", "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"],
  ["Crypto.USDC/USD", "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"],
];
const PYTH_CACHE_MS = 3_000;

function replyJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  let oversized = false;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > REQUEST_MAX_BYTES) {
      oversized = true;
      continue;
    }
    if (!oversized) chunks.push(chunk);
  }
  return oversized ? null : Buffer.concat(chunks, size);
}

async function readResponseBody(response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > RESPONSE_MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function clientAddress(request) {
  const value = request.headers["x-tenet-client-ip"];
  if (typeof value === "string" && /^[0-9a-fA-F:.]{2,64}$/.test(value)) return value;
  return request.socket.remoteAddress ?? "unknown";
}

export function createRpcProxyServer({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  perClientLimit = 120,
  globalLimit = 1200,
  pythUrl = process.env.PYTH_HERMES_URL,
  pythKey = process.env.PYTH_API_KEY,
} = {}) {
  const clients = new Map();
  let pythCache = null; // { at, body }
  let globalStart = now();
  let globalCount = 0;

  function rateAllowed(address) {
    const current = now();
    if (current - globalStart >= RATE_WINDOW_MS) {
      globalStart = current;
      globalCount = 0;
    }
    if (globalCount >= globalLimit) return false;
    let state = clients.get(address);
    if (!state || current - state.start >= RATE_WINDOW_MS) {
      if (clients.size >= 4096 && !state) {
        for (const [ip, entry] of clients) {
          if (current - entry.start >= RATE_WINDOW_MS) clients.delete(ip);
        }
      }
      if (clients.size >= 4096 && !state) return false;
      state = { start: current, count: 0 };
      clients.set(address, state);
    }
    if (state.count >= perClientLimit) return false;
    state.count += 1;
    globalCount += 1;
    return true;
  }

  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/api/prestocks") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        return replyJson(response, 405, { error: "Only GET is supported for PreStocks market data." });
      }
      if (!rateAllowed(clientAddress(request))) {
        return replyJson(response, 429, { error: "PreStocks data rate limit exceeded." });
      }
      try {
        const upstream = await fetchImpl(PRESTOCKS_API_URL, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        const contentType = upstream.headers.get("content-type") ?? "";
        if (upstream.ok && !contentType.toLowerCase().includes("application/json")) {
          await upstream.body?.cancel();
          return replyJson(response, 502, { error: "PreStocks returned a non-JSON response." });
        }
        const upstreamBody = await readResponseBody(upstream);
        if (upstreamBody === null) {
          return replyJson(response, 502, { error: "PreStocks response exceeded the size limit." });
        }
        response.writeHead(upstream.status, {
          "content-type": contentType || "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(upstreamBody);
      } catch {
        replyJson(response, 502, { error: "The PreStocks source could not be reached." });
      }
      return;
    }
    if (path === "/api/pyth") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        return replyJson(response, 405, { error: "Only GET is supported for Pyth market data." });
      }
      if (!pythUrl || !pythKey) return replyJson(response, 503, { error: "Pyth access is not configured." });
      if (!rateAllowed(clientAddress(request))) return replyJson(response, 429, { error: "Pyth data rate limit exceeded." });
      if (pythCache && now() - pythCache.at < PYTH_CACHE_MS) return replyJson(response, 200, pythCache.body);
      try {
        const ids = PYTH_FEEDS.map(([, id]) => `ids[]=${id}`).join("&");
        const upstream = await fetchImpl(`${pythUrl.replace(/\/$/, "")}/v2/updates/price/latest?parsed=true&${ids}`, {
          headers: { accept: "application/json", authorization: `Bearer ${pythKey}` },
          signal: AbortSignal.timeout(8_000),
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return replyJson(response, 502, { error: `Pyth returned HTTP ${upstream.status}.` });
        }
        const raw = await readResponseBody(upstream);
        if (raw === null) return replyJson(response, 502, { error: "Pyth response exceeded the size limit." });
        const parsed = JSON.parse(raw.toString("utf8")).parsed ?? [];
        const byId = new Map(parsed.map((p) => [String(p.id).replace(/^0x/, ""), p]));
        // Integers stay strings: price and confidence are exact, never JS floats.
        const feeds = PYTH_FEEDS.flatMap(([symbol, id]) => {
          const p = byId.get(id)?.price;
          if (!p) return [];
          return [{ symbol, id, price: String(p.price), conf: String(p.conf), expo: Number(p.expo), publishTime: Number(p.publish_time) }];
        });
        const body = { source: "Pyth Network (Hermes)", fetchedAt: Math.floor(now() / 1000), feeds };
        pythCache = { at: now(), body };
        replyJson(response, 200, body);
      } catch {
        replyJson(response, 502, { error: "The Pyth source could not be reached." });
      }
      return;
    }
    if (path === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("ok");
      return;
    }
    if (path !== "/api/solana") return replyJson(response, 404, { error: "Not found." });
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      return replyJson(response, 405, { error: "Only JSON-RPC POST is supported." });
    }
    if ((request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return replyJson(response, 415, { error: "Content-Type must be application/json." });
    }
    if (!rateAllowed(clientAddress(request))) {
      return replyJson(response, 429, { error: "Read-only RPC rate limit exceeded." });
    }

    let body;
    try {
      body = await readRequestBody(request);
    } catch {
      return replyJson(response, 400, { error: "Could not read request body." });
    }
    if (body === null) return replyJson(response, 413, { error: "JSON-RPC request is too large." });

    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return replyJson(response, 400, { error: "Malformed JSON-RPC request." });
    }
    if (!isReadOnlyRpcPayload(payload)) {
      return replyJson(response, 403, { error: "Only approved read-only Tenet RPC methods are allowed." });
    }

    try {
      const upstream = await fetchImpl(MAINNET_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(12_000),
      });
      const upstreamBody = await readResponseBody(upstream);
      if (upstreamBody === null) {
        return replyJson(response, 502, { error: "Mainnet RPC response exceeded the size limit." });
      }
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(upstreamBody);
    } catch {
      replyJson(response, 502, { error: "The mainnet RPC request could not be completed." });
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TENET_RPC_PROXY_PORT ?? 8504);
  const server = createRpcProxyServer();
  server.listen(port, "127.0.0.1", () => {
    console.log("Tenet read-only mainnet RPC proxy listening on 127.0.0.1:" + port);
  });
}
