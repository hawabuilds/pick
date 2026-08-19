import { NextResponse, type NextRequest } from "next/server";
import { getPrivyId } from "@/lib/server/auth";
import { db, hasDatabase } from "@/lib/server/db";
import { demoLeaderboard, demoMeRow } from "@/lib/server/leaderboard";
import { getUserId } from "@/lib/server/play";
import { getActiveSeason } from "@/lib/server/seasons";
import type { LeaderboardRow, LeaderboardState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type ViewRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  points: number;
  slates_played: number;
  rank: number;
};

function toRow(row: ViewRow): LeaderboardRow {
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name ?? row.handle ?? "Player",
    pfpUrl: row.pfp_url,
    points: row.points,
    slatesPlayed: row.slates_played,
    rank: row.rank,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(params.get("limit") ?? PAGE_SIZE) || PAGE_SIZE),
  );

  if (!hasDatabase) {
    const { season, rows } = demoLeaderboard();
    const state: LeaderboardState = {
      season,
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      me: demoMeRow("Hawa", "hawabuilds"),
      demo: true,
    };
    return NextResponse.json(state);
  }

  const supabase = db();
  const season = await getActiveSeason();

  const { data, count, error } = await supabase
    .from("leaderboard")
    .select("user_id, handle, display_name, pfp_url, points, slates_played, rank", {
      count: "exact",
    })
    .order("rank", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as ViewRow[]).map(toRow);

  // The player's own row is fetched separately so it can be pinned even when
  // their rank falls outside the page that was loaded.
  let me: LeaderboardRow | null = null;
  const privyId = await getPrivyId(request);
  if (privyId) {
    const userId = await getUserId(privyId);
    if (userId) {
      const { data: mine } = await supabase
        .from("leaderboard")
        .select("user_id, handle, display_name, pfp_url, points, slates_played, rank")
        .eq("user_id", userId)
        .maybeSingle();
      if (mine) me = toRow(mine as ViewRow);
    }
  }

  const state: LeaderboardState = {
    season: season
      ? {
          startsAt: season.startsAt,
          endsAt: season.endsAt,
          cadence: season.cadence,
        }
      : null,
    rows,
    total: count ?? rows.length,
    me,
    demo: false,
  };

  return NextResponse.json(state);
}
