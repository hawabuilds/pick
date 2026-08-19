"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { PRIVY_APP_ID } from "@/lib/env";
import { SessionContext, type AppUser, type Session } from "@/lib/session";
import { upsertUser } from "@/lib/user";

export function PrivySessionProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "light",
          accentColor: "#00C805",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken, exportWallet } =
    usePrivy();
  const { wallets } = useWallets();

  const embeddedWallet =
    user?.wallet?.address ??
    wallets.find((w) => w.walletClientType === "privy")?.address ??
    null;

  const appUser: AppUser | null = useMemo(() => {
    if (!user) return null;
    const twitter = user.twitter;
    return {
      id: user.id,
      xId: twitter?.subject ?? null,
      handle: twitter?.username ?? null,
      displayName: twitter?.name ?? twitter?.username ?? "Player",
      // Privy returns the 48px variant; drop the suffix for a crisp avatar.
      pfpUrl: twitter?.profilePictureUrl?.replace("_normal", "") ?? null,
      embeddedWallet,
      // Resolved server-side from the X API; the client is not trusted with it.
      xAccountCreatedAt: null,
    };
  }, [user, embeddedWallet]);

  const safeGetAccessToken = useCallback(async () => {
    try {
      return await getAccessToken();
    } catch {
      return null;
    }
  }, [getAccessToken]);

  const [restriction, setRestriction] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authenticated || !appUser) return;
    void (async () => {
      const result = await upsertUser(appUser, await safeGetAccessToken());
      setRestriction(result.restriction);
      setNeedsOnboarding(!result.onboarded);
    })();
  }, [authenticated, appUser, safeGetAccessToken]);

  const markOnboarded = useCallback(() => setNeedsOnboarding(false), []);

  const privyWallet = wallets.find((w) => w.walletClientType === "privy");

  const getEmbeddedProvider = useCallback(async () => {
    if (!privyWallet) return null;
    try {
      const provider = await privyWallet.getEthereumProvider();
      return { request: provider.request.bind(provider) };
    } catch {
      return null;
    }
  }, [privyWallet]);

  const exportEmbeddedWallet = useCallback(async () => {
    await exportWallet();
  }, [exportWallet]);

  const value: Session = useMemo(
    () => ({
      ready,
      authenticated,
      user: appUser,
      login: () => login(),
      logout: () => void logout(),
      mode: "privy",
      getAccessToken: safeGetAccessToken,
      restriction,
      needsOnboarding,
      markOnboarded,
      getEmbeddedProvider,
      exportEmbeddedWallet,
    }),
    [
      ready,
      authenticated,
      appUser,
      login,
      logout,
      safeGetAccessToken,
      restriction,
      needsOnboarding,
      markOnboarded,
      getEmbeddedProvider,
      exportEmbeddedWallet,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
