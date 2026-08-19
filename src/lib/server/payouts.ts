import {isTradingDay, nextTradingDay} from "./calendar";
import {db} from "./db";

/**
 * Leaderboard prize schedule. Flat bands rather than a formula so the numbers
 * on the Rewards tab are the numbers a player can work out for themselves.
 */
const PRIZES: Array<{maxRank: number; amountUsd: number}> = [
  {maxRank: 1, amountUsd: 50},
  {maxRank: 2, amountUsd: 30},
  {maxRank: 3, amountUsd: 20},
  {maxRank: 10, amountUsd: 10},
  {maxRank: 20, amountUsd: 5},
];

const PAID_RANKS = PRIZES[PRIZES.length - 1].maxRank;

export function prizeForRank(rank: number): number {
  for (const band of PRIZES) {
    if (rank <= band.maxRank) return band.amountUsd;
  }
  return 0;
}

export interface PayoutReport {
  seasonId: number;
  winners: number;
  totalUsd: number;
}

/** A season that has ended but is still waiting on slates to be scored. */
export interface HeldSeason {
  seasonId: number;
  awaiting: string[];
}

export interface SettlementReport {
  paid: PayoutReport[];
  held: HeldSeason[];
}

/**
 * Every trading day the season covers, so a payout can be held back until each
 * one has actually been scored.
 */
function tradingDaysIn(startKey: string, endKey: string): string[] {
  const days: string[] = [];
  let day = isTradingDay(startKey) ? startKey : nextTradingDay(startKey);
  while (day < endKey && days.length < 400) {
    days.push(day);
    day = nextTradingDay(day);
  }
  return days;
}

/**
 * True once every trading day in the window has a finalised slate.
 *
 * Paying out early is unrecoverable: claims are granted against a ranking that
 * is still missing a day's points, and the money is gone before anyone notices.
 * Holding the season open costs nothing by comparison, and the next run picks
 * it up.
 */
async function seasonIsComplete(
  startKey: string,
  endKey: string,
): Promise<{complete: boolean; missing: string[]}> {
  const expected = tradingDaysIn(startKey, endKey);
  if (expected.length === 0) return {complete: true, missing: []};

  const {data, error} = await db()
    .from("daily_slates")
    .select("slate_date, resolved")
    .gte("slate_date", expected[0])
    .lte("slate_date", expected[expected.length - 1]);

  if (error) throw error;

  const finalised = new Set(
    (data ?? [])
      .filter((row) => row.resolved === true)
      .map((row) => row.slate_date as string),
  );

  const missing = expected.filter((day) => !finalised.has(day));
  return {complete: missing.length === 0, missing};
}

/**
 * Grants leaderboard payouts for every season that has ended without being paid.
 *
 * Ranking is recomputed here rather than read from the `leaderboard` view,
 * because that view is scoped to the *active* season and by the time a season
 * is being paid it is no longer the active one.
 */
export async function settleFinishedSeasons(
  now = new Date(),
): Promise<SettlementReport> {
  const supabase = db();
  const paid: PayoutReport[] = [];
  const held: HeldSeason[] = [];

  const {data: seasons, error} = await supabase
    .from("seasons")
    .select("id, starts_at, ends_at")
    .is("paid_out_at", null)
    .lte("ends_at", now.toISOString())
    .order("ends_at", {ascending: true});

  if (error) throw error;

  for (const season of seasons ?? []) {
    const startKey = dateKey(season.starts_at);
    const endKey = dateKey(season.ends_at);

    const {complete, missing} = await seasonIsComplete(startKey, endKey);
    if (!complete) {
      held.push({seasonId: season.id as number, awaiting: missing});
      continue;
    }

    paid.push(
      await settleSeason(season.id as number, season.starts_at, season.ends_at),
    );
  }

  return {paid, held};
}

function dateKey(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function settleSeason(
  seasonId: number,
  startsAt: string,
  endsAt: string,
): Promise<PayoutReport> {
  const supabase = db();

  const {data: scores, error} = await supabase
    .from("scores")
    .select("user_id, points, created_at")
    .gte("slate_date", dateKey(startsAt))
    .lt("slate_date", dateKey(endsAt));

  if (error) throw error;

  const totals = new Map<string, {points: number; firstPlayed: string}>();
  for (const row of scores ?? []) {
    const userId = row.user_id as string;
    const existing = totals.get(userId);
    const createdAt = row.created_at as string;
    if (existing) {
      existing.points += row.points as number;
      if (createdAt < existing.firstPlayed) existing.firstPlayed = createdAt;
    } else {
      totals.set(userId, {points: row.points as number, firstPlayed: createdAt});
    }
  }

  // Ties break on who got there first, matching the leaderboard view.
  const ranked = [...totals.entries()]
    .sort((a, b) => {
      if (b[1].points !== a[1].points) return b[1].points - a[1].points;
      return a[1].firstPlayed.localeCompare(b[1].firstPlayed);
    })
    .slice(0, PAID_RANKS);

  const rows = ranked
    .map(([userId], index) => ({
      user_id: userId,
      type: "leaderboard" as const,
      amount_usd: prizeForRank(index + 1),
      season_id: seasonId,
      status: "available" as const,
    }))
    .filter((row) => row.amount_usd > 0);

  if (rows.length) {
    // The unique index on (user_id, type, season_id) makes this idempotent.
    const {error: insertError} = await supabase
      .from("claims")
      .upsert(rows, {onConflict: "user_id,type,season_id", ignoreDuplicates: true});
    if (insertError) throw insertError;
  }

  const {error: markError} = await supabase
    .from("seasons")
    .update({paid_out_at: new Date().toISOString()})
    .eq("id", seasonId);
  if (markError) throw markError;

  return {
    seasonId,
    winners: rows.length,
    totalUsd: rows.reduce((sum, row) => sum + row.amount_usd, 0),
  };
}
