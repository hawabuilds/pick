import {privateKeyToAccount} from "viem/accounts";
import type {Address, Hex} from "viem";
import {RH_TESTNET_ID} from "@/config/chain";

const rawKey = process.env.CLAIM_SIGNER_PRIVATE_KEY ?? "";
const distributor = process.env.NEXT_PUBLIC_CLAIM_DISTRIBUTOR_ADDRESS ?? "";

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isPrivateKey(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export const CLAIM_DISTRIBUTOR = isAddress(distributor) ? distributor : null;

/**
 * The backend key the ClaimDistributor trusts for EIP-712 authorisations. It is
 * the only thing standing between an attacker and the reward vault, so it lives
 * in the server environment and never leaves it.
 */
export const canSignClaims = isPrivateKey(rawKey) && CLAIM_DISTRIBUTOR !== null;

let account: ReturnType<typeof privateKeyToAccount> | null = null;

function signer() {
  if (!isPrivateKey(rawKey)) {
    throw new Error("CLAIM_SIGNER_PRIVATE_KEY is missing or malformed");
  }
  account ??= privateKeyToAccount(rawKey);
  return account;
}

export function signerAddress(): Address | null {
  return canSignClaims ? signer().address : null;
}

/** Mirrors the EIP712 domain declared in ClaimDistributor's constructor. */
function domain() {
  return {
    name: "PickClaimDistributor",
    version: "1",
    chainId: RH_TESTNET_ID,
    verifyingContract: CLAIM_DISTRIBUTOR as Address,
  } as const;
}

const CLAIM_TYPES = {
  Claim: [
    {name: "account", type: "address"},
    {name: "season", type: "uint256"},
    {name: "kind", type: "uint8"},
    {name: "amount", type: "uint256"},
    {name: "deadline", type: "uint256"},
  ],
} as const;

export interface ClaimAuthorization {
  account: Address;
  season: bigint;
  kind: number;
  amount: bigint;
  deadline: bigint;
}

export async function signClaim(claim: ClaimAuthorization): Promise<Hex> {
  if (!CLAIM_DISTRIBUTOR) {
    throw new Error("NEXT_PUBLIC_CLAIM_DISTRIBUTOR_ADDRESS is not set");
  }

  return signer().signTypedData({
    domain: domain(),
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: claim,
  });
}
