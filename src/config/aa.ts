import type { Address } from "viem";

/**
 * Account abstraction on Robinhood Chain testnet.
 *
 * ERC-4337 is first-class on this chain: EntryPoint v0.6, v0.7 and v0.8 are all
 * deployed, and Alchemy runs a bundler and gas manager for it. That lets a
 * player claim a reward without holding ETH, seeing a fee, or being asked to
 * approve anything — the wallet stays invisible, which is the entire point of
 * handing one to someone who has never used crypto.
 *
 * Testnet only. Sponsoring mainnet gas is behind the audit gate.
 */

/** Canonical EntryPoint v0.7, deployed at the same address on every chain. */
export const ENTRY_POINT_ADDRESS: Address =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export const ENTRY_POINT_VERSION = "0.7" as const;

/** Canonical SimpleAccount factory for EntryPoint v0.7. */
export const SIMPLE_ACCOUNT_FACTORY: Address =
  "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";

/**
 * One account per owner. Changing this changes every player's address, so it is
 * fixed rather than configurable.
 */
export const SMART_ACCOUNT_SALT = 0n;

/**
 * The bundler and paymaster are reached through our own route, never directly:
 * the Alchemy key and the gas policy id would otherwise have to ship to the
 * browser, and anyone could then spend the paymaster's balance.
 */
export const AA_RPC_PATH = "/api/aa/rpc";

/** Off unless the deployment has a bundler and a gas policy behind it. */
export const isGaslessEnabled =
  process.env.NEXT_PUBLIC_AA_ENABLED === "true";
