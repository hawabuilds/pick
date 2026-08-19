import { db } from "./db";

export type Cadence = "3day" | "daily";

export interface Season {
  id: number;
  startsAt: string;
  endsAt: string;
  cadence: Cadence;
}

const DEFAULT_CADENCE: Cadence =
  process.env.SEASON_CADENCE === "daily" ? "daily" : "3day";

function durationMs(cadence: Cadence) {
  return (cadence === "daily" ? 1 : 3) * 86400000;
}

function toSeason(row: {
  id: number;
  starts_at: string;
  ends_at: string;
  cadence: string;
}): Season {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cadence: row.cadence as Cadence,
  };
}

export async function getActiveSeason(): Promise<Season | null> {
  const { data } = await db()
    .from("active_season")
    .select("id, starts_at, ends_at, cadence")
    .maybeSingle();
  return data ? toSeason(data) : null;
}

/**
 * Guarantees a season is running. Seasons are contiguous: the next one starts
 * exactly where the last ended, so a job that runs late cannot leave a gap in
 * which scores belong to no season and vanish from the leaderboard.
 */
export async function ensureActiveSeason(now = new Date()): Promise<Season> {
  const supabase = db();

  const active = await getActiveSeason();
  if (active) return active;

  const { data: latest } = await supabase
    .from("seasons")
    .select("id, starts_at, ends_at, cadence")
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // A season scheduled ahead of time is left alone; adding another would
  // overlap it and double-count every score in the overlap.
  if (latest && new Date(latest.starts_at) > now) return toSeason(latest);

  const cadence: Cadence = latest ? (latest.cadence as Cadence) : DEFAULT_CADENCE;
  let startsAt = latest ? new Date(latest.ends_at) : new Date(now);
  let endsAt = new Date(startsAt.getTime() + durationMs(cadence));

  // Walk forward if several seasons' worth of time passed without a run.
  for (let i = 0; i < 400 && endsAt <= now; i++) {
    startsAt = endsAt;
    endsAt = new Date(startsAt.getTime() + durationMs(cadence));
  }

  const { data, error } = await supabase
    .from("seasons")
    .insert({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      cadence,
    })
    .select("id, starts_at, ends_at, cadence")
    .single();

  if (error) throw error;
  return toSeason(data);
}
