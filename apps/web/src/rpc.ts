import { createSolanaRpc } from "@solana/kit";
import { RPC_URL } from "./config.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /429|Too Many|rate limit|Failed to fetch|fetch failed|NetworkError|ECONNRESET|timed? ?out|50[234]/i;

/**
 * The public Devnet RPC rate-limits bursts (loading one Circle is ~30 reads).
 * Every `rpc.x(...).send()` is retried with backoff on rate limits and
 * transient network errors, so the page waits instead of failing.
 */
function withRetries<T extends object>(rpc: T): T {
  return new Proxy(rpc, {
    get(target, prop, recv) {
      const f = Reflect.get(target, prop, recv);
      if (typeof f !== "function") return f;
      return (...args: unknown[]) => {
        const req = f.apply(target, args) as { send: (o?: unknown) => Promise<unknown> };
        return {
          ...req,
          send: async (o?: unknown) => {
            for (let i = 0; ; i++) {
              try {
                return await req.send(o);
              } catch (e) {
                if (i >= 6 || !TRANSIENT.test(String((e as Error)?.message ?? e))) throw e;
                await sleep(600 * 2 ** i + Math.random() * 300);
              }
            }
          },
        };
      };
    },
  });
}

const base = createSolanaRpc(RPC_URL);
export const rpc: typeof base = withRetries(base);
