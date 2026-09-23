import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SelectedWalletAccountContextProvider } from "@solana/react";
import type { UiWallet } from "@wallet-standard/react";
import { App } from "./App.tsx";
import { CHAIN } from "./config.ts";
import "./styles.css";

const KEY = "tenet:selected-wallet";

/** Remember the chosen wallet across reloads. Storage can be unavailable
 * (private mode, blocked site data), so every access is guarded. */
const stateSync = {
  getSelectedWallet: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  storeSelectedWallet: (k: string) => { try { localStorage.setItem(KEY, k); } catch { /* ignore */ } },
  deleteSelectedWallet: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

/** Wallets must support the currently selected Solana mainnet chain. */
const filterWallets = (w: UiWallet) =>
  w.chains.includes(CHAIN) && w.features.includes("solana:signAndSendTransaction");

const root = document.getElementById("root");
if (!root) throw new Error("Tenet root element is missing.");
root.dataset.mounted = "true";

createRoot(root).render(
  <StrictMode>
    <SelectedWalletAccountContextProvider filterWallets={filterWallets} stateSync={stateSync}>
      <App />
    </SelectedWalletAccountContextProvider>
  </StrictMode>,
);
