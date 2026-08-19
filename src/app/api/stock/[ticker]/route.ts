import { NextResponse } from "next/server";
import { SNAPSHOT_UTC_HOUR } from "@/lib/server/calendar";
import { hasDatabase } from "@/lib/server/db";
import { fetchQuote } from "@/lib/server/rhprices";
import { getLatestSnapshotDate, getSnapshot } from "@/lib/server/snapshot";
import { getStock } from "@/lib/server/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The locked reference price: the snapshot a call on this stock is scored
 * against. Distinct from the live price on purpose — the live number moves all
 * day, the locked one does not, and the gap between them is the player's
 * running result.
 */
async function lockedPrice(
  ticker: string,
): Promise<{ price: number; date: string } | null> {
  if (!hasDatabase) return null;

  try {
    const date = await getLatestSnapshotDate();
    if (!date) return null;

    const price = (await getSnapshot(date)).get(ticker)?.price;
    return price === undefined ? null : { price, date };
  } catch {
    return null;
  }
}

/** Header data for the detail sheet. The chart and news load separately. */
export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } },
) {
  const ticker = params.ticker.toUpperCase();

  const stock = await getStock(ticker).catch(() => null);
  if (!stock) {
    return NextResponse.json({ error: "Unknown ticker" }, { status: 404 });
  }

  const [quote, locked] = await Promise.all([
    fetchQuote(ticker).catch(() => null),
    lockedPrice(ticker),
  ]);

  const live = quote?.mid ?? null;

  return NextResponse.json({
    ticker,
    name: stock.name,
    logoUrl: stock.logoUrl,
    tokenAddress: stock.rhTokenAddress,
    multiplier: stock.multiplier,
    price: live,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    isTradingHalt: quote?.isTradingHalt ?? false,
    generatedAt: quote?.generatedAt ?? null,
    lockedPrice: locked?.price ?? null,
    lockedDate: locked?.date ?? null,
    lockedHourUtc: SNAPSHOT_UTC_HOUR,
    /** Move since the lock, which is what a call is actually winning or losing by. */
    changeSinceLockPct:
      live !== null && locked !== null && locked.price > 0
        ? Number((((live - locked.price) / locked.price) * 100).toFixed(2))
        : null,
  });
}
