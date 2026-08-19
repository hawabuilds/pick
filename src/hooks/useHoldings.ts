"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import type { Holding } from "@/lib/server/holdings";

export interface HoldingsResponse {
  wallets: string[];
  holdings: Holding[];
  totalUsd: number;
  /** A balance was read that no price could be found for. */
  partiallyValued: boolean;
}

const EMPTY: HoldingsResponse = {
  wallets: [],
  holdings: [],
  totalUsd: 0,
  partiallyValued: false,
};

export function useHoldings() {
  const { getAccessToken } = useSession();

  const query = useQuery({
    queryKey: ["holdings"],
    // Balances change only when a claim lands, but the valuation moves with the
    // market, so this refreshes on a slow beat rather than on every focus.
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/holdings", {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error("Could not load your holdings.");
      return (await res.json()) as HoldingsResponse;
    },
  });

  return {
    ...(query.data ?? EMPTY),
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
