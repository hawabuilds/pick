import { createPublicClient, http, type Address } from "viem";
import {
  SIMPLE_ACCOUNT_FACTORY,
  SMART_ACCOUNT_SALT,
} from "@/config/aa";
import { robinhoodTestnet } from "@/config/chain";

/**
 * The smart account a player's rewards are paid into when gas is sponsored.
 *
 * Derived rather than stored. The address is a pure function of the owner and
 * the salt, so asking the factory is both cheaper than a column and impossible
 * to get out of step with what the client actually deploys — and it means the
 * server never has to trust a client-supplied address.
 */

const FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

const cache = new Map<string, Address | null>();

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Counterfactual address for an owner, whether or not it is deployed yet. */
export async function smartAccountFor(owner: string): Promise<Address | null> {
  if (!isAddress(owner)) return null;

  const key = owner.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const address = await createPublicClient({
      chain: robinhoodTestnet,
      transport: http(undefined, { retryCount: 2 }),
    }).readContract({
      address: SIMPLE_ACCOUNT_FACTORY,
      abi: FACTORY_ABI,
      functionName: "getAddress",
      args: [owner as Address, SMART_ACCOUNT_SALT],
    });

    cache.set(key, address);
    return address;
  } catch {
    // Never fatal: without it the player simply claims to their own address.
    cache.set(key, null);
    return null;
  }
}

/** Every address a player may legitimately receive a reward at. */
export async function payoutAddresses(wallets: {
  embedded?: string | null;
  connected?: string | null;
}): Promise<string[]> {
  const owned = [wallets.connected, wallets.embedded].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  const smart = wallets.embedded ? await smartAccountFor(wallets.embedded) : null;
  if (smart) owned.push(smart);

  return owned.map((value) => value.toLowerCase());
}
