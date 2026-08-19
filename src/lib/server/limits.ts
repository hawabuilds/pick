import type {NextRequest} from "next/server";
import {createHash} from "node:crypto";
import {db, hasDatabase} from "./db";

/**
 * Rate limits and abuse logging.
 *
 * The counters live in Postgres rather than in memory because every route here
 * runs on serverless functions: an in-process counter resets on each cold start,
 * which is precisely when a burst arrives.
 */

export interface RateLimit {
  /** Distinct name for the thing being limited. */
  key: string;
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  submitPicks: {key: "picks", limit: 12, windowSeconds: 3600},
  authorizeClaim: {key: "claim-auth", limit: 10, windowSeconds: 3600},
  confirmClaim: {key: "claim-confirm", limit: 20, windowSeconds: 3600},
  learnerReward: {key: "learn-reward", limit: 6, windowSeconds: 3600},
  walletLink: {key: "wallet-link", limit: 20, windowSeconds: 3600},
  // Read-only bundler traffic. Loose, because estimating a single operation
  // takes several calls and a retry doubles that.
  bundlerRead: {key: "aa-read", limit: 240, windowSeconds: 3600},
  // Every sponsored operation costs us real gas, so this is the one that
  // actually protects the paymaster balance.
  paymasterSponsor: {key: "aa-sponsor", limit: 12, windowSeconds: 3600},
  postComment: {key: "comment", limit: 30, windowSeconds: 3600},
} as const satisfies Record<string, RateLimit>;

/**
 * IPs are hashed before they are stored. The counter only needs to tell two
 * callers apart, which a hash does, and keeping raw addresses out of the
 * database removes them from the blast radius of a leak.
 */
export function clientFingerprint(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Consumes one unit of the caller's allowance.
 *
 * Fails open when Supabase is unavailable: a database blip should degrade rate
 * limiting rather than lock every player out of the game.
 */
export async function allow(
  limit: RateLimit,
  subject: string,
): Promise<boolean> {
  if (!hasDatabase) return true;

  const {data, error} = await db().rpc("consume_rate_limit", {
    p_bucket: `${limit.key}:${subject}`,
    p_limit: limit.limit,
    p_window_seconds: limit.windowSeconds,
  });

  if (error) return true;
  return data !== false;
}

/**
 * Records something suspicious. Never throws: an abuse log that can break the
 * request it is describing is worse than no log at all.
 */
export async function logAbuse(options: {
  kind: string;
  userId?: string | null;
  privyId?: string | null;
  detail?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  if (!hasDatabase) return;

  try {
    await db()
      .from("abuse_events")
      .insert({
        kind: options.kind,
        user_id: options.userId ?? null,
        privy_id: options.privyId ?? null,
        detail: options.detail ?? {},
        ip_hash: options.request ? clientFingerprint(options.request) : null,
      });
  } catch {
    // Intentionally swallowed.
  }
}
