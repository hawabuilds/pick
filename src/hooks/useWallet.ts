"use client";

import {useCallback, useEffect, useRef} from "react";
import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {RH_TESTNET_ID} from "@/config/chain";
import {useSession} from "@/lib/session";

/**
 * The external wallet a player claims rewards to, and the plumbing to get it
 * connected and onto the right chain.
 */
export function useWallet() {
  const {address, connector, isConnected, chainId} = useAccount();
  const {connectors, connectAsync, isPending, error} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChainAsync} = useSwitchChain();
  const {authenticated, getAccessToken} = useSession();

  const onWrongChain = isConnected && chainId !== RH_TESTNET_ID;

  // Record the wallet against the account so the backend can enforce one
  // external wallet per player. Skipped until the address actually changes so a
  // re-render does not re-post it.
  const lastSynced = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated || !address || lastSynced.current === address) return;
    lastSynced.current = address;

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        await fetch("/api/user/wallet", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({wallet: address}),
        });
      } catch {
        // A failed sync must not block the UI; the claim route re-checks and
        // this retries on the next address change.
        lastSynced.current = null;
      }
    })();
  }, [address, authenticated, getAccessToken]);

  const connectWith = useCallback(
    async (connectorId: string) => {
      const target = connectors.find((c) => c.uid === connectorId);
      if (!target) throw new Error("That wallet is no longer available.");

      await connectAsync({connector: target, chainId: RH_TESTNET_ID});
    },
    [connectAsync, connectors],
  );

  const ensureCorrectChain = useCallback(async () => {
    if (!onWrongChain) return;
    await switchChainAsync({chainId: RH_TESTNET_ID});
  }, [onWrongChain, switchChainAsync]);

  return {
    address: address ?? null,
    walletName: connector?.name ?? null,
    isConnected,
    onWrongChain,
    connectors,
    connectWith,
    ensureCorrectChain,
    disconnect,
    isConnecting: isPending,
    error: error?.message ?? null,
  };
}
