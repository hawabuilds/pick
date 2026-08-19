import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PICKS_PER_SLATE } from "@/config/app";
import { getPrivyId } from "@/lib/server/auth";
import { db, hasDatabase } from "@/lib/server/db";
import { accountRestriction } from "@/lib/server/eligibility";
import { allow, LIMITS, logAbuse } from "@/lib/server/limits";
import { getOpenSlate, getSubmission, getUserId } from "@/lib/server/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  slateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  picks: z
    .array(
      z.object({
        ticker: z.string().min(1).max(10),
        direction: z.enum(["up", "down"]),
      }),
    )
    .length(PICKS_PER_SLATE),
});

export async function POST(request: NextRequest) {
  if (!hasDatabase) {
    return NextResponse.json(
      { error: "Supabase is not configured; picks are stored locally." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A slate is exactly 10 calls." },
      { status: 400 },
    );
  }

  const privyId = await getPrivyId(request);
  if (!privyId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userId = await getUserId(privyId);
  if (!userId) {
    return NextResponse.json({ error: "Unknown player." }, { status: 401 });
  }

  if (!(await allow(LIMITS.submitPicks, userId))) {
    await logAbuse({ kind: "picks_rate_limited", userId, request });
    return NextResponse.json(
      { error: "Too many submissions. Try again shortly." },
      { status: 429 },
    );
  }

  const restriction = await accountRestriction(userId);
  if (restriction.restricted) {
    await logAbuse({ kind: "picks_from_young_account", userId, request });
    return NextResponse.json({ error: restriction.reason }, { status: 403 });
  }

  const { slateDate, picks } = parsed.data;
  const slate = await getOpenSlate();

  if (slate.slateDate !== slateDate) {
    return NextResponse.json(
      { error: "That slate is no longer open." },
      { status: 409 },
    );
  }

  // The database trigger enforces this too, but checking here means the player
  // gets a sentence rather than a constraint violation.
  if (Date.now() >= new Date(slate.locksAt).getTime()) {
    await logAbuse({
      kind: "picks_after_lock",
      userId,
      detail: { slateDate, locksAt: slate.locksAt },
      request,
    });
    return NextResponse.json({ error: "Calls are locked." }, { status: 409 });
  }

  if (picks.length !== PICKS_PER_SLATE) {
    return NextResponse.json(
      { error: `A slate is exactly ${PICKS_PER_SLATE} calls.` },
      { status: 400 },
    );
  }

  const tickers = new Set(picks.map((p) => p.ticker));
  if (tickers.size !== picks.length) {
    return NextResponse.json(
      { error: "One call per stock." },
      { status: 400 },
    );
  }
  if (picks.some((p) => !slate.tickers.includes(p.ticker))) {
    return NextResponse.json(
      { error: "A pick is not on this slate." },
      { status: 400 },
    );
  }

  const supabase = db();

  const { data: existing } = await supabase
    .from("submissions")
    .select("counted")
    .eq("user_id", userId)
    .eq("slate_date", slateDate)
    .maybeSingle();

  if (existing?.counted) {
    return NextResponse.json(
      { error: "You already locked in this slate." },
      { status: 409 },
    );
  }

  // Replace any partially written set so the row-count trigger sees a clean ten.
  await supabase
    .from("picks")
    .delete()
    .eq("user_id", userId)
    .eq("slate_date", slateDate);

  const { error: picksError } = await supabase.from("picks").insert(
    picks.map((pick) => ({
      user_id: userId,
      slate_date: slateDate,
      ticker: pick.ticker,
      direction: pick.direction,
    })),
  );

  if (picksError) {
    return NextResponse.json({ error: picksError.message }, { status: 400 });
  }

  const { error: submissionError } = await supabase.from("submissions").upsert(
    {
      user_id: userId,
      slate_date: slateDate,
      submitted_at: new Date().toISOString(),
      counted: true,
    },
    { onConflict: "user_id,slate_date" },
  );

  if (submissionError) {
    return NextResponse.json({ error: submissionError.message }, { status: 400 });
  }

  return NextResponse.json({
    submission: await getSubmission(userId, slateDate),
  });
}
