import type { Slate, Submission } from "@/lib/types";
import { openSlateDate, slateLocksAt } from "./calendar";
import { db, hasDatabase } from "./db";
import { getUniverseTickers } from "./universe";

/** The whole active universe is on every slate; the player picks 10 of it. */
export async function defaultTickers(): Promise<string[]> {
  return getUniverseTickers();
}

export async function computeSlate(slateDate: string): Promise<Slate> {
  return {
    slateDate,
    tickers: await defaultTickers(),
    locksAt: slateLocksAt(slateDate).toISOString(),
    resolved: false,
  };
}

export async function computeOpenSlate(now = new Date()): Promise<Slate> {
  return computeSlate(openSlateDate(now));
}

/**
 * The slate currently accepting picks. Created on demand so the Play tab always
 * has an open board even before the scheduled slate job exists.
 */
export async function getOpenSlate(now = new Date()): Promise<Slate> {
  const computed = await computeOpenSlate(now);
  if (!hasDatabase) return computed;

  const supabase = db();
  const { data } = await supabase
    .from("daily_slates")
    .select("slate_date, tickers, locks_at, resolved")
    .eq("slate_date", computed.slateDate)
    .maybeSingle();

  if (data) {
    return {
      slateDate: data.slate_date,
      tickers: data.tickers,
      locksAt: data.locks_at,
      resolved: data.resolved,
    };
  }

  await supabase.from("daily_slates").insert({
    slate_date: computed.slateDate,
    tickers: computed.tickers,
    locks_at: computed.locksAt,
  });

  return computed;
}

export async function getUserId(privyId: string): Promise<string | null> {
  const { data } = await db()
    .from("users")
    .select("id")
    .eq("privy_id", privyId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function getSubmission(
  userId: string,
  slateDate: string,
): Promise<Submission | null> {
  const supabase = db();

  const { data: submission } = await supabase
    .from("submissions")
    .select("slate_date, submitted_at, counted")
    .eq("user_id", userId)
    .eq("slate_date", slateDate)
    .maybeSingle();

  if (!submission) return null;

  const { data: picks } = await supabase
    .from("picks")
    .select("ticker, direction")
    .eq("user_id", userId)
    .eq("slate_date", slateDate)
    .order("created_at", { ascending: true });

  return {
    slateDate: submission.slate_date,
    submittedAt: submission.submitted_at,
    counted: submission.counted,
    picks: (picks ?? []).map((p) => ({
      ticker: p.ticker,
      direction: p.direction as "up" | "down",
    })),
  };
}
