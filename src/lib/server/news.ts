/**
 * NON-PARTNER EXCEPTION: the only data source outside the Robinhood Chain
 * ecosystem, used solely for stock-detail news because no partner supplies
 * equity news. Isolated here so it can be swapped or removed without touching
 * the rest of the app.
 *
 * Nothing here is ever used for scoring, pricing or eligibility. It is display
 * copy on a detail sheet, and the sheet renders fine without it — every failure
 * path returns an empty list rather than throwing.
 *
 * Do not add news calls anywhere else, and do not add a second non-partner
 * provider. See the data-source policy in .cursorrules.
 */

const API_BASE = "https://finnhub.io/api/v1";

/** Off by default: the app must run with no third-party key configured. */
const ENABLED =
  process.env.NEWS_ENABLED === "true" && Boolean(process.env.NEWS_API_KEY);

const CACHE_TTL_MS = 10 * 60 * 1000;

/** How far back to ask for. Company news is sparse for smaller names. */
const LOOKBACK_DAYS = 14;

const MAX_ITEMS = 3;

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl: string | null;
}

interface FinnhubArticle {
  id?: number;
  headline?: string;
  url?: string;
  source?: string;
  datetime?: number;
  image?: string;
}

const cache = new Map<string, { at: number; items: NewsItem[] }>();

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function load(ticker: string): Promise<NewsItem[]> {
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 86400000);

  const url = new URL(`${API_BASE}/company-news`);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", dateKey(from));
  url.searchParams.set("to", dateKey(to));
  url.searchParams.set("token", process.env.NEWS_API_KEY ?? "");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];

  const body = (await res.json()) as FinnhubArticle[] | { error?: string };
  if (!Array.isArray(body)) return [];

  return body
    .map((article) => {
      const title = article.headline?.trim();
      const link = article.url?.trim();
      // A headline with no working link is not tappable, which is the whole
      // point of the list.
      if (!title || !link || !isHttpUrl(link)) return null;

      return {
        id: String(article.id ?? link),
        title,
        url: link,
        source: article.source?.trim() || "News",
        publishedAt: new Date((article.datetime ?? 0) * 1000).toISOString(),
        imageUrl: article.image && isHttpUrl(article.image) ? article.image : null,
      } satisfies NewsItem;
    })
    .filter((item): item is NewsItem => item !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_ITEMS);
}

export function newsEnabled(): boolean {
  return ENABLED;
}

/** Never throws: the detail sheet degrades to "No recent news" instead. */
export async function getNews(ticker: string): Promise<NewsItem[]> {
  if (!ENABLED) return [];

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;

  try {
    const items = await load(ticker);
    cache.set(ticker, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}
