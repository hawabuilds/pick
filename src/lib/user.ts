import type { AppUser } from "./session";

export interface UpsertResult {
  persisted: boolean;
  /** Set when the account is barred from playing, with the reason to show. */
  restriction: string | null;
  /** False for a player who has not been through the guided first run. */
  onboarded: boolean;
}

/**
 * Whether this browser already had a wallet extension before we gave the player
 * one. Read once at login as a proxy for "already in crypto" — see the
 * onboarding migration for why it is captured at signup and never revised.
 */
function hadWalletAtSignup(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  return "ethereum" in window;
}

/**
 * Mirrors the signed-in player into Postgres.
 *
 * The access token is required: the route establishes identity from the token
 * rather than the body, so an unauthenticated call writes nothing.
 */
export async function upsertUser(
  user: AppUser,
  token: string | null,
): Promise<UpsertResult> {
  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...user, hadWalletAtSignup: hadWalletAtSignup() }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      persisted?: boolean;
      restricted?: boolean;
      onboarded?: boolean;
      reason?: string;
      error?: string;
    };

    if (!response.ok) {
      // Assume onboarded on failure: pushing an existing player back through
      // the first run because a request failed is worse than skipping it.
      return { persisted: false, restriction: body.error ?? null, onboarded: true };
    }

    return {
      persisted: body.persisted ?? false,
      restriction: body.restricted ? (body.reason ?? "Account restricted.") : null,
      onboarded: body.onboarded ?? true,
    };
  } catch {
    // Offline or the route is unavailable; the next login will retry.
    return { persisted: false, restriction: null, onboarded: true };
  }
}
