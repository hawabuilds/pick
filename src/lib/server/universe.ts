import type { Stock } from "@/lib/types";
import { db, hasDatabase } from "./db";

/**
 * The tokenized RWA universe, built from Robinhood's own asset registry.
 *
 * Nothing here is hardcoded. Token addresses come from `/rhj/assets`, which is
 * the canonical registry — a token with a matching ticker at any other address
 * is not a Robinhood Stock Token, so inventing an address locally is the one
 * mistake that could pay a reward into the wrong contract.
 */

const API_BASE = process.env.ROBINHOOD_API_BASE ?? "https://api.robinhood.com";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Robinhood names every token "<Company> • Robinhood Token". */
function cleanName(raw: string): string {
  return raw
    .replace(/\s*[•·]\s*Robinhood Token\s*$/u, "")
    .replace(/\s+Class A Common Stock$/u, "")
    .trim();
}

interface AssetRow {
  tokenSymbol?: string;
  tokenName?: string;
  status?: string;
  currentMultiplier?: string;
  pendingMultiplier?: string;
  logoUrl?: string;
  tokenDecimals?: number;
  deployments?: Array<{ contractAddress?: string; chainId?: number }>;
}

let cache: { at: number; stocks: Stock[] } | null = null;

async function fetchAssets(): Promise<Stock[]> {
  const res = await fetch(`${API_BASE}/rhj/assets`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Robinhood /rhj/assets returned ${res.status}`);

  const body = (await res.json()) as { assets?: AssetRow[] };
  const rows = body.assets ?? [];

  const stocks = rows
    .filter((row) => row.status === "ASSET_STATUS_ACTIVE")
    .map((row) => {
      const deployment = (row.deployments ?? []).find(
        (d) => typeof d.contractAddress === "string",
      );
      return {
        ticker: row.tokenSymbol ?? "",
        name: cleanName(row.tokenName ?? row.tokenSymbol ?? ""),
        rhTokenAddress: deployment?.contractAddress ?? null,
        logoUrl: row.logoUrl ?? null,
        multiplier: row.currentMultiplier ?? "1",
        decimals: row.tokenDecimals ?? 18,
        active: true,
        sort: 0,
      } satisfies Stock;
    })
    .filter((stock) => stock.ticker.length > 0 && stock.rhTokenAddress !== null);

  // Alphabetical so the board is stable between runs and predictable to search.
  stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
  stocks.forEach((stock, index) => {
    stock.sort = index;
  });

  if (stocks.length === 0) {
    throw new Error("Robinhood /rhj/assets returned no active assets");
  }

  return stocks;
}

/**
 * Last known universe from our own table.
 *
 * The registry being unreachable must not empty the board mid-session, and the
 * seed job keeps this table in step with the API.
 */
async function fetchFromDatabase(): Promise<Stock[]> {
  if (!hasDatabase) return [];

  const { data } = await db()
    .from("stocks")
    .select("ticker, name, rh_token_address, logo_url, multiplier, active, sort")
    .eq("active", true)
    .order("sort", { ascending: true });

  return (data ?? []).map((row) => ({
    ticker: row.ticker as string,
    name: row.name as string,
    rhTokenAddress: (row.rh_token_address as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    multiplier: (row.multiplier as string) ?? "1",
    decimals: 18,
    active: true,
    sort: (row.sort as number) ?? 0,
  }));
}

export async function getUniverse(): Promise<Stock[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.stocks;

  let stocks: Stock[];
  try {
    stocks = await fetchAssets();
  } catch (err) {
    stocks = await fetchFromDatabase();
    if (stocks.length === 0) throw err;
  }

  cache = { at: Date.now(), stocks };
  return stocks;
}

export async function getUniverseTickers(): Promise<string[]> {
  return (await getUniverse()).map((stock) => stock.ticker);
}

export async function getStockMap(): Promise<Map<string, Stock>> {
  return new Map((await getUniverse()).map((stock) => [stock.ticker, stock]));
}

export async function getStock(ticker: string): Promise<Stock | null> {
  return (await getStockMap()).get(ticker) ?? null;
}

/** Drops the cache so a sync job picks up registry changes immediately. */
export function clearUniverseCache(): void {
  cache = null;
}
