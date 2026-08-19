"use client";

import {useCallback} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
  appendLocalComment,
  readLocalComments,
} from "@/lib/localStore";
import {useSession} from "@/lib/session";
import type {StockComment} from "@/lib/types";

interface CommentsPayload {
  items: StockComment[];
  demo: boolean;
}

function localComment(
  ticker: string,
  body: string,
  user: {
    handle: string | null;
    displayName: string;
    pfpUrl: string | null;
  },
): StockComment {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ticker: ticker.toUpperCase(),
    body,
    createdAt: new Date().toISOString(),
    author: {
      handle: user.handle,
      displayName: user.displayName,
      pfpUrl: user.pfpUrl,
    },
  };
}

export function useStockComments(ticker: string | undefined) {
  const {getAccessToken, mode, authenticated, user} = useSession();
  const queryClient = useQueryClient();
  const offline = mode === "demo";
  const normalized = ticker?.toUpperCase();

  const authed = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? {authorization: `Bearer ${token}`} : {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as {error?: string}).error ?? `Request failed (${res.status})`,
        );
      }
      return body as T;
    },
    [getAccessToken],
  );

  const query = useQuery({
    queryKey: ["stock-comments", normalized, offline],
    enabled: Boolean(normalized),
    staleTime: 30_000,
    queryFn: async () => {
      if (!normalized) return {items: [], demo: offline} satisfies CommentsPayload;

      if (offline) {
        return {
          items: readLocalComments(normalized),
          demo: true,
        } satisfies CommentsPayload;
      }

      try {
        const payload = await authed<CommentsPayload>(
          `/api/stock/${normalized}/comments`,
        );
        const local = readLocalComments(normalized);
        if (payload.demo && local.length > 0) {
          const seen = new Set(payload.items.map((row) => row.id));
          const merged = [
            ...local.filter((row) => !seen.has(row.id)),
            ...payload.items,
          ].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          return {demo: true, items: merged} satisfies CommentsPayload;
        }
        return payload;
      } catch {
        return {
          items: readLocalComments(normalized),
          demo: true,
        } satisfies CommentsPayload;
      }
    },
  });

  const post = useMutation({
    mutationFn: async (body: string) => {
      if (!normalized) throw new Error("No stock selected.");

      const trimmed = body.trim();
      if (!trimmed) throw new Error("Write something before posting.");
      if (trimmed.length > 500) {
        throw new Error("Comments are limited to 500 characters.");
      }

      if (offline) {
        if (!authenticated || !user) {
          throw new Error("Sign in to post a comment.");
        }
        const item = localComment(normalized, trimmed, user);
        appendLocalComment(normalized, item);
        return {item, localOnly: true as const};
      }

      if (!authenticated || !user) {
        throw new Error("Sign in to post a comment.");
      }

      try {
        const result = await authed<{item: StockComment}>(
          `/api/stock/${normalized}/comments`,
          {
            method: "POST",
            body: JSON.stringify({body: trimmed}),
          },
        );
        return {item: result.item, localOnly: false as const};
      } catch {
        const item = localComment(normalized, trimmed, user);
        appendLocalComment(normalized, item);
        return {item, localOnly: true as const};
      }
    },
    onSuccess: ({item, localOnly}) => {
      if (!normalized) return;
      appendLocalComment(normalized, item);
      queryClient.setQueryData<CommentsPayload>(
        ["stock-comments", normalized, offline],
        (current) => {
          const existing = current?.items ?? [];
          const items = [
            item,
            ...existing.filter((row) => row.id !== item.id),
          ];
          return {
            demo: localOnly || current?.demo || offline,
            items,
          };
        },
      );
    },
  });

  return {
    comments: query.data?.items ?? [],
    demo: query.data?.demo ?? offline,
    localOnly: offline || (query.data?.demo ?? false),
    offline,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    postComment: post.mutateAsync,
    isPosting: post.isPending,
    postError: post.error instanceof Error ? post.error.message : null,
    canPost: authenticated && Boolean(user),
    refetch: () => void query.refetch(),
  };
}
