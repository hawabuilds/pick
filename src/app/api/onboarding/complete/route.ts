import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { isResponse, requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records that a player has been sent into the guide.
 *
 * Called on arrival in the Learn tab, not on finishing the lessons: all this
 * decides is whether they get routed there again, and a player who wants to
 * skip ahead should be able to. Whether they actually finished is
 * `learner_progress.tasks_done`, which the reward gates already stand on.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isResponse(auth)) return auth;

  const { error } = await db()
    .from("users")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", auth.userId)
    .is("onboarded_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
