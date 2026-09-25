/**
 * DEVELOPMENT-ONLY test wallet, for driving the real UI end to end in an
 * automated browser that has no wallet extension.
 *
 * Loaded only by the Vite dev server (`import.meta.env.DEV`) AND only with
 * `?testwallet` in the URL; the production build does not contain it. It
 * registers through the Wallet Standard like Phantom does, signs with a
 * throwaway keypair kept in this browser's localStorage, and supports only
 * `solana:devnet`. Never put real funds in it.
 */
import {
  createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, getBase64Decoder, getTransactionDecoder,
  getTransactionEncoder, getAddressEncoder, type KeyPairSigner,
} from "@solana/kit";
import { rpc } from "./rpc.ts";

const KEY = "tenet:dev-test-wallet-seed";
const CHAIN = "solana:devnet";
const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2U5YTM4ZiIvPjwvc3ZnPg==";

async function signer(): Promise<KeyPairSigner> {
  let seed = localStorage.getItem(KEY);
  if (!seed) {
    seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(KEY, seed);
  }
  const bytes = Uint8Array.from(seed.match(/../g)!.map((h) => parseInt(h, 16)));
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

async function signWire(s: KeyPairSigner, wire: Uint8Array): Promise<Uint8Array> {
  const tx = getTransactionDecoder().decode(wire);
  const [sigs] = await s.signTransactions([tx as never]);
  const signed = { ...tx, signatures: { ...tx.signatures, ...sigs } };
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

export async function registerDevWallet(): Promise<void> {
  const s = await signer();
  console.info(`[dev test wallet] ${s.address} — Devnet only, development only`);
  const account = {
    address: s.address,
    publicKey: new Uint8Array(getAddressEncoder().encode(s.address)),
    chains: [CHAIN] as const,
    features: ["solana:signAndSendTransaction", "solana:signTransaction"] as const,
  };
  const wallet = {
    version: "1.0.0" as const,
    name: "Tenet Dev Test Wallet",
    icon: ICON,
    chains: [CHAIN],
    get accounts() { return [account]; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(inputs.map(async (i) => ({ signedTransaction: await signWire(s, i.transaction) }))),
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(inputs.map(async (i) => {
            const signed = await signWire(s, i.transaction);
            const b64 = getBase64Decoder().decode(signed);
            const sig = await rpc.sendTransaction(b64 as never, { encoding: "base64", preflightCommitment: "confirmed" }).send();
            return { signature: new Uint8Array(getBase58Encoder().encode(sig)) };
          })),
      },
    },
  };
  const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

