import { NextResponse } from "next/server";
import { getNews, newsEnabled } from "@/lib/server/news";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } },
) {
  const ticker = params.ticker.toUpperCase();

  // Deliberately never a 4xx or 5xx: the sheet shows "No recent news" and the
  // rest of it keeps working whether or not the provider is configured.
  const items = await getNews(ticker);

  return NextResponse.json(
    { ticker, enabled: newsEnabled(), items },
    {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
      },
    },
  );
}
