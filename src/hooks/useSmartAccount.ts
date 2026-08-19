"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
} from "viem";
import { createPaymasterClient } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import {
  AA_RPC_PATH,
  ENTRY_POINT_ADDRESS,
  ENTRY_POINT_VERSION,
  isGaslessEnabled,
  SMART_ACCOUNT_SALT,
} from "@/config/aa";
import { robinhoodTestnet } from "@/config/chain";
import { useSession, type EmbeddedProvider } from "@/lib/session";
import { useUser } from "./useUser";

/**
 * The player's smart account, with gas paid for them.
 *
 * The embedded wallet signs, but it never has to hold ETH and it is never asked
 * to approve a fee — the operation is bundled and the gas manager settles it.
 * From the player's side, claiming is a button and then a result.
 *
 * Everything degrades. With no bundler configured, or on any failure setting
 * up, this reports `ready: false` and the caller falls back to an ordinary
 * transaction from a connected wallet.
 */

type SmartAccountClient = Awaited<ReturnType<typeof build>>;

async function build(provider: EmbeddedProvider, owner: Address) {
  const publicClient = createPublicClient({
    chain: robinhoodTestnet,
    transport: http(),
  });

  // Naming the account explicitly rather than handing over the bare provider:
  // a provider may expose several addresses, and the smart account address is
  // derived from the owner, so the wrong one would silently be a different
  // account with a different balance.
  const ownerClient = createWalletClient({
    account: owner,
    chain: robinhoodTestnet,
    transport: custom(provider),
  });

  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: ownerClient,
    entryPoint: { address: ENTRY_POINT_ADDRESS, version: ENTRY_POINT_VERSION },
    index: SMART_ACCOUNT_SALT,
  });

  return createSmartAccountClient({
    account,
    chain: robinhoodTestnet,
    bundlerTransport: http(AA_RPC_PATH),
    paymaster: createPaymasterClient({ transport: http(AA_RPC_PATH) }),
  });
}

export interface SmartAccount {
  ready: boolean;
  address: Address | null;
  /**
   * Sends a call through the smart account and waits for it to land, returning
   * the hash of the transaction the operation ended up in.
   */
  send: (call: { to: Address; data: Hex }) => Promise<Hex>;
}

export function useSmartAccount(): SmartAccount {
  const { getEmbeddedProvider } = useSession();
  const { embeddedWallet } = useUser();
  const [address, setAddress] = useState<Address | null>(null);
  const clientRef = useRef<SmartAccountClient | null>(null);

  useEffect(() => {
    if (!isGaslessEnabled || !embeddedWallet) {
      clientRef.current = null;
      setAddress(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const provider = await getEmbeddedProvider();
        if (!provider || cancelled) return;

        const client = await build(provider, embeddedWallet as Address);
        if (cancelled) return;

        clientRef.current = client;
        setAddress(client.account.address);
      } catch {
        if (!cancelled) {
          clientRef.current = null;
          setAddress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [embeddedWallet, getEmbeddedProvider]);

  const send = useCallback(async ({ to, data }: { to: Address; data: Hex }) => {
    const client = clientRef.current;
    if (!client) throw new Error("Gasless claiming is not available.");

    const hash = await client.sendUserOperation({ calls: [{ to, data }] });
    const receipt = await client.waitForUserOperationReceipt({ hash });

    if (!receipt.success) throw new Error("The claim did not go through.");
    return receipt.receipt.transactionHash;
  }, []);

  return { ready: address !== null, address, send };
}
