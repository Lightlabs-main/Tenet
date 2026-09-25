import { createSolanaRpc } from "@solana/kit";
import { RPC_URL } from "./config.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /429|Too Many|rate limit|Failed to fetch|fetch failed|NetworkError|ECONNRESET|timed? ?out|50[234]/i;

/** At most MAX_IN_FLIGHT requests at once: the public Devnet RPC rate-limits bursts. */
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await f();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/**
 * Every `rpc.x(...).send()` goes through a small concurrency limit and is
 * retried with backoff on rate limits and transient network errors, so the
 * page waits instead of failing.
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
                return await slot(() => req.send(o));
              } catch (e) {
                if (i >= 6 || !TRANSIENT.test(String((e as Error)?.message ?? e))) throw e;
                await sleep(800 * 2 ** i + Math.random() * 400);
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
