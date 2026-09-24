export const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
export const TENET_PROGRAM_ID = "FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v";

export const READ_ONLY_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getEpochInfo",
  "getLatestBlockhash",
  "getProgramAccounts",
  "getSignatureStatuses",
  "getTokenAccountBalance",
  "getTransaction",
]);

export function isReadOnlyRpcPayload(payload) {
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > 16) return false;
  return calls.every((call) => {
    if (typeof call !== "object" || call === null || Array.isArray(call)) return false;
    if (call.jsonrpc !== "2.0" || !READ_ONLY_RPC_METHODS.has(call.method)) return false;
    if (call.method === "getProgramAccounts") {
      return Array.isArray(call.params) && call.params[0] === TENET_PROGRAM_ID;
    }
    return true;
  });
}
