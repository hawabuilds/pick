import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/server/cron";
import { hasDatabase } from "@/lib/server/db";
import { captureTicks } from "@/lib/server/ticks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Samples every quoted price, for the detail-sheet chart.
 *
 * Runs through the US session. One upstream call covers all ~194 tokens, and
 * old samples are pruned on the way out, so the table stays at roughly one
 * session's worth however long this runs for.
 *
 * Nothing here affects scoring. If it never runs, the chart falls back to daily
 * snapshots and every other part of the game is unchanged.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasDatabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await captureTicks());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tick capture failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
