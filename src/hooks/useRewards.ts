"use client";

import {useCallback, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useConfig} from "wagmi";
import {waitForTransactionReceipt, writeContract} from "wagmi/actions";
import {encodeFunctionData, type Address, type Hex} from "viem";
import {CLAIM_DISTRIBUTOR_ADDRESS} from "@/config/contracts";
import {RH_TESTNET_ID} from "@/config/chain";
import {CLAIM_DISTRIBUTOR_ABI} from "@/lib/abi";
import {useSession} from "@/lib/session";
import type {Reward, RewardsState} from "@/lib/server/rewards";
import {useSmartAccount} from "./useSmartAccount";

interface Authorization {
  season: string;
  kind: number;
  amount: string;
  deadline: string;
  signature: Hex;
  tokenAddress: Address;
  ticker: string;
}

export interface ClaimResult {
  amountUsd: number;
  ticker: string;
  txHash: string;
}

export function useRewards() {
  const {getAccessToken} = useSession();
  const queryClient = useQueryClient();
  const config = useConfig();
  const smartAccount = useSmartAccount();
  const [result, setResult] = useState<ClaimResult | null>(null);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? {authorization: `Bearer ${token}`} : {}),
          ...init?.headers,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as {error?: string}).error ?? `Request failed (${res.status})`,
        );
      }
      return body;
    },
    [getAccessToken],
  );

  const query = useQuery({
    queryKey: ["rewards"],
    queryFn: async () => (await authed("/api/rewards")) as RewardsState,
  });

  const claim = useMutation({
    mutationFn: async ({
      reward,
      ticker,
      wallet,
    }: {
      reward: Reward;
      ticker: string;
      wallet?: Address;
    }): Promise<ClaimResult> => {
      if (!CLAIM_DISTRIBUTOR_ADDRESS) {
        throw new Error("The claim contract address is not configured.");
      }

      // Sponsored claims are delivered to the smart account, so that is the
      // address the authorisation has to name. Falling back means the player
      // pays their own fee from a connected wallet.
      const gasless = smartAccount.ready && smartAccount.address !== null;
      const recipient = gasless ? smartAccount.address! : wallet;

      if (!recipient) {
        throw new Error("Connect a wallet to claim this reward.");
      }

      // The server decides the amount and signs for this exact address; the
      // client only relays it on-chain.
      const authorization = (await authed("/api/claims/authorize", {
        method: "POST",
        body: JSON.stringify({claimId: reward.id, ticker, wallet: recipient}),
      })) as Authorization;

      const args = [
        BigInt(authorization.season),
        authorization.kind,
        BigInt(authorization.amount),
        BigInt(authorization.deadline),
        authorization.signature,
        authorization.tokenAddress,
        // Zero is not "no floor": ClaimDistributor derives its own floor from
        // the token's Chainlink feed and takes whichever is higher, so a client
        // cannot weaken the guard by passing a small number here.
        0n,
      ] as const;

      const failClaim = () =>
        authed("/api/claims/confirm", {
          method: "POST",
          body: JSON.stringify({claimId: reward.id, failed: true}),
        }).catch(() => undefined);

      let txHash: string;

      if (gasless) {
        try {
          // sendUserOperation already waits for the receipt and throws on a
          // reverted operation, so there is no second status check here.
          txHash = await smartAccount.send({
            to: CLAIM_DISTRIBUTOR_ADDRESS,
            data: encodeFunctionData({
              abi: CLAIM_DISTRIBUTOR_ABI,
              functionName: "claimWithSignature",
              args: [...args],
            }),
          });
        } catch (cause) {
          await failClaim();
          throw cause;
        }
      } else {
        try {
          txHash = await writeContract(config, {
            address: CLAIM_DISTRIBUTOR_ADDRESS,
            abi: CLAIM_DISTRIBUTOR_ABI,
            functionName: "claimWithSignature",
            chainId: RH_TESTNET_ID,
            args: [...args],
          });
        } catch (cause) {
          await failClaim();
          throw cause;
        }

        const receipt = await waitForTransactionReceipt(config, {
          hash: txHash as Hex,
          chainId: RH_TESTNET_ID,
        });

        if (receipt.status !== "success") {
          await failClaim();
          throw new Error("The claim did not go through.");
        }
      }

      await authed("/api/claims/confirm", {
        method: "POST",
        body: JSON.stringify({claimId: reward.id, txHash}),
      });

      return {amountUsd: reward.amountUsd, ticker, txHash};
    },
    onSuccess: (claimed) => {
      setResult(claimed);
      void queryClient.invalidateQueries({queryKey: ["rewards"]});
    },
  });

  const available = query.data?.available ?? [];
  const totalAvailable = available.reduce((sum, r) => sum + r.amountUsd, 0);

  return {
    available,
    history: query.data?.history ?? [],
    claimable: query.data?.claimable ?? false,
    totalAvailable,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    claim: claim.mutateAsync,
    /** True when claiming needs no wallet connection and costs the player nothing. */
    gasless: smartAccount.ready,
    smartAccountAddress: smartAccount.address,
    isClaiming: claim.isPending,
    claimError: claim.error instanceof Error ? claim.error.message : null,
    resetClaimError: claim.reset,
    result,
    dismissResult: () => setResult(null),
  };
}
