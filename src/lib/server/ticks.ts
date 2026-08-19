import { db, hasDatabase } from "./db";
import { fetchAllQuotes } from "./rhprices";

/**
 * Intraday price samples, for the detail-sheet chart only.
 *
 * Never read by resolution. A tick is whatever the price was when the job
 * happened to run; a snapshot is taken at one fixed instant and is the only
 * price a call settles against. Keeping them in separate tables is what stops
 * the two ever being confused for one another.
 */

/** Ticks only ever draw the 1D view; anything older comes from snapshots. */
const KEEP_DAYS = 3;

export interface TickReport {
  capturedAt: string;
  written: number;
  /** Tickers quoted but not stored, almost always because they are halted. */
  skipped: number;
  pruned: number;
  pruneError: string | null;
}

/**
 * Tickers we are allowed to write, read from our own table rather than the
 * registry: `price_ticks.ticker` is a foreign key, so a name the registry has
 * added but the seed job has not yet picked up would fail the whole batch.
 */
async function storableTickers(): Promise<Set<string>> {
  const { data, error } = await db()
    .from("stocks")
    .select("ticker")
    .eq("active", true);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.ticker as string));
}

export async function captureTicks(now = new Date()): Promise<TickReport> {
  const supabase = db();

  // One timestamp for the whole batch, rounded to the minute. Every ticker then
  // shares an x-axis, and a job that runs twice in the same minute writes the
  // same key twice rather than a second, near-identical point.
  const capturedAt = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  ).toISOString();

  const [quotes, allowed] = await Promise.all([
    fetchAllQuotes(),
    storableTickers(),
  ]);

  const rows: Array<{ ticker: string; captured_at: string; price: string }> = [];
  let skipped = 0;

  for (const [ticker, quote] of quotes) {
    // A halted ticker has no meaningful price. Leaving a gap in the line is
    // honest; drawing a stale one is not.
    if (!allowed.has(ticker) || quote.isTradingHalt) {
      if (allowed.has(ticker)) skipped++;
      continue;
    }
    rows.push({
      ticker,
      captured_at: capturedAt,
      price: quote.mid.toFixed(8),
    });
  }

  if (rows.length) {
    const { error } = await supabase
      .from("price_ticks")
      .upsert(rows, { onConflict: "ticker,captured_at", ignoreDuplicates: true });
    if (error) throw error;
  }

  // A failed prune is worth reporting but not worth losing the samples over:
  // they are already written by this point.
  const { data: pruned, error: pruneError } = await supabase.rpc(
    "prune_price_ticks",
    { p_keep_days: KEEP_DAYS },
  );

  return {
    capturedAt,
    written: rows.length,
    skipped,
    pruned: typeof pruned === "number" ? pruned : 0,
    pruneError: pruneError?.message ?? null,
  };
}

/** Samples for one ticker since a cutoff, oldest first. Never throws. */
export async function getTickSeries(
  ticker: string,
  since: Date,
): Promise<Array<{ t: string; price: number }>> {
  if (!hasDatabase) return [];

  const { data, error } = await db()
    .from("price_ticks")
    .select("captured_at, price")
    .eq("ticker", ticker)
    .gte("captured_at", since.toISOString())
    .order("captured_at", { ascending: true });

  if (error) return [];

  return (data ?? []).map((row) => ({
    t: row.captured_at as string,
    price: Number(row.price),
  }));
}
