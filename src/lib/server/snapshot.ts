import { lastSnapshotDay } from "./calendar";
import { db } from "./db";
import { readFeedSnapshot } from "./feeds";
import { fetchAllQuotes } from "./rhprices";
import { getUniverse } from "./universe";

/**
 * The daily price snapshot the whole game settles on.
 *
 * One reading per token per day, taken from Robinhood's own quote feed at the
 * fixed snapshot instant, with a Chainlink reading stored alongside for the
 * tickers that have a feed. Where the two disagree beyond tolerance the row is
 * flagged and the ticker is voided at resolution rather than scored on a price
 * nothing independent corroborates.
 */

/**
 * How far REST mid and Chainlink may diverge before the ticker is refused.
 *
 * Measured against the live feeds, normal divergence runs 0-40bps with the odd
 * low-priced name touching 60 — two independent samples of the same market taken
 * moments apart. A tolerance near that would void tickers that are perfectly
 * fine, so it sits well above it: this is here to catch a feed that is wrong by
 * percent, not to referee pennies. `pnpm verify:feeds` prints the live spread.
 */
const CROSS_CHECK_TOLERANCE_BPS = Number(
  process.env.CROSS_CHECK_TOLERANCE_BPS ?? 150,
);

/**
 * A quote whose spread is this wide is not a real two-sided market. Settling
 * mid on it would score a call on noise.
 */
const MAX_SPREAD_BPS = Number(process.env.MAX_SPREAD_BPS ?? 500);

export interface SnapshotReport {
  snapshotDate: string;
  tickersWritten: number;
  tickersMissing: Array<{ ticker: string; reason: string }>;
  /** Tickers where Chainlink disagreed with the REST mid beyond tolerance. */
  crossCheckFailures: string[];
  crossChecked: number;
  chainlinkAvailable: boolean;
  /** True when the rows were already present and nothing was re-read. */
  alreadyTaken: boolean;
}

/**
 * Takes the day's snapshot, if it has not already been taken.
 *
 * Idempotent by design: the cron runs twice so a transient failure gets a second
 * chance, and re-reading prices on the retry would produce different numbers for
 * the same day. Once a date has a complete set of rows it is frozen.
 */
export async function takeSnapshot(now = new Date()): Promise<SnapshotReport> {
  const supabase = db();
  const snapshotDate = lastSnapshotDay(now);
  const universe = await getUniverse();

  const { count, error: countError } = await supabase
    .from("price_snapshots")
    .select("ticker", { count: "exact", head: true })
    .eq("snapshot_date", snapshotDate);

  if (countError) throw countError;

  if ((count ?? 0) >= universe.length) {
    return {
      snapshotDate,
      tickersWritten: count ?? 0,
      tickersMissing: [],
      crossCheckFailures: [],
      crossChecked: 0,
      chainlinkAvailable: false,
      alreadyTaken: true,
    };
  }

  const quotes = await fetchAllQuotes();

  // Chainlink is corroboration, not settlement, so an RPC failure degrades the
  // snapshot to unverified rather than losing the day entirely.
  let feeds: Awaited<ReturnType<typeof readFeedSnapshot>> | null = null;
  try {
    feeds = await readFeedSnapshot();
  } catch {
    feeds = null;
  }

  const missing: Array<{ ticker: string; reason: string }> = [];
  const crossCheckFailures: string[] = [];
  let crossChecked = 0;

  const rows = [];

  for (const stock of universe) {
    const quote = quotes.get(stock.ticker);
    if (!quote) {
      missing.push({ ticker: stock.ticker, reason: "no quote" });
      continue;
    }

    const multiplier = Number(stock.multiplier) || 1;

    // Chainlink publishes total return value, so the multiplier has to come
    // back out before it is comparable to the raw REST quote.
    const feed = feeds?.readings.get(stock.ticker) ?? null;
    const chainlinkUnderlying = feed ? feed.price / multiplier : null;

    let crossCheckBps: number | null = null;
    let crossCheckOk: boolean | null = null;

    if (chainlinkUnderlying !== null && chainlinkUnderlying > 0) {
      crossCheckBps =
        (Math.abs(chainlinkUnderlying - quote.mid) / quote.mid) * 10_000;
      crossCheckOk = crossCheckBps <= CROSS_CHECK_TOLERANCE_BPS;
      crossChecked++;
      if (!crossCheckOk) crossCheckFailures.push(stock.ticker);
    }

    rows.push({
      snapshot_date: snapshotDate,
      ticker: stock.ticker,
      price: quote.mid.toFixed(8),
      bid: quote.bid.toFixed(8),
      ask: quote.ask.toFixed(8),
      spread_bps: quote.spreadBps.toFixed(4),
      generated_at: quote.generatedAt,
      is_trading_halt: quote.isTradingHalt,
      multiplier: stock.multiplier,
      source: "robinhood",
      chainlink_price: feed ? feed.price.toFixed(8) : null,
      round_id: feed ? feed.roundId.toString() : null,
      feed_updated_at: feed ? feed.updatedAt.toISOString() : null,
      block_number: feeds ? Number(feeds.blockNumber) : null,
      cross_check_bps: crossCheckBps === null ? null : crossCheckBps.toFixed(4),
      cross_check_ok: crossCheckOk,
      captured_at: now.toISOString(),
    });
  }

  if (rows.length) {
    // ignoreDuplicates keeps a partial first run from being overwritten with
    // different prices on the retry: whatever was captured first stands.
    const { error } = await supabase
      .from("price_snapshots")
      .upsert(rows, {
        onConflict: "snapshot_date,ticker",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  return {
    snapshotDate,
    tickersWritten: rows.length,
    tickersMissing: missing,
    crossCheckFailures,
    crossChecked,
    chainlinkAvailable: feeds !== null,
    alreadyTaken: false,
  };
}

export interface SnapshotPrice {
  ticker: string;
  /** Mid of the Robinhood bid/ask: the raw underlying share price. */
  price: number;
  spreadBps: number | null;
  isTradingHalt: boolean;
  multiplier: number;
  crossCheckOk: boolean | null;
  roundId: string | null;
}

/** Every price recorded on a given day, keyed by ticker. */
export async function getSnapshot(
  snapshotDate: string,
): Promise<Map<string, SnapshotPrice>> {
  const { data, error } = await db()
    .from("price_snapshots")
    .select(
      "ticker, price, spread_bps, is_trading_halt, multiplier, cross_check_ok, round_id",
    )
    .eq("snapshot_date", snapshotDate);

  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.ticker as string,
      {
        ticker: row.ticker as string,
        price: Number(row.price),
        spreadBps: row.spread_bps === null ? null : Number(row.spread_bps),
        isTradingHalt: row.is_trading_halt === true,
        multiplier: Number(row.multiplier ?? 1) || 1,
        crossCheckOk:
          row.cross_check_ok === null ? null : row.cross_check_ok === true,
        roundId: row.round_id === null ? null : String(row.round_id),
      },
    ]),
  );
}

/** The widest spread a snapshot price may carry and still be scoreable. */
export function spreadIsTradeable(spreadBps: number | null): boolean {
  if (spreadBps === null) return true;
  return spreadBps <= MAX_SPREAD_BPS;
}

/** Daily history for one ticker, oldest first — the native chart source. */
export async function getSnapshotSeries(
  ticker: string,
  limit = 400,
): Promise<Array<{ date: string; price: number }>> {
  const { data, error } = await db()
    .from("price_snapshots")
    .select("snapshot_date, price")
    .eq("ticker", ticker)
    .order("snapshot_date", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? [])
    .map((row) => ({
      date: row.snapshot_date as string,
      price: Number(row.price),
    }))
    .reverse();
}

/** The most recent snapshot on or before a date, for the UI's change figure. */
export async function getLatestSnapshotDate(): Promise<string | null> {
  const { data } = await db()
    .from("price_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.snapshot_date as string) ?? null;
}

/**
 * The first day prices were ever recorded. Anything before it can never be
 * scored, however many times the job retries, because the reference price was
 * never captured and cannot be reconstructed after the fact.
 */
export async function getEarliestSnapshotDate(): Promise<string | null> {
  const { data } = await db()
    .from("price_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.snapshot_date as string) ?? null;
}
