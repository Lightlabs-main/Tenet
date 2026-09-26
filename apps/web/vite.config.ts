import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { isReadOnlyRpcPayload } from "../../services/solana-rpc-proxy/policy.mjs";

function mainnetReadOnlyRpc(): Plugin {
  return {
    name: "tenet-mainnet-read-only-rpc",
    configureServer(server) {
      server.middlewares.use("/api/solana", (req, res) => {
        const incoming = req as unknown as {
          method?: string;
          on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
          on(event: "end", listener: () => void): unknown;
        };
        if (incoming.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Only JSON-RPC POST is supported." }));
          return;
        }

        const chunks: Uint8Array[] = [];
        let size = 0;
        let oversized = false;
        incoming.on("data", (chunk: Uint8Array) => {
          size += chunk.byteLength;
          if (size > 512_000) oversized = true;
          else if (!oversized) chunks.push(chunk);
        });
        incoming.on("end", async () => {
          const fail = (status: number, message: string) => {
            res.statusCode = status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: message }));
          };
          if (oversized) return fail(413, "JSON-RPC request is too large.");

          const requestBytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            requestBytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const body = new TextDecoder().decode(requestBytes);
          try {
            const payload: unknown = JSON.parse(body);
            if (!isReadOnlyRpcPayload(payload)) return fail(403, "This mainnet preview allows approved read-only Solana RPC methods only.");

            const upstream = await fetch("https://api.mainnet-beta.solana.com", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            });
            res.statusCode = upstream.status;
            res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
            res.end(new Uint8Array(await upstream.arrayBuffer()));
          } catch {
            fail(502, "The mainnet RPC request could not be completed.");
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), mainnetReadOnlyRpc()],
  // The generated SDK error module reads process.env.NODE_ENV. There is no
  // `process` in a browser, so substitute the literal at build time — in dev
  // too, since the workspace SDK is served as source, not a pre-bundled dep.
  define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  server: {
    port: 5173,
    strictPort: true,
    // PreStocks does not expose browser CORS headers. Keep the dev preview
    // same-origin and read-only; production needs an equivalent server-side
    // proxy before this surface can be considered live there.
    proxy: {
      "/api/prestocks": {
        target: "https://prestocks.com",
        changeOrigin: true,
        rewrite: () => "/api/prestocks",
      },
      // Pyth needs an API key, which lives only in Tenet's server-side proxy;
      // the dev server uses the public deployment's fixed, key-less endpoint.
      "/api/pyth": {
        target: "https://tenetstocks.website",
        changeOrigin: true,
        rewrite: () => "/api/pyth",
      },
    },
    // packages/domain is imported by relative path (it has no package.json);
    // allow Vite to serve files from the repo root.
    fs: { allow: ["../.."] },
  },
}));
