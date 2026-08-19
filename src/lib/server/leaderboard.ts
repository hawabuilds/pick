import type { LeaderboardRow, SeasonWindow } from "@/lib/types";

/**
 * Stand-in board for when Supabase is unconfigured, so the tab has real
 * structure to look at. Deterministic, and flagged as demo in the response.
 */
const DEMO_PLAYERS: Array<[name: string, handle: string, points: number]> = [
  ["Degen Oracle", "degenoracle", 512],
  ["Market Maxi", "marketmaxi", 498],
  ["Stock Whisperer", "stockwhisperer", 471],
  ["Calls Only", "callsonly", 440],
  ["Luna Trades", "lunatrades", 418],
  ["Tape Reader", "tapereader", 395],
  ["Blue Chip Ben", "bluechipben", 372],
  ["Close Caller", "closecaller", 351],
  ["Slate Runner", "slaterunner", 338],
  ["Green Candle", "greencandle", 322],
  ["Quiet Alpha", "quietalpha", 301],
  ["Paper Hands", "paperhands", 284],
  ["Index Ida", "indexida", 266],
  ["Ticker Tilly", "tickertilly", 249],
  ["Open Print", "openprint", 231],
  ["Long Only Lou", "longonlylou", 214],
];

export function demoLeaderboard(): {
  season: SeasonWindow;
  rows: LeaderboardRow[];
} {
  const startsAt = new Date();
  startsAt.setUTCHours(0, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 3 * 86400000);

  return {
    season: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      cadence: "3day",
    },
    rows: DEMO_PLAYERS.map(([displayName, handle, points], index) => ({
      userId: `demo:${handle}`,
      handle,
      displayName,
      pfpUrl: null,
      points,
      slatesPlayed: 3,
      rank: index + 1,
    })),
  };
}

export function demoMeRow(displayName: string, handle: string | null): LeaderboardRow {
  return {
    userId: "demo:local-player",
    handle,
    displayName,
    pfpUrl: null,
    points: 248,
    slatesPlayed: 3,
    rank: DEMO_PLAYERS.length + 1,
  };
}
