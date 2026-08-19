import type { StockQuote } from "@/lib/types";
import { hasDatabase, db } from "./db";
import { fetchAllQuotes } from "./rhprices";
import { getLatestSnapshotDate, getSnapshot } from "./snapshot";
import { getStockMap } from "./universe";

/**
 * Prices for the UI.
 *
 * The number a card leads with is the official one: last close while the slate
 * is still open, the locked snapshot once it is. Live mid is carried alongside
 * as context. Painting the live print as the price, with a green/red % off it,
 * is how a player ends up calling a move that has already happened against a
 * strike that has not.
 *
 * Sparkline history is our own snapshot table. It starts empty and fills in one
 * point per trading day.
 */

// ------------------------------------------------------------------ fallback

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulatedSeries(ticker: string, points: number, dayKey: string) {
  const next = rng(hash(`${ticker}:${dayKey}`));
  const start = 18 + (hash(ticker) % 88000) / 100;
  const drift = (next() - 0.45) * 0.004;
  const series: number[] = [start];
  for (let i = 1; i < points; i++) {
    const shock = (next() - 0.5) * 0.02;
    series.push(Math.max(1, series[i - 1] * (1 + drift + shock)));
  }
  return series;
}

/**
 * Used only when the price feed is unreachable. Never used for scoring —
 * resolution reads the snapshot table and refuses to invent a price.
 */
function simulatedQuote(ticker: string, name: string, dayKey: string): StockQuote {
  const series = simulatedSeries(ticker, 24, dayKey);
  const live = series[series.length - 1];
  const close = series[0];
  return {
    ticker,
    name,
    price: Number(close.toFixed(2)),
    live: Number(live.toFixed(2)),
    reference: Number(close.toFixed(2)),
    referenceKind: "last_close",
    changePct: Number((((live - close) / close) * 100).toFixed(2)),
    series: series.map((v) => Number(v.toFixed(2))),
    simulated: true,
  };
}

// ------------------------------------------------------------------ quotes

/** Recent snapshot prices per ticker, oldest first, for the card sparklines. */
async function recentHistory(
  tickers: string[],
  days: number,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!hasDatabase) return out;

  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data } = await db()
    .from("price_snapshots")
    .select("ticker, price, snapshot_date")
    .in("ticker", tickers)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });

  for (const row of data ?? []) {
    const ticker = row.ticker as string;
    const series = out.get(ticker) ?? [];
    series.push(Number(row.price));
    out.set(ticker, series);
  }

  return out;
}

export async function getQuotes(
  tickers: string[],
  options: { slateLocked?: boolean } = {},
): Promise<StockQuote[]> {
  const dayKey = new Date().toISOString().slice(0, 10);
  const universe = await getStockMap().catch(() => new Map());
  const nameOf = (ticker: string) => universe.get(ticker)?.name ?? ticker;
  const referenceKind = options.slateLocked ? "locked" : "last_close";

  let live: Awaited<ReturnType<typeof fetchAllQuotes>> | null = null;
  try {
    live = await fetchAllQuotes();
  } catch {
    live = null;
  }

  if (!live) {
    return tickers.map((t) => simulatedQuote(t, nameOf(t), dayKey));
  }

  let reference = new Map<string, { price: number }>();
  if (hasDatabase) {
    try {
      const latest = await getLatestSnapshotDate();
      if (latest) reference = await getSnapshot(latest);
    } catch {
      reference = new Map();
    }
  }

  const history = hasDatabase
    ? await recentHistory(tickers, 31).catch(() => new Map<string, number[]>())
    : new Map<string, number[]>();

  return tickers.map((ticker) => {
    const quote = live.get(ticker);
    if (!quote) return simulatedQuote(ticker, nameOf(ticker), dayKey);

    const base = reference.get(ticker)?.price ?? null;
    const liveMid = Number(quote.mid.toFixed(2));
    const official = base !== null ? Number(base.toFixed(2)) : liveMid;
    const changePct =
      base && base > 0 ? Number((((quote.mid - base) / base) * 100).toFixed(2)) : 0;
    const series = history.get(ticker) ?? [];

    return {
      ticker,
      name: nameOf(ticker),
      price: official,
      live: liveMid,
      reference: base === null ? null : Number(base.toFixed(2)),
      referenceKind,
      changePct,
      series,
      simulated: false,
    };
  });
}
