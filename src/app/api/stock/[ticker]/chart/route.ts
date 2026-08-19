import { NextResponse, type NextRequest } from "next/server";
import { getChart, isTimeframe } from "@/lib/server/chart";
import { getStock } from "@/lib/server/universe";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } },
) {
  const ticker = params.ticker.toUpperCase();

  const stock = await getStock(ticker).catch(() => null);
  if (!stock) {
    return NextResponse.json({ error: "Unknown ticker" }, { status: 404 });
  }

  const requested = request.nextUrl.searchParams.get("timeframe") ?? "1M";
  const timeframe = isTimeframe(requested) ? requested : "1M";

  const chart = await getChart(ticker, timeframe);

  return NextResponse.json(chart, {
    // Prices move, but not fast enough that a shared 60s cache misleads anyone
    // on a display-only chart, and it keeps a scrolled list of taps cheap.
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
