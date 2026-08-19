import {createConfig, http, type Config, type CreateConnectorFn} from "wagmi";
import {coinbaseWallet, injected, walletConnect} from "wagmi/connectors";
import {APP_NAME} from "@/config/app";
import {robinhoodTestnet} from "@/config/chain";
import {REOWN_PROJECT_ID} from "@/lib/env";

/**
 * External wallets for claiming rewards. This is separate from the Privy
 * embedded wallet that every player gets at login: the embedded wallet is the
 * identity, an external wallet is where rewards are sent when a player wants
 * custody elsewhere.
 *
 * Built lazily and cached, because `createConfig` sets up storage and EIP-6963
 * listeners that only make sense in the browser.
 */
let cached: Config | null = null;

export function getWagmiConfig(): Config {
  if (cached) return cached;

  // Typed up front: each connector factory returns a differently-shaped
  // generic, so an inferred array type rejects the third one.
  const connectors: CreateConnectorFn[] = [
    // Covers MetaMask, Rabby and anything else announcing itself over
    // EIP-6963; wagmi discovers those automatically and adds them alongside.
    injected({shimDisconnect: true}),
    coinbaseWallet({appName: APP_NAME, preference: {options: "all"}}),
  ];

  // Browser only. wagmi calls `setup()` on every connector as the config is
  // built, and WalletConnect's reaches straight for indexedDB, which does not
  // exist on the server — it throws there and drags the whole render down with
  // it. Nothing is lost: the connect sheet renders through a portal that is
  // mounted in an effect, so the server never lists connectors anyway.
  if (REOWN_PROJECT_ID && typeof window !== "undefined") {
    connectors.push(
      walletConnect({
        projectId: REOWN_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: APP_NAME,
          description: "Call ten stocks a day. Earn real-world assets.",
          url: typeof window === "undefined" ? "" : window.location.origin,
          icons: [],
        },
      }),
    );
  }

  cached = createConfig({
    chains: [robinhoodTestnet],
    connectors,
    transports: {[robinhoodTestnet.id]: http()},
    ssr: true,
  });

  return cached;
}
