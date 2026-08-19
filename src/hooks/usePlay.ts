"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readLocalSubmission, writeLocalSubmission } from "@/lib/localStore";
import { useSession } from "@/lib/session";
import type { Pick, PlayState, Submission } from "@/lib/types";

async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export function usePlay() {
  const { getAccessToken } = useSession();
  const queryClient = useQueryClient();
  const [localSubmission, setLocalSubmission] = useState<Submission | null>(null);

  const query = useQuery({
    queryKey: ["slate"],
    queryFn: async () =>
      request<PlayState>("/api/slate", await getAccessToken()),
  });

  const slateDate = query.data?.slate.slateDate;

  useEffect(() => {
    if (slateDate) setLocalSubmission(readLocalSubmission(slateDate));
  }, [slateDate]);

  const submit = useMutation({
    mutationFn: async (picks: Pick[]) => {
      if (!slateDate) throw new Error("No open slate.");

      // Without a database the lock-in is kept in the browser so the loop is
      // still demoable; everything else about the flow is identical.
      if (query.data?.demo) {
        const submission: Submission = {
          slateDate,
          submittedAt: new Date().toISOString(),
          counted: true,
          picks,
        };
        writeLocalSubmission(submission);
        return submission;
      }

      const result = await request<{ submission: Submission }>(
        "/api/picks",
        await getAccessToken(),
        { method: "POST", body: JSON.stringify({ slateDate, picks }) },
      );
      return result.submission;
    },
    onSuccess: (submission) => {
      setLocalSubmission(submission);
      void queryClient.invalidateQueries({ queryKey: ["slate"] });
    },
  });

  const reset = useCallback(() => submit.reset(), [submit]);

  return {
    state: query.data,
    isLoading: query.isLoading,
    error: query.error as Error | undefined,
    submission: query.data?.submission ?? localSubmission,
    submit,
    reset,
  };
}
