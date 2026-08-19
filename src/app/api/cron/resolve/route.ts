import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/server/cron";
import { hasDatabase } from "@/lib/server/db";
import { resolveDueSlates } from "@/lib/server/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job, at 22:00 UTC. Takes the price snapshot, scores every slate the
 * snapshot completes, settles any finished season, then locks tomorrow's board
 * and opens the one after it.
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
    return NextResponse.json(await resolveDueSlates());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolution failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
