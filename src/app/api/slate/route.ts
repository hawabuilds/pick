import { NextResponse, type NextRequest } from "next/server";
import { getPrivyId } from "@/lib/server/auth";
import { hasDatabase } from "@/lib/server/db";
import { getQuotes } from "@/lib/server/market";
import { getOpenSlate, getSubmission, getUserId } from "@/lib/server/play";
import type { PlayState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const slate = await getOpenSlate();
  const slateLocked = new Date(slate.locksAt).getTime() <= Date.now();
  const quotes = await getQuotes(slate.tickers, {slateLocked});

  let submission = null;
  if (hasDatabase) {
    const privyId = await getPrivyId(request);
    if (privyId) {
      const userId = await getUserId(privyId);
      if (userId) submission = await getSubmission(userId, slate.slateDate);
    }
  }

  const state: PlayState = {
    slate,
    quotes,
    submission,
    demo: !hasDatabase,
  };

  return NextResponse.json(state);
}
