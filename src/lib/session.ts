"use client";

import { createContext, useContext } from "react";

export interface AppUser {
  /** Stable id for this player. Privy DID in production, a local id in demo mode. */
  id: string;
  /** Numeric X user id, used to look up account age and enforce one per player. */
  xId: string | null;
  handle: string | null;
  displayName: string;
  pfpUrl: string | null;
  embeddedWallet: string | null;
  xAccountCreatedAt: string | null;
}

export interface Session {
  ready: boolean;
  authenticated: boolean;
  user: AppUser | null;
  login: () => void;
  logout: () => void;
  /** "demo" when NEXT_PUBLIC_PRIVY_APP_ID is unset and login is faked locally. */
  mode: "privy" | "demo";
  getAccessToken: () => Promise<string | null>;
  /** Set when the account cannot play, e.g. the X account is too new. */
  restriction: string | null;
  /**
   * True until the player has been through the guided first run. Null while it
   * is still being established, so the shell can wait rather than flashing the
   * dashboard at someone who is about to be redirected.
   */
  needsOnboarding: boolean | null;
  /** Called when the first run finishes, so the redirect stops firing. */
  markOnboarded: () => void;
  /**
   * EIP-1193 provider for the embedded wallet, used to sign sponsored
   * operations. Exposed here rather than imported from Privy directly so the
   * demo provider — which has no Privy context to read — can return null
   * instead of throwing.
   */
  getEmbeddedProvider: () => Promise<EmbeddedProvider | null>;
  /**
   * Opens Privy's backup flow for the embedded wallet. Null in demo mode,
   * where there is no real wallet to back up.
   */
  exportEmbeddedWallet: (() => Promise<void>) | null;
}

export interface EmbeddedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <Providers>");
  }
  return session;
}
