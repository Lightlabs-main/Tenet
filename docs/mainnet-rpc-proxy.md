# Mainnet read-only RPC proxy

The VPS-hosted Tenet preview uses a same-origin endpoint so browser requests do not send an Origin header to Solana's public RPC. This proxy is **read-only infrastructure**; it has no wallet, signer, token authority, or custody role.

## Request path

`Browser → Caddy (/api/solana) → 127.0.0.1:8504 → https://api.mainnet-beta.solana.com`

Caddy serves the app at `https://38.49.209.149` and `http://38.49.209.149:8503`. The app upgrades insecure port-8503 page loads to HTTPS. The proxy binds only to loopback; Caddy overwrites `X-Tenet-Client-IP` from the connection's remote address.

## Security policy

- Fixed mainnet-beta upstream; callers cannot choose an RPC URL.
- Only `getAccountInfo`, `getBalance`, `getEpochInfo`, `getLatestBlockhash`, `getProgramAccounts`, `getSignatureStatuses`, `getTokenAccountBalance`, and `getTransaction` are accepted.
- `getProgramAccounts` is limited to Tenet's configured program ID.
- All transaction submission and other write methods are denied before upstream forwarding.
- JSON requests are capped at 512 KB, batches at 16 entries, responses at 8 MB, upstream wait at 12 seconds, and per-client/global request rates are bounded.
- The systemd service runs as the unprivileged `caddy` user with a read-only source directory and loopback-only listener.

The allowlist intentionally exposes public chain reads only; it does not make an undeployed program available. Keep `TRANSACTIONS_ENABLED=false` until the program, integration, and release gates are independently verified.

## Verification

Run `pnpm test:rpc-proxy`, `pnpm test`, `pnpm typecheck`, `pnpm check:money`, and `pnpm --filter @tenet/web build` in the staging checkout. On the VPS, check `systemctl status tenet-rpc-proxy` and `curl http://127.0.0.1:8504/healthz`. Test the public `/api/solana` path with allowed reads and confirm `sendTransaction` returns HTTP 403. See [verification.md](verification.md) for the observed mainnet slot and configured program-account result.

## PreStocks source-data route

The same service also exposes GET /api/prestocks as a separate, informational source-data path. The upstream is fixed in code to https://prestocks.com/api/prestocks; request query parameters are not forwarded and non-GET requests are rejected. The route applies the service rate limit, timeout and response-size bound, requires JSON for successful upstream responses, and returns Cache-Control: no-store.

This provider response is not a Solana account, executable quote, guarantee of liquidity or transferability, verified corporate-action state, or Circle holding/NAV. The app records its retrieval time and labels the discovered list as a source universe. See verification.md for the dated observation. Do not use this route to authorize purchases or share issuance.
