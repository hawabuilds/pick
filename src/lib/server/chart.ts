import { getSnapshotSeries } from "./snapshot";
import { getTickSeries } from "./ticks";
import { getStock } from "./universe";

/**
 * Price history for the stock detail sheet. Display only — never scored.
 *
 * Three sources, in order of preference and all inside the Robinhood Chain
 * ecosystem bar none:
 *
 * 1. `price_ticks` — intraday samples of the same Robinhood quote the game
 *    settles on, which is what makes a 1D chart possible at all.
 * 2. `price_snapshots` — one point per trading day, the exact prices the game
 *    settled on, so the chart and the result can never tell different stories.
 * 3. Alchemy's Prices API, where it covers the token.
 *
 * Alchemy is best-effort throughout. An unset key, an unsupported network or a
 * token it has never seen all fall back to the native series rather than
 * failing the sheet.
 */

export type Timeframe = "1D" | "1W" | "1M" | "1Y";

export const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "1Y"];

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as string[]).includes(value);
}

const WINDOW_DAYS: Record<Timeframe, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 31,
  "1Y": 365,
};

/** Alchemy caps the range per interval: 5m over 7d, 1h over 30d, 1d over a year. */
const INTERVAL: Record<Timeframe, "5m" | "1h" | "1d"> = {
  "1D": "5m",
  "1W": "1h",
  "1M": "1h",
  "1Y": "1d",
};

export interface ChartPoint {
  /** ISO timestamp. */
  t: string;
  price: number;
}

export interface Chart {
  ticker: string;
  timeframe: Timeframe;
  points: ChartPoint[];
  source: "ticks" | "alchemy" | "snapshots" | "none";
  changePct: number | null;
}

// ------------------------------------------------------------------ alchemy

function alchemyKey(): string | null {
  const explicit = process.env.ALCHEMY_API_KEY;
  if (explicit) return explicit;

  // The RPC URL already ends in the key, so a single configured value is enough.
  const rpc = process.env.ALCHEMY_RPC_URL;
  if (!rpc) return null;
  const tail = rpc.split("/").filter(Boolean).pop();
  return tail && tail.length > 8 ? tail : null;
}

const PRICES_NETWORK = process.env.ALCHEMY_PRICES_NETWORK ?? "";

interface HistoricalResponse {
  data?: {
    prices?: Array<{ value?: string; timestamp?: string }>;
  };
  error?: unknown;
}

async function fromAlchemy(
  address: string,
  timeframe: Timeframe,
): Promise<ChartPoint[]> {
  const key = alchemyKey();
  if (!key || !PRICES_NETWORK) return [];

  const endTime = new Date();
  const startTime = new Date(
    endTime.getTime() - WINDOW_DAYS[timeframe] * 86400000,
  );

  const res = await fetch(
    `https://api.g.alchemy.com/prices/v1/${key}/tokens/historical`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network: PRICES_NETWORK,
        address,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        interval: INTERVAL[timeframe],
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) return [];

  const body = (await res.json()) as HistoricalResponse;
  if (body.error) return [];

  return (body.data?.prices ?? [])
    .map((row) => ({
      t: row.timestamp ?? "",
      price: Number(row.value),
    }))
    .filter((point) => point.t !== "" && Number.isFinite(point.price));
}

// ------------------------------------------------------------------- native

async function fromSnapshots(
  ticker: string,
  timeframe: Timeframe,
): Promise<ChartPoint[]> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS[timeframe] * 86400000)
    .toISOString()
    .slice(0, 10);

  const rows = await getSnapshotSeries(ticker).catch(() => []);

  return rows
    .filter((row) => row.date >= cutoff)
    .map((row) => ({ t: `${row.date}T00:00:00.000Z`, price: row.price }));
}

/**
 * Intraday samples. Only kept for a few days, so they can serve 1D and 1W and
 * nothing longer — asking for a year would silently return three days of line
 * labelled as a year, which is worse than no chart.
 */
async function fromTicks(
  ticker: string,
  timeframe: Timeframe,
): Promise<ChartPoint[]> {
  if (timeframe !== "1D") return [];

  const since = new Date(Date.now() - WINDOW_DAYS[timeframe] * 86400000);
  return getTickSeries(ticker, since).catch(() => []);
}

// -------------------------------------------------------------------- chart

export async function getChart(
  ticker: string,
  timeframe: Timeframe,
): Promise<Chart> {
  const stock = await getStock(ticker).catch(() => null);

  const [ticks, alchemy, native] = await Promise.all([
    fromTicks(ticker, timeframe),
    stock?.rhTokenAddress
      ? fromAlchemy(stock.rhTokenAddress, timeframe).catch(() => [])
      : Promise.resolve([]),
    fromSnapshots(ticker, timeframe),
  ]);

  // A single point draws nothing, so a source needs two before it is worth
  // preferring. Our own ticks come first: they are the same quote the game
  // settles on, so the chart and the result cannot disagree.
  const [source, points] =
    ticks.length > 1
      ? (["ticks", ticks] as const)
      : alchemy.length > 1
        ? (["alchemy", alchemy] as const)
        : (["snapshots", native] as const);

  const first = points[0]?.price;
  const last = points[points.length - 1]?.price;

  return {
    ticker,
    timeframe,
    points,
    source: points.length > 1 ? source : "none",
    changePct:
      first && last && first > 0
        ? Number((((last - first) / first) * 100).toFixed(2))
        : null,
  };
}
