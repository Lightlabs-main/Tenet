import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { isReadOnlyRpcPayload, MAINNET_RPC_URL } from "./policy.mjs";

const REQUEST_MAX_BYTES = 512_000;
const RESPONSE_MAX_BYTES = 8_000_000;
const RATE_WINDOW_MS = 60_000;
const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

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
} = {}) {
  const clients = new Map();
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
