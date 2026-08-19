import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/server/cron";
import { hasDatabase } from "@/lib/server/db";
import { resolveDueSlates } from "@/lib/server/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The catch-up run, half an hour behind the main one.
 *
 * It calls the same job, which is idempotent end to end: the snapshot freezes
 * once a date has a full set of rows, and a slate is only picked up while it is
 * still unresolved. So when the 22:00 run succeeded this does nothing, and when
 * it failed or came back short a ticker this is the second chance to finish the
 * day rather than lose it.
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
    const message = err instanceof Error ? err.message : "Catch-up run failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
