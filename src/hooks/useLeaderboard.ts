"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import type { LeaderboardState } from "@/lib/types";

const PAGE_SIZE = 25;

export function useLeaderboard() {
  const { getAccessToken } = useSession();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const query = useQuery({
    queryKey: ["leaderboard", limit],
    queryFn: async () => {
      const token = await getAccessToken();
      const res = await fetch(`/api/leaderboard?limit=${limit}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      const body = (await res.json()) as LeaderboardState & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load the board.");
      return body;
    },
    placeholderData: (previous) => previous,
  });

  const loadMore = useCallback(() => setLimit((n) => n + PAGE_SIZE), []);

  const hasMore = Boolean(query.data && query.data.rows.length < query.data.total);

  return { ...query, loadMore, hasMore };
}
