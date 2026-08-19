import type { Direction } from "@/lib/types";
import {
  isTradingDay,
  lockedSlateDate,
  openSlateDate,
  previousTradingDay,
  snapshotAt,
} from "./calendar";
import { actionsInWindow } from "./corpactions";
import { db } from "./db";
import { computeSlate } from "./play";
import {
  settleFinishedSeasons,
  type HeldSeason,
  type PayoutReport,
} from "./payouts";
import { ensureActiveSeason } from "./seasons";
import {
  getEarliestSnapshotDate,
  getSnapshot,
  spreadIsTradeable,
  takeSnapshot,
  type SnapshotReport,
} from "./snapshot";

export interface SlateReport {
  slateDate: string;
  tickersResolved: number;
  tickersMissing: number;
  tickersVoided: number;
  playersScored: number;
  /** Players whose board had fewer than seven scoreable tickers. */
  playersVoided: number;
  streaksBroken: number;
  streaksFrozen: number;
  finalised: boolean;
}

export interface ResolveReport {
  snapshot: SnapshotReport | null;
  resolved: SlateReport[];
  skipped: Array<{ slateDate: string; reason: string }>;
  lockedSlate: string | null;
  nextSlate: string | null;
  payouts: PayoutReport[];
  /** Ended seasons held back because a slate in their window is unscored. */
  heldSeasons: HeldSeason[];
}

export type Outcome = "up" | "down" | "flat" | "void";

export type VoidReason =
  | "corporate_action"
  | "trading_halt"
  | "cross_check"
  | "missing_price"
  | "wide_spread";

/** Below this many scoreable tickers, a player's whole slate is thrown out. */
export const MIN_VALID_PICKS = 7;

/**
 * Scores every slate whose snapshot has been taken, then keeps the board
 * stocked.
 *
 * Safe to run more than once: the snapshot freezes on first capture, a slate is
 * only picked up while `resolved` is false, and streaks carry
 * `last_resolved_date` so a repeat run cannot advance them twice.
 */
export async function resolveDueSlates(now = new Date()): Promise<ResolveReport> {
  const supabase = db();
  const report: ResolveReport = {
    snapshot: null,
    resolved: [],
    skipped: [],
    lockedSlate: null,
    nextSlate: null,
    payouts: [],
    heldSeasons: [],
  };

  // Prices first. Everything below reads from the snapshot table, so a failure
  // here must abort rather than let scoring fall through to a partial day.
  report.snapshot = await takeSnapshot(now);

  const { data: due, error } = await supabase
    .from("daily_slates")
    .select("slate_date, tickers")
    .eq("resolved", false)
    .order("slate_date", { ascending: true });

  if (error) throw error;

  const earliest = await getEarliestSnapshotDate();

  for (const slate of due ?? []) {
    const slateDate = slate.slate_date as string;

    // A slate whose reference day predates the first snapshot can never be
    // scored: that price was never captured and cannot be reconstructed. Left
    // unresolved it would block every season payout behind it forever, so it is
    // closed out unscored instead. This is the seeded slate on a fresh install.
    if (earliest && previousTradingDay(slateDate) < earliest) {
      await supabase
        .from("daily_slates")
        .update({ resolved: true })
        .eq("slate_date", slateDate);
      report.skipped.push({
        slateDate,
        reason: `reference day predates the first snapshot (${earliest})`,
      });
      continue;
    }

    if (!isTradingDay(slateDate)) {
      await supabase
        .from("daily_slates")
        .update({ resolved: true })
        .eq("slate_date", slateDate);
      report.skipped.push({ slateDate, reason: "not a trading day" });
      continue;
    }

    if (now < snapshotAt(slateDate)) {
      report.skipped.push({ slateDate, reason: "snapshot not due yet" });
      continue;
    }

    // One bad slate must not stop the others, and must not stop the payout and
    // housekeeping steps below.
    try {
      report.resolved.push(
        await resolveSlate(slateDate, slate.tickers as string[]),
      );
    } catch (err) {
      report.skipped.push({
        slateDate,
        reason: err instanceof Error ? err.message : "resolution failed",
      });
    }
  }

  // Payouts are granted after scoring so a season that ends today is settled
  // with the final slate already counted.
  const settlement = await settleFinishedSeasons(now);
  report.payouts = settlement.paid;
  report.heldSeasons = settlement.held;

  // Expired rate-limit windows are dead weight; this is the only job that runs
  // often enough to sweep them without needing its own schedule.
  await supabase.rpc("prune_rate_limits", { p_older_than: "1 day" });

  await ensureActiveSeason(now);

  const slates = await ensureSlates(now);
  report.lockedSlate = slates.locked;
  report.nextSlate = slates.open;

  return report;
}

export interface TickerReading {
  price: number;
  spreadBps: number | null;
  isTradingHalt: boolean;
  multiplier: number;
  crossCheckOk: boolean | null;
}

export interface OutcomeInput {
  today: TickerReading | null;
  previous: TickerReading | null;
  /** A split or dividend processed between the two snapshots. */
  corporateAction: boolean;
}

/**
 * Exported for the verification script: this is the whole scoring decision.
 *
 * Settlement compares raw underlying prices, so anything that moves the quote
 * for a non-market reason has to void the ticker instead of scoring it. A
 * dividend or split is the sharp case — the price genuinely drops, every "down"
 * call would be paid, and nothing about the company changed.
 */
export function outcomeOf(input: OutcomeInput): {
  direction: Outcome;
  reason: VoidReason | null;
} {
  const { today, previous } = input;

  if (!today || !previous) {
    return { direction: "void", reason: "missing_price" };
  }

  // The multiplier moving is the same event as a corporate action, caught from
  // our own stored data rather than from the actions endpoint alone.
  if (input.corporateAction || today.multiplier !== previous.multiplier) {
    return { direction: "void", reason: "corporate_action" };
  }

  if (today.isTradingHalt || previous.isTradingHalt) {
    return { direction: "void", reason: "trading_halt" };
  }

  // Only an explicit disagreement voids. A null means the ticker has no
  // Chainlink feed at all, which is true of most of the universe.
  if (today.crossCheckOk === false || previous.crossCheckOk === false) {
    return { direction: "void", reason: "cross_check" };
  }

  if (
    !spreadIsTradeable(today.spreadBps) ||
    !spreadIsTradeable(previous.spreadBps)
  ) {
    return { direction: "void", reason: "wide_spread" };
  }

  if (today.price > previous.price) return { direction: "up", reason: null };
  if (today.price < previous.price) return { direction: "down", reason: null };
  return { direction: "flat", reason: null };
}

async function resolveSlate(
  slateDate: string,
  tickers: string[],
): Promise<SlateReport> {
  const supabase = db();
  const prevDate = previousTradingDay(slateDate);

  const [today, previous, corpActions] = await Promise.all([
    getSnapshot(slateDate),
    getSnapshot(prevDate),
    actionsInWindow(prevDate, slateDate),
  ]);

  if (today.size === 0) {
    throw new Error(`no price snapshot for ${slateDate}`);
  }
  if (previous.size === 0) {
    throw new Error(`no price snapshot for ${prevDate} to compare against`);
  }

  const outcomes = new Map<string, Outcome>();
  const rows = [];
  let voided = 0;
  let missing = 0;

  for (const ticker of tickers) {
    const now = today.get(ticker) ?? null;
    const before = previous.get(ticker) ?? null;

    // A ticker with no price on either day gets no result row, which keeps the
    // slate unfinalised so the retry can still fill it in. Everything else is
    // decided now.
    if (!now || !before) {
      missing++;
      continue;
    }

    const { direction, reason } = outcomeOf({
      today: now,
      previous: before,
      corporateAction: corpActions.has(ticker),
    });

    if (direction === "void") voided++;
    outcomes.set(ticker, direction);

    rows.push({
      slate_date: slateDate,
      ticker,
      close: now.price,
      prev_close: before.price,
      direction,
      void_reason: reason,
      source: "robinhood",
      round_id: now.roundId,
      prev_round_id: before.roundId,
    });
  }

  if (rows.length) {
    const { error } = await supabase
      .from("slate_results")
      .upsert(rows, { onConflict: "slate_date,ticker" });
    if (error) throw error;
  }

  // Only counted submissions score. A partial set of picks is not a slate.
  const { data: submissions } = await supabase
    .from("submissions")
    .select("user_id")
    .eq("slate_date", slateDate)
    .eq("counted", true);

  const players = new Set((submissions ?? []).map((s) => s.user_id as string));

  const { data: picks } = await supabase
    .from("picks")
    .select("user_id, ticker, direction")
    .eq("slate_date", slateDate);

  const correctByUser = new Map<string, number>();
  const validByUser = new Map<string, number>();

  for (const pick of picks ?? []) {
    const userId = pick.user_id as string;
    if (!players.has(userId)) continue;

    const outcome = outcomes.get(pick.ticker as string);
    // 'flat' is a real result that simply scores nothing, so it still counts as
    // a valid pick. Only a void means the ticker was unscoreable.
    if (!outcome || outcome === "void") continue;

    validByUser.set(userId, (validByUser.get(userId) ?? 0) + 1);
    if (outcome === (pick.direction as Direction)) {
      correctByUser.set(userId, (correctByUser.get(userId) ?? 0) + 1);
    }
  }

  // A slate where too much of a player's board was voided is not a fair round.
  // Scoring it would rank someone who happened to pick unaffected tickers above
  // someone who did not, on nothing they controlled.
  const voidedPlayers = new Set<string>();
  for (const userId of players) {
    if ((validByUser.get(userId) ?? 0) < MIN_VALID_PICKS) {
      voidedPlayers.add(userId);
    }
  }

  if (players.size) {
    const scoreRows = [...players].map((userId) => {
      const isVoid = voidedPlayers.has(userId);
      const correct = correctByUser.get(userId) ?? 0;
      return {
        user_id: userId,
        slate_date: slateDate,
        correct_count: isVoid ? 0 : correct,
        points: isVoid ? 0 : correct,
        valid_count: validByUser.get(userId) ?? 0,
        voided: isVoid,
      };
    });
    const { error } = await supabase
      .from("scores")
      .upsert(scoreRows, { onConflict: "user_id,slate_date" });
    if (error) throw error;
  }

  // A voided slate must not cost a streak either: the player showed up, the
  // prices did not. They are treated as having played, which is what preserving
  // the streak means here.
  const streaks = await updateStreaks(slateDate, players);

  // Finalise only when every ticker on the board produced a result. Marking a
  // partial slate resolved would silently strip picks off the missing tickers
  // and there would be no second chance to fill them in.
  if (missing === 0) {
    const { error: markError } = await supabase
      .from("daily_slates")
      .update({ resolved: true })
      .eq("slate_date", slateDate);
    if (markError) throw markError;
  }

  return {
    slateDate,
    tickersResolved: rows.length,
    tickersMissing: missing,
    tickersVoided: voided,
    playersScored: players.size,
    playersVoided: voidedPlayers.size,
    streaksBroken: streaks.broken,
    streaksFrozen: streaks.frozen,
    finalised: missing === 0,
  };
}

async function updateStreaks(slateDate: string, players: Set<string>) {
  const supabase = db();

  const { data: existing } = await supabase
    .from("streaks")
    .select(
      "user_id, current, longest, freezes_left, last_played_date, last_resolved_date",
    );

  const byUser = new Map(
    (existing ?? []).map((row) => [row.user_id as string, row]),
  );

  const updates = [];
  let broken = 0;
  let frozen = 0;

  for (const userId of players) {
    const row = byUser.get(userId);
    if (row?.last_resolved_date === slateDate) continue;
    const current = (row?.current ?? 0) + 1;
    updates.push({
      user_id: userId,
      current,
      longest: Math.max(current, row?.longest ?? 0),
      last_played_date: slateDate,
      last_resolved_date: slateDate,
      freezes_left: row?.freezes_left ?? 1,
    });
  }

  // Anyone with a live streak who sat this slate out spends their one freeze,
  // and loses the streak if they have already spent it.
  for (const row of existing ?? []) {
    const userId = row.user_id as string;
    if (players.has(userId)) continue;
    if (row.last_resolved_date === slateDate) continue;
    if ((row.current ?? 0) === 0) continue;

    const hasFreeze = (row.freezes_left ?? 0) > 0;
    if (hasFreeze) frozen++;
    else broken++;

    updates.push({
      user_id: userId,
      current: hasFreeze ? row.current : 0,
      longest: row.longest ?? 0,
      last_played_date: row.last_played_date ?? null,
      last_resolved_date: slateDate,
      freezes_left: hasFreeze ? row.freezes_left - 1 : 0,
    });
  }

  if (updates.length) {
    const { error } = await supabase
      .from("streaks")
      .upsert(updates, { onConflict: "user_id" });
    if (error) throw error;
  }

  return { broken, frozen };
}

async function upsertSlate(slateDate: string): Promise<void> {
  const supabase = db();

  const { data } = await supabase
    .from("daily_slates")
    .select("slate_date")
    .eq("slate_date", slateDate)
    .maybeSingle();

  if (data) return;

  const slate = await computeSlate(slateDate);
  const { error } = await supabase.from("daily_slates").insert({
    slate_date: slate.slateDate,
    tickers: slate.tickers,
    locks_at: slate.locksAt,
  });
  if (error) throw error;
}

/**
 * Keeps both slates on the board: the one locked and being played out, and the
 * one taking picks for the day after.
 */
export async function ensureSlates(
  now = new Date(),
): Promise<{ locked: string; open: string }> {
  const locked = lockedSlateDate(now);
  const open = openSlateDate(now);

  await upsertSlate(locked);
  await upsertSlate(open);

  return { locked, open };
}

/** Opens the next trading day's slate so the Play tab is never empty. */
export async function ensureOpenSlate(now = new Date()): Promise<string> {
  return (await ensureSlates(now)).open;
}
