/**
 * Robinhood Stock Token prices — the settlement source.
 *
 * These are the raw underlying equity bid/ask in USD. They are NOT adjusted by
 * the token multiplier, which matters everywhere: a price here is comparable to
 * another price here, but multiplying it by the multiplier would double-count.
 */

const API_BASE = process.env.ROBINHOOD_API_BASE ?? "https://api.robinhood.com";

/** Robinhood caches quotes for 15s, so polling faster only burns rate limit. */
const CACHE_TTL_MS = 15_000;

export interface Quote {
  ticker: string;
  bid: number;
  ask: number;
  /** Settlement price. Mid is used so neither side of the spread is favoured. */
  mid: number;
  spreadBps: number;
  isTradingHalt: boolean;
  generatedAt: string;
  dailyHigh: number | null;
  dailyLow: number | null;
  volume: number | null;
}

interface QuoteRow {
  tokenSymbol?: string;
  bid?: string;
  ask?: string;
  isTradingHalt?: boolean;
  generatedAt?: string;
  dailyHigh?: string;
  dailyLow?: string;
  dailyTradingVolume?: string;
}

function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toQuote(row: QuoteRow): Quote | null {
  const ticker = row.tokenSymbol;
  const bid = num(row.bid);
  const ask = num(row.ask);
  if (!ticker || bid === null || ask === null) return null;
  if (bid <= 0 || ask <= 0 || ask < bid) return null;

  const mid = (bid + ask) / 2;

  return {
    ticker,
    bid,
    ask,
    mid,
    spreadBps: ((ask - bid) / mid) * 10_000,
    isTradingHalt: row.isTradingHalt === true,
    generatedAt: row.generatedAt ?? new Date().toISOString(),
    dailyHigh: num(row.dailyHigh),
    dailyLow: num(row.dailyLow),
    volume: num(row.dailyTradingVolume),
  };
}

let cache: { at: number; quotes: Map<string, Quote> } | null = null;
let inFlight: Promise<Map<string, Quote>> | null = null;

async function load(): Promise<Map<string, Quote>> {
  const res = await fetch(`${API_BASE}/rhj/prices`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Robinhood /rhj/prices returned ${res.status}`);

  const body = (await res.json()) as { quotes?: QuoteRow[] };
  const quotes = new Map<string, Quote>();

  for (const row of body.quotes ?? []) {
    const quote = toQuote(row);
    if (quote) quotes.set(quote.ticker, quote);
  }

  if (quotes.size === 0) throw new Error("Robinhood /rhj/prices returned no quotes");
  return quotes;
}

/**
 * Every quote in one request.
 *
 * The unfiltered endpoint returns all ~194 tokens, so the whole slate costs a
 * single call rather than one per ticker. Concurrent callers share the same
 * request so a burst of page loads cannot multiply into a burst of upstream
 * traffic.
 */
export async function fetchAllQuotes(): Promise<Map<string, Quote>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.quotes;
  if (inFlight) return inFlight;

  inFlight = load()
    .then((quotes) => {
      cache = { at: Date.now(), quotes };
      return quotes;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function fetchQuote(ticker: string): Promise<Quote | null> {
  return (await fetchAllQuotes()).get(ticker) ?? null;
}
