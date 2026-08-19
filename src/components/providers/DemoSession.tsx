"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SessionContext, type AppUser, type Session } from "@/lib/session";
import { upsertUser } from "@/lib/user";

const STORAGE_KEY = "pick.demo-user";
const ONBOARDED_KEY = "pick.demo-onboarded";

/**
 * Stand-in for Privy so the app is runnable before an app id exists. It only
 * ever activates when NEXT_PUBLIC_PRIVY_APP_ID is missing, and the UI labels
 * itself as demo mode wherever it matters.
 */
const DEMO_USER: AppUser = {
  id: "demo:local-player",
  xId: "demo-x-id",
  handle: "hawabuilds",
  displayName: "Hawa",
  pfpUrl: null,
  embeddedWallet: "0x8F3c0000000000000000000000000000000c4A21",
  xAccountCreatedAt: "2019-04-02T00:00:00.000Z",
};

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthenticated(window.localStorage.getItem(STORAGE_KEY) === "1");
    setNeedsOnboarding(window.localStorage.getItem(ONBOARDED_KEY) !== "1");
    setReady(true);
  }, []);

  const login = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setAuthenticated(true);
    // No access token in demo mode, so this is a no-op server-side. Kept so the
    // two providers follow the same shape.
    void upsertUser(DEMO_USER, null);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setAuthenticated(false);
  }, []);

  const markOnboarded = useCallback(() => {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
    setNeedsOnboarding(false);
  }, []);

  const value: Session = useMemo(
    () => ({
      ready,
      authenticated,
      user: authenticated ? DEMO_USER : null,
      login,
      logout,
      mode: "demo",
      getAccessToken: async () => null,
      restriction: null,
      needsOnboarding,
      markOnboarded,
      getEmbeddedProvider: async () => null,
      exportEmbeddedWallet: null,
    }),
    [ready, authenticated, login, logout, needsOnboarding, markOnboarded],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
