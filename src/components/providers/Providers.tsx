"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isPrivyConfigured } from "@/lib/env";
import { DemoSessionProvider } from "./DemoSession";
import { PrivySessionProvider } from "./PrivySession";
import { WalletProvider } from "./WalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const Session = isPrivyConfigured ? PrivySessionProvider : DemoSessionProvider;

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <Session>{children}</Session>
      </WalletProvider>
    </QueryClientProvider>
  );
}
